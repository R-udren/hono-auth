import { z } from "zod"

const envSchema = z.object({
	// Azure configuration
	AZURE_CLOUD: z
		.string()
		.default("false")
		.transform(v => v === "true"),
	AZURE_CLIENT_ID: z.string().optional(),

	// Auth configuration
	BETTER_AUTH_SECRET: z.string().min(1, "BETTER_AUTH_SECRET is required"),
	BETTER_AUTH_URL: z.url().default("http://localhost:3000"),
	BETTER_AUTH_TELEMETRY: z.string().default("0"),

	// OAuth providers
	GOOGLE_CLIENT_ID: z.string().optional(),
	GOOGLE_CLIENT_SECRET: z.string().optional(),
	DISCORD_CLIENT_ID: z.string().optional(),
	DISCORD_CLIENT_SECRET: z.string().optional(),

	// Database
	DATABASE_URL: z.url("DATABASE_URL must be a valid URL"),

	// App configuration
	ORIGINS: z.string().default("http://localhost:5173,http://localhost:3000,http://localhost:3001"),
	COOKIE_DOMAIN: z.string().default("app.example.com"),
	NODE_ENV: z.enum(["development", "production"]).default("development"),
	EMAIL_PASSWORD_AUTH: z.string().default("true"),
	LINK_ACCOUNTS: z.string().default("true"),
})

export const env = envSchema.parse(process.env)

export type Env = z.infer<typeof envSchema>
