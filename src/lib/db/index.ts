import { drizzle } from "drizzle-orm/node-postgres"
import pg from "pg"

import { env } from "../env"
import * as schema from "./schema"

// Lazy initialization
let pool: pg.Pool | null = null

export const getPool = (): pg.Pool => {
	if (!pool) {
		pool = new pg.Pool({ connectionString: env.DATABASE_URL })
	}
	return pool
}

export const db = drizzle({
	client: getPool(),
	schema,
})
