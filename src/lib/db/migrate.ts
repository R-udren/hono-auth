import { migrate } from "drizzle-orm/node-postgres/migrator"

import { db, getPool } from "./index"

/**
 * Run database migrations.
 * Uses the existing pool from db/index.ts (which handles Azure auth).
 */
export const runMigrations = async () => {
	// eslint-disable-next-line no-console
	console.log(`Running migrations...`)

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
