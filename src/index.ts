import { eq } from "drizzle-orm"
import { Hono } from "hono"
import { pinoLogger } from "hono-pino"
import { cors } from "hono/cors"
import pino from "pino"

import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { account, user } from "@/lib/db/auth-schema"
import { notFound, onError } from "@/middleware"

const app = new Hono<{
	Variables: {
		user: typeof auth.$Infer.Session.user | null
		session: typeof auth.$Infer.Session.session | null
	}
}>()

const logger = pino({
	base: null,
	level: "info",
	// Redact sensitive information from all logs
	redact: {
		paths: [
			"req.headers.cookie",
			"req.headers.authorization",
			"res.headers.set-cookie",
			"*.cookie",
			"*.authorization",
		],
		censor: "[REDACTED]",
	},
	// Handle circular references in serialization
	serializers: {
		res: (res) => {
			// Only log essential response info, avoid circular refs
			return {
				statusCode: res.statusCode,
				headers: {
					...res.headers,
					"set-cookie": "[REDACTED]",
				},
			}
		},
		req: req => ({
			method: req.method,
			url: req.url,
			headers: {
				...req.headers,
				cookie: "[REDACTED]",
				authorization: "[REDACTED]",
			},
		}),
	},
	transport: process.env.NODE_ENV === "development"
		? { target: "hono-pino/debug-log" }
		: undefined,
	timestamp: pino.stdTimeFunctions.unixTime,
})

app.use(pinoLogger({
	pino: logger,
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

			const allowedOrigins = process.env.ORIGINS?.split(",") || []
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

app.get("/session", async (c) => {
	const session = await auth.api.getSession({
		headers: c.req.raw.headers,
	})

	if (!session) {
		const err = new Error("Unauthorized")
		// @ts-expect-error fucking hono types
		err.status = 401
		throw err
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
		.where(eq(user.id, session.user.id))
		.limit(1)

	if (!userData.length) {
		const err = new Error("User not found")
		// @ts-expect-error fucking hono types
		err.status = 404
		throw err
	}

	// Fetch user's accounts (only public fields)
	const userAccounts = await db
		.select({
			accountId: account.accountId,
			providerId: account.providerId,
		})
		.from(account)
		.where(eq(account.userId, session.user.id))

	return c.json({
		session: {
			userAgent: session.session.userAgent,
			expiresAt: session.session.expiresAt,
			createdAt: session.session.createdAt,
		},
		user: userData[0],
		accounts: userAccounts,
	})
})

app.on(["POST", "GET"], "/api/auth/*", (c) => {
	return auth.handler(c.req.raw)
})

export default app
