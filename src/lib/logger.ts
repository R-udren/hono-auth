import pino from "pino"

import { env } from "@/lib/env"

export const logger = pino({
	base: null,
	level: "info",
	serializers: {
		res: res => ({
			status: res.status,
		}),
		req: req => ({
			method: req.method,
			url: req.url,
			userAgent: req.headers["user-agent"],
		}),
	},
	// Format level as string instead of number
	formatters: {
		level: (label) => {
			return { level: label }
		},
	},
	transport: env.NODE_ENV === "development"
		? { target: "hono-pino/debug-log" }
		: undefined,
	timestamp: pino.stdTimeFunctions.unixTime,
})
