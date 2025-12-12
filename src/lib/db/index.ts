import { DefaultAzureCredential } from "@azure/identity"
import { drizzle } from "drizzle-orm/node-postgres"
import pg from "pg"

import { env } from "../env"
import * as schema from "./schema"

const AZURE_POSTGRESQL_SCOPE = "https://ossrdbms-aad.database.windows.net/.default"

/**
 * Creates a password provider for Azure Managed Identity authentication.
 * Returns a function that fetches a fresh token on each call.
 */
const createAzurePasswordProvider = (): (() => Promise<string>) => {
	const credential = new DefaultAzureCredential({
		managedIdentityClientId: env.AZURE_CLIENT_ID,
	})

	return async () => {
		const token = await credential.getToken(AZURE_POSTGRESQL_SCOPE)
		return token.token
	}
}

/**
 * Returns pg.PoolConfig.
 * - In Azure: use Managed Identity + AZURE_PG_* env vars
 * - Locally: use DATABASE_URL connection string
 */
const getPoolConfig = (): pg.PoolConfig => {
	if (env.AZURE_CLOUD) {
		// Azure Managed Identity authentication
		return {
			host: env.AZURE_PG_HOST!,
			port: env.AZURE_PG_PORT ?? 5432,
			database: env.AZURE_PG_DATABASE!,
			user: env.AZURE_CLIENT_ID,
			password: createAzurePasswordProvider(),
			ssl: { rejectUnauthorized: false },
		}
	}

	return { connectionString: env.DATABASE_URL! }
}

// Lazy initialization
let pool: pg.Pool | null = null

export const getPool = (): pg.Pool => {
	if (!pool) {
		pool = new pg.Pool(getPoolConfig())
	}
	return pool
}

export const db = drizzle({
	client: getPool(),
	schema,
})
