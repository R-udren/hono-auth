import { DefaultAzureCredential } from "@azure/identity"
import { drizzle } from "drizzle-orm/node-postgres"
import pg from "pg"

import { env } from "../env"
import * as schema from "./schema"

const AZURE_POSTGRESQL_SCOPE
	= "https://ossrdbms-aad.database.windows.net/.default"

const createPool = async (): Promise<pg.Pool> => {
	// If running in Azure, use Managed Identity
	if (process.env.AZURE_CLOUD === "true") {
		const credential = new DefaultAzureCredential()
		const url = new URL(env.DATABASE_URL)

		const pool = new pg.Pool({
			host: url.hostname,
			port: Number(url.port) || 5432,
			database: url.pathname.slice(1),
			user: process.env.AZURE_CLIENT_ID, // UAI client ID
			ssl: { rejectUnauthorized: false },
		})

		// Override getConnection to refresh token
		const originalConnect = pool.connect.bind(pool)
		pool.connect = async () => {
			const token = await credential.getToken(AZURE_POSTGRESQL_SCOPE);
			(pool as unknown as { options: { password: string } }).options.password
				= token.token
			return originalConnect()
		}

		return pool
	}

	// use connection string from env
	return new pg.Pool({ connectionString: env.DATABASE_URL })
}

let pool: pg.Pool | null = null

const getPool = async (): Promise<pg.Pool> => {
	if (!pool) {
		pool = await createPool()
	}
	return pool
}

export const db = drizzle({
	client: {
		query: async (sql: string, params?: unknown[]) => {
			const p = await getPool()
			return p.query(sql, params)
		},
	} as pg.Pool,
	schema,
})
