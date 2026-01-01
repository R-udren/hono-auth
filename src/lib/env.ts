import { z } from "zod"

const baseEnvSchema = z.object({
	// Azure configuration
	AZURE_CLOUD: z
		.string()
		.default("false")
		.transform(v => v === "true"),
	AZURE_CLIENT_ID: z.string().optional(),

	// Azure PostgreSQL (used when AZURE_CLOUD=true)
	AZURE_PG_HOST: z.string().optional(),
	AZURE_PG_PORT: z.coerce.number().int().positive().optional(),
	AZURE_PG_DATABASE: z.string().optional(),

	// Auth configuration
	BETTER_AUTH_SECRET: z
		.string()
		.min(
			32,
			"BETTER_AUTH_SECRET is required and must be at least 32 characters long",
		),
	BETTER_AUTH_URL: z.url().default("http://localhost:3000"),
	BETTER_AUTH_TELEMETRY: z.string().default("0"),

	// OAuth providers
	GOOGLE_CLIENT_ID: z.string().optional(),
	GOOGLE_CLIENT_SECRET: z.string().optional(),
	DISCORD_CLIENT_ID: z.string().optional(),
	DISCORD_CLIENT_SECRET: z.string().optional(),

	// Database
	DATABASE_URL: z.url("DATABASE_URL must be a valid URL").optional(),
	RUN_MIGRATIONS: z
		.string()
		.default("false")
		.transform(v => v === "true"),

	// App configuration
	ORIGINS: z.string().default("http://localhost:5173,http://localhost:3000"),
	COOKIE_DOMAIN: z.string().default("app.example.com"),
	NODE_ENV: z.enum(["development", "production"]).default("development"),
	EMAIL_PASSWORD_AUTH: z.string().default("true"),
	LINK_ACCOUNTS: z.string().default("true"),
	TOKEN_EXPIRATION_HOURS: z.coerce.number().int().positive().default(4),
})

const envSchema = baseEnvSchema.superRefine((data, ctx) => {
	if (data.AZURE_CLOUD) {
		if (!data.AZURE_CLIENT_ID) {
			ctx.addIssue({
				code: "custom",
				path: ["AZURE_CLIENT_ID"],
				message: "AZURE_CLIENT_ID is required when running in Azure",
			})
		}
		if (!data.AZURE_PG_HOST) {
			ctx.addIssue({
				code: "custom",
				path: ["AZURE_PG_HOST"],
				message: "AZURE_PG_HOST is required when running in Azure",
			})
		}
		if (!data.AZURE_PG_DATABASE) {
			ctx.addIssue({
				code: "custom",
				path: ["AZURE_PG_DATABASE"],
				message: "AZURE_PG_DATABASE is required when running in Azure",
			})
		}
	}
	else {
		if (!data.DATABASE_URL) {
			ctx.addIssue({
				code: "custom",
				path: ["DATABASE_URL"],
				message: "DATABASE_URL is required when not running in Azure",
			})
		}
	}
})

export const env = envSchema.parse(process.env)

export type Env = z.infer<typeof envSchema>
