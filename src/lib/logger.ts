import pino from "pino"

export const logger = pino({
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
		res: res => ({
			statusCode: res.statusCode,
		}),
		req: (req) => {
			const headers = { ...req.headers }
			if (headers.cookie) {
				headers.cookie = "[REDACTED]"
			}
			if (headers.authorization) {
				headers.authorization = "[REDACTED]"
			}
			return {
				method: req.method,
				url: req.url,
				headers,
			}
		},
	},
	// Format level as string instead of number
	formatters: {
		level: (label) => {
			return { level: label }
		},
	},
	transport: process.env.NODE_ENV === "development"
		? { target: "hono-pino/debug-log" }
		: undefined,
	timestamp: pino.stdTimeFunctions.unixTime,
})
