import { eq } from "drizzle-orm"
import { Hono } from "hono"
import { pinoLogger } from "hono-pino"
import { bodyLimit } from "hono/body-limit"
import { cors } from "hono/cors"
import { HTTPException } from "hono/http-exception"
import { createRemoteJWKSet, jwtVerify } from "jose"

import { auth } from "@/lib/auth"
import {
	avatarUploadRequestLimitBytes,
	deleteAvatarFile,
	uploadAvatarFile,
} from "@/lib/avatar-storage"
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

const requireSession = async (headers: Headers) => {
	const session = await auth.api.getSession({ headers })
	if (!session) {
		throw new HTTPException(401, {
			message: "Authentication required.",
		})
	}

	return session
}

const parseAvatarDeleteBody = async (request: Request) => {
	const rawBody = await request.text()
	if (!rawBody.trim()) {
		return { imageUrl: undefined }
	}

	let parsedBody: unknown

	try {
		parsedBody = JSON.parse(rawBody)
	}
	catch {
		throw new HTTPException(400, {
			message: "Avatar delete body must be valid JSON.",
		})
	}

	if (!parsedBody || typeof parsedBody !== "object" || Array.isArray(parsedBody)) {
		throw new HTTPException(400, {
			message: "Avatar delete body must be a JSON object.",
		})
	}

	return parsedBody as { imageUrl?: unknown }
}

const assertAvatarRequestLength = (contentLengthHeader: string | undefined) => {
	if (!contentLengthHeader) {
		return
	}

	const contentLength = Number(contentLengthHeader)
	if (!Number.isFinite(contentLength) || contentLength <= 0) {
		throw new HTTPException(400, {
			message: "Avatar upload request has an invalid Content-Length header.",
		})
	}

	if (contentLength > avatarUploadRequestLimitBytes) {
		throw new HTTPException(413, {
			message: `Avatar upload request exceeds the ${avatarUploadRequestLimitBytes} byte limit.`,
		})
	}
}

app.use(
	pinoLogger({
		pino: logger,
		http: {
			onReqBindings: (c) => {
				const userAgent = c.req.header("user-agent")
				const ip
					= c.req.header("cf-connecting-ip")
						|| c.req.header("x-real-ip")
						|| c.req.header("x-client-ip")
						|| c.req.header("x-forwarded-for")

				return {
					ip,
					userAgent,
					method: c.req.method,
					path: c.req.path,
				}
			},
		},
	}),
)

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

app.post(
	"/api/account/avatar",
	bodyLimit({
		maxSize: avatarUploadRequestLimitBytes,
		onError: () => {
			throw new HTTPException(413, {
				message: `Avatar upload request exceeds the ${avatarUploadRequestLimitBytes} byte limit.`,
			})
		},
	}),
	async (c) => {
		const contentType = c.req.header("content-type")
		if (!contentType?.toLowerCase().startsWith("multipart/form-data")) {
			throw new HTTPException(400, {
				message: "Avatar upload must use multipart/form-data.",
			})
		}

		assertAvatarRequestLength(c.req.header("content-length"))

		const session = await requireSession(c.req.raw.headers)

		const formData = await c.req.formData()
		const file = formData.get("file")

		if (!(file instanceof File)) {
			throw new HTTPException(400, {
				message: "Avatar upload requires a file.",
			})
		}

		const imageUrl = await uploadAvatarFile(session.user.id, file)

		return c.json({
			imageUrl,
		})
	},
)

app.delete("/api/account/avatar", async (c) => {
	const session = await requireSession(c.req.raw.headers)
	const body = await parseAvatarDeleteBody(c.req.raw)

	if (typeof body.imageUrl !== "string" || body.imageUrl.length === 0) {
		return c.json({ success: true })
	}

	await deleteAvatarFile(session.user.id, body.imageUrl)

	return c.json({ success: true })
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
				const internalUrl = new URL("http://localhost:3000")
				const jwksSet = createRemoteJWKSet(
					new URL(`${internalUrl}/api/auth/jwks`),
				)
				const { payload } = await jwtVerify(token, jwksSet, {
					issuer: baseUrl,
					audience: baseUrl,
				})
				userId = payload.sub as string
				logger.debug("JWT validation successful")
			}
			catch (error) {
				const errorMessage
					= error instanceof Error ? error.message : String(error)
				const tokenPreview = `${token.slice(0, 20)}...`
				logger.warn(
					{ error: errorMessage, tokenPreview },
					"JWT token validation failed",
				)
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
			emailVerified: user.emailVerified,
			image: user.image,
			username: user.username,
			displayUsername: user.displayUsername,
			role: user.role,
			banned: user.banned,
			banReason: user.banReason,
			banExpires: user.banExpires,
			createdAt: user.createdAt,
			updatedAt: user.updatedAt,
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
			sessionId: session.session.id,
		}
	}

	return c.json(response)
})

app.all("/api/auth/*", async (c) => {
	const res = await auth.handler(c.req.raw)
	if (c.req.path.endsWith("/jwks")) {
		res.headers.set(
			"Cache-Control",
			"public, max-age=3600, stale-while-revalidate=86400",
		)
	}
	return res
})

logger.info(`Starting server...`)

export default {
	port: 3000,
	fetch: app.fetch,
}

logger.info(
	`Access interactive documentation at ${env.BETTER_AUTH_URL}/api/auth/reference`,
)
