import { betterAuth } from "better-auth"
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
		origin: process.env.ORIGINS?.split(",") || [],
		allowHeaders: ["Content-Type", "Authorization"],
		allowMethods: ["POST", "GET", "OPTIONS"],
		exposeHeaders: ["Content-Length"],
		maxAge: 600,
		credentials: true,
	}),
)

app.get("/session", (c) => {
	const session = c.get("session")
	const user = c.get("user")

	if (!user) {
		const err = new Error("Unauthorized")
		// @ts-expect-error fucking hono types
		err.status = 401
		throw err
	}

	return c.json({
		session,
		user,
	})
})

app.on(["POST", "GET"], "/api/auth/*", (c) => {
	return auth.handler(c.req.raw)
})

export default app
