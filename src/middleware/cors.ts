import { cors } from "hono/cors"

import { env } from "@/lib/env"

const allowedOrigins = env.ORIGINS.split(",").map(origin => origin.trim()).filter(Boolean)

export const corsMiddleware = cors({
	origin: (origin) => {
		if (!origin) {
			return null
		}

		return allowedOrigins.includes(origin) ? origin : null
	},
	allowHeaders: ["Content-Type", "Authorization"],
	allowMethods: ["POST", "GET", "OPTIONS", "PUT", "DELETE"],
	exposeHeaders: ["Content-Length"],
	maxAge: 600,
	credentials: true,
})
