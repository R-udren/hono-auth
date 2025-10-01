import type { BetterAuthOptions } from "better-auth"

import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { admin, bearer, jwt, openAPI, username } from "better-auth/plugins"
import { uuidv7 } from "uuidv7"

import { db } from "@/lib/db"
import { logger } from "@/lib/logger"

export const auth = betterAuth<BetterAuthOptions>({
	database: drizzleAdapter(db, {
		provider: "pg",
	}),

	emailAndPassword: {
		enabled: process.env.EMAIL_PASSWORD_AUTH === "true",
	},

	user: {
		deleteUser: {
			enabled: true,
		},
	},

	plugins: [username(), admin(), bearer(), jwt({
		jwt: {
			definePayload: ({ user }) => {
				return {
					name: user.name,
					email: user.email,
					role: user.role,
				}
			},
		},
	}), openAPI()],

	socialProviders: {
		google: {
			clientId: process.env.GOOGLE_CLIENT_ID!,
			clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
		},
		discord: {
			clientId: process.env.DISCORD_CLIENT_ID!,
			clientSecret: process.env.DISCORD_CLIENT_SECRET!,
		},
	},

	account: {
		accountLinking: {
			enabled: false,
			trustedProviders: [],
			allowDifferentEmails: false,
			updateUserInfoOnLink: false,
		},
	},

	advanced: {
		crossSubDomainCookies: {
			enabled: true,
			domain: process.env.COOKIE_DOMAIN!,
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
		max: 50,
		storage: "memory",
	},

	logger: {
		level: "info",
		log: (level, message, ...args) => {
			logger[level](message, ...args)
		},
	},

	trustedOrigins: process.env.ORIGINS!.split(","),
})
