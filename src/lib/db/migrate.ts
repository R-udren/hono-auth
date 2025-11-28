import { migrate } from "drizzle-orm/node-postgres/migrator"

import { db, getPool } from "./index"

/**
 * Wait for database to be ready with retries
 */
const waitForDb = async (maxRetries = 30, delayMs = 2000) => {
	const pool = getPool()
	for (let i = 0; i < maxRetries; i++) {
		try {
			await pool.query("SELECT 1")
			return
		}
		catch (err) {
			// eslint-disable-next-line no-console
			console.log(`Waiting for database... attempt ${i + 1}/${maxRetries}`)
			if (i === maxRetries - 1) {
				throw err
			}
			await new Promise(resolve => setTimeout(resolve, delayMs))
		}
	}
}

/**
 * Run database migrations.
 * Uses the existing pool from db/index.ts (which handles Azure auth).
 */
export const runMigrations = async () => {
	// eslint-disable-next-line no-console
	console.log(`Running migrations...`)

	// Wait for database to be available
	await waitForDb()

	await migrate(db, { migrationsFolder: "./drizzle" })

	// eslint-disable-next-line no-console
	console.log(`Migrations completed!`)
}

// Run directly if called as script
if (import.meta.main) {
	runMigrations()
		.then(() => getPool().end())
		.catch((err) => {
			console.error("Migration failed:", err)
			process.exit(1)
		})
}
