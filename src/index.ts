import { eq } from "drizzle-orm"
import { Hono } from "hono"
import { pinoLogger } from "hono-pino"
import { cors } from "hono/cors"
import { HTTPException } from "hono/http-exception"
import { createRemoteJWKSet, jwtVerify } from "jose"

import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { account, user } from "@/lib/db/auth-schema"
import { runMigrations } from "@/lib/db/migrate"
import { env } from "@/lib/env"
import { logger } from "@/lib/logger"
import { notFound, onError } from "@/middleware"

// Run migrations on startup, if enabled
(async () => {
	if (env.RUN_MIGRATIONS) {
		logger.info("env `RUN_MIGRATIONS` enabled, running migrations...")
		try {
			await runMigrations()
		}
		catch (error) {
			logger.error(`Error running migrations: ${error}`)
		}
	}
	else {
		logger.info("env `RUN_MIGRATIONS` disabled, skipping migrations...")
	}
})()

const app = new Hono<{
	Variables: {
		user: typeof auth.$Infer.Session.user | null
		session: typeof auth.$Infer.Session.session | null
	}
}>()

app.use(pinoLogger({
	pino: logger,
	http: {
		onReqBindings: (c) => {
			const userAgent = c.req.header("user-agent")
			const ip = c.req.header("cf-connecting-ip")
				|| c.req.header("x-real-ip")
				|| c.req.header("x-client-ip")
				|| c.req.header("x-forwarded-for")

			return {
				ip,
				userAgent,
			}
		},
	},
}))

app.notFound(notFound)
app.onError(onError)

app.use(
	"*",
	cors({
		origin: (origin) => {
			// Allow requests with no origin (mobile apps, etc.)
			if (!origin) {
				return null
			}

			const allowedOrigins = env.ORIGINS.split(",")
			return allowedOrigins.includes(origin) ? origin : null
		},
		allowHeaders: ["Content-Type", "Authorization"],
		allowMethods: ["POST", "GET", "OPTIONS", "PUT", "DELETE"],
		exposeHeaders: ["Content-Length"],
		maxAge: 600,
		credentials: true,
	}),
)

app.get("/", (c) => {
	return c.json({
		message: "healthy",
	})
})

app.get("/me", async (c) => {
	let userId: string | null = null

	// Try to get session from better-auth
	const session = await auth.api.getSession({
		headers: c.req.raw.headers,
	})

	if (session) {
		userId = session.user.id
	}
	else {
		// Check for JWT in Authorization header
		const authHeader = c.req.header("authorization")
		if (authHeader && authHeader.startsWith("Bearer ")) {
			const token = authHeader.slice(7)
			logger.debug("Verifying JWT token")
			try {
				const baseUrl = env.BETTER_AUTH_URL
				const jwksSet = createRemoteJWKSet(
					new URL(`${baseUrl}/api/auth/jwks`),
				)
				const { payload } = await jwtVerify(token, jwksSet, {
					issuer: baseUrl,
					audience: baseUrl,
				})
				userId = payload.sub as string
				logger.debug("JWT validation successful")
			}
			catch (error) {
				const errorMessage = error instanceof Error ? error.message : String(error)
				const tokenPreview = `${token.slice(0, 20)}...`
				logger.warn({ error: errorMessage, tokenPreview }, "JWT token validation failed")
			}
		}
	}

	if (!userId) {
		throw new HTTPException(401, {
			message: "No active session or valid JWT",
			cause: "Unauthorized",
		})
	}

	// Fetch complete user data with custom fields
	const userData = await db
		.select({
			id: user.id,
			name: user.name,
			email: user.email,
			image: user.image,
			username: user.username,
			displayUsername: user.displayUsername,
			role: user.role,
		})
		.from(user)
		.where(eq(user.id, userId))
		.limit(1)

	if (!userData.length) {
		throw new HTTPException(404, {
			message: "No user found",
		})
	}

	// Fetch user's accounts (only public fields)
	const userAccounts = await db
		.select({
			accountId: account.accountId,
			providerId: account.providerId,
		})
		.from(account)
		.where(eq(account.userId, userId))

	const response: Record<string, unknown> = {
		user: userData[0],
		accounts: userAccounts,
	}

	// Only include session if it exists
	if (session) {
		response.session = {
			userAgent: session.session.userAgent,
			expiresAt: session.session.expiresAt,
			createdAt: session.session.createdAt,
			ipAddress: session.session.ipAddress,
		}
	}

	return c.json(response)
})

app.all("/api/auth/*", async (c) => {
	const res = await auth.handler(c.req.raw)
	if (c.req.path.endsWith("/jwks")) {
		res.headers.set("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400")
	}
	return res
})

logger.info(`Starting server...`)

export default {
	port: 3000,
	fetch: app.fetch,
}

logger.info(`Access interactive documentation at ${env.BETTER_AUTH_URL}/api/auth/reference`)
