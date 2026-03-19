import app from "@/app"
import { env } from "@/lib/env"
import { logger } from "@/lib/logger"
import { runMigrationsOnStartup } from "@/startup/run-migrations-on-startup"

const startup = runMigrationsOnStartup()

const fetch: typeof app.fetch = async (...args) => {
	await startup
	return app.fetch(...args)
}

logger.info(`Starting server...`)

export default {
	port: 3000,
	fetch,
}

logger.info(
	`Access interactive documentation at ${env.BETTER_AUTH_URL}/api/auth/reference`,
)
