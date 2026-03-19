import { pinoLogger } from "hono-pino"

import { logger } from "@/lib/logger"

export const requestLogger = pinoLogger({
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
})
