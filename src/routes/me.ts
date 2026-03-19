import type { Hono } from "hono"

import type { AppBindings } from "@/lib/app-bindings"

import { getUserProfile } from "@/lib/db/queries/user-profile"
import { resolveAuthenticatedRequest } from "@/lib/request-auth"

export const registerMeRoutes = (app: Hono<AppBindings>) => {
	app.get("/me", async (c) => {
		const { userId, session } = await resolveAuthenticatedRequest(c.req.raw.headers)
		const profile = await getUserProfile(userId)

		const response: Record<string, unknown> = {
			user: profile.user,
			accounts: profile.accounts,
		}

		if (session) {
			response.session = {
				userAgent: session.session.userAgent,
				expiresAt: session.session.expiresAt,
				createdAt: session.session.createdAt,
				ipAddress: session.session.ipAddress,
				sessionId: session.session.id,
			}
		}

		return c.json(response)
	})
}
