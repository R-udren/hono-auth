import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { admin, bearer, jwt, openAPI, username } from "better-auth/plugins"

import { db } from "@/lib/db"

export const auth = betterAuth({
	database: drizzleAdapter(db, {
		provider: "sqlite",
	}),

	emailAndPassword: {
		enabled: true,
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
	},

	advanced: {
		crossSubDomainCookies: {
			enabled: true,
			domain: process.env.COOKIE_DOMAIN!,
		},
	},

	trustedOrigins: process.env.ORIGINS!.split(","),
})
