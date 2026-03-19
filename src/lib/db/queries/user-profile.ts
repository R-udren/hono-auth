import { eq } from "drizzle-orm"
import { HTTPException } from "hono/http-exception"

import { db } from "@/lib/db"
import { account, user } from "@/lib/db/auth-schema"

export const getUserProfile = async (userId: string) => {
	const userData = await db
		.select({
			id: user.id,
			name: user.name,
			email: user.email,
			emailVerified: user.emailVerified,
			image: user.image,
			username: user.username,
			displayUsername: user.displayUsername,
			role: user.role,
			banned: user.banned,
			banReason: user.banReason,
			banExpires: user.banExpires,
			createdAt: user.createdAt,
			updatedAt: user.updatedAt,
		})
		.from(user)
		.where(eq(user.id, userId))
		.limit(1)

	if (!userData.length) {
		throw new HTTPException(404, {
			message: "No user found",
		})
	}

	const userAccounts = await db
		.select({
			accountId: account.accountId,
			providerId: account.providerId,
		})
		.from(account)
		.where(eq(account.userId, userId))

	return {
		user: userData[0],
		accounts: userAccounts,
	}
}
