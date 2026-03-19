import { runMigrations } from "@/lib/db/migrate"
import { env } from "@/lib/env"
import { logger } from "@/lib/logger"

export const runMigrationsOnStartup = async () => {
	if (!env.RUN_MIGRATIONS) {
		logger.info("env `RUN_MIGRATIONS` disabled, skipping migrations...")
		return
	}

	logger.info("env `RUN_MIGRATIONS` enabled, running migrations...")

	try {
		await runMigrations()
	}
	catch (error) {
		logger.error({ error }, "Error running migrations")
		throw error
	}
}
