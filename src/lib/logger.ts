import pino from "pino"

import { env } from "@/lib/env"

export const logger = pino({
	base: null,
	level: "info",
	serializers: {
		res: res => ({
			status: res.status,
		}),
		req: (req: any) => ({
			method: req.method,
			url: req.url,
			// userAgent: req.headers["user-agent"],
			// ip: req.headers["cf-connecting-ip"] || req.headers["x-real-ip"] || req.headers["x-client-ip"] || req.headers["x-forwarded-for"] || req.remoteAddress,
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
