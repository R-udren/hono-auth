import type { BetterAuthOptions } from "better-auth"

import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { admin, jwt, openAPI, username } from "better-auth/plugins"
import { uuidv7 } from "uuidv7"

import { db } from "@/lib/db"
import { env } from "@/lib/env"
import { logger } from "@/lib/logger"

const socialProviders: BetterAuthOptions["socialProviders"] = {}

if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
	socialProviders.google = {
		clientId: env.GOOGLE_CLIENT_ID,
		clientSecret: env.GOOGLE_CLIENT_SECRET,
	}
}

if (env.DISCORD_CLIENT_ID && env.DISCORD_CLIENT_SECRET) {
	socialProviders.discord = {
		clientId: env.DISCORD_CLIENT_ID,
		clientSecret: env.DISCORD_CLIENT_SECRET,
	}
}

export const auth = betterAuth<BetterAuthOptions>({
	database: drizzleAdapter(db, {
		provider: "pg",
	}),

	session: {
		cookieCache: {
			enabled: true,
			maxAge: 5 * 60, // Cache duration in seconds
		},
	},

	emailAndPassword: {
		enabled: env.EMAIL_PASSWORD_AUTH === "true",
	},

	user: {
		deleteUser: {
			enabled: true,
		},
	},

	plugins: [username(), admin(), jwt({
		jwt: {
			definePayload: ({ user }) => {
				return {
					name: user.name,
					email: user.email,
					role: user.role,
				}
			},
			expirationTime: "1h",
		},
	}), openAPI()],

	socialProviders,

	account: {
		accountLinking: {
			enabled: env.LINK_ACCOUNTS === "true",
			trustedProviders: [],
			allowDifferentEmails: false,
			updateUserInfoOnLink: false,
		},
	},

	advanced: {
		crossSubDomainCookies: {
			enabled: true,
			domain: env.COOKIE_DOMAIN,
		},
		database: {
			generateId: () => uuidv7(),
		},
		ipAddress: {
			ipAddressHeaders: ["cf-connecting-ip", "x-real-ip", "x-client-ip", "x-forwarded-for"],
		},
	},

	rateLimit: {
		enabled: true,
		window: 60, // 1 minute
		max: 30,
		storage: "memory",
	},

	logger: {
		level: "info",
		log: (level, message, ...args) => {
			logger[level](message, ...args)
		},
	},

	trustedOrigins: env.ORIGINS.split(","),
})
