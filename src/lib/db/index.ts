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
	const credential = new DefaultAzureCredential()

	return async () => {
		const token = await credential.getToken(AZURE_POSTGRESQL_SCOPE)
		return token.token
	}
}

/**
 * Parses DATABASE_URL and returns pg.PoolConfig with Azure MI support.
 */
const getPoolConfig = (): pg.PoolConfig => {
	const url = new URL(env.DATABASE_URL!)

	// Base config from URL
	const config: pg.PoolConfig = {
		host: url.hostname,
		port: Number(url.port) || 5432,
		database: url.pathname.slice(1),
	}

	if (env.AZURE_CLOUD) {
		// Azure Managed Identity authentication
		if (!env.AZURE_CLIENT_ID) {
			throw new Error("AZURE_CLIENT_ID is required when running in Azure")
		}

		return {
			...config,
			user: env.AZURE_CLIENT_ID,
			password: createAzurePasswordProvider(),
			ssl: { rejectUnauthorized: false },
		}
	}

	// Local development - use full connection string
	return { connectionString: env.DATABASE_URL }
}

// Lazy initialization
let pool: pg.Pool | null = null

const getPool = (): pg.Pool => {
	if (!pool) {
		pool = new pg.Pool(getPoolConfig())
	}
	return pool
}

export const db = drizzle({
	client: getPool(),
	schema,
})
