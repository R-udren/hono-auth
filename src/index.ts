import { Hono } from "hono"
import { pinoLogger } from "hono-pino"
import { cors } from "hono/cors"
import pino from "pino"

import { auth } from "@/lib/auth"
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

	return c.json({
		session: session.session,
		user: session.user,
	})
})

app.on(["POST", "GET"], "/api/auth/*", (c) => {
	return auth.handler(c.req.raw)
})

export default app
