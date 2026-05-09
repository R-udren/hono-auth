import { eq, sql } from "drizzle-orm"

import { isAdminRole, normalizeEmail, syncAdminRole } from "@/lib/auth-admin/roles"
import { db } from "@/lib/db"
import { user as authUser } from "@/lib/db/auth-schema"

type PersistedAdminUser = {
  email?: string | null
  emailVerified?: boolean | null
  id: string
  role?: string | null
}

const authUserStateColumns = {
  id: authUser.id,
  email: authUser.email,
  emailVerified: authUser.emailVerified,
  username: authUser.username,
  role: authUser.role,
  displayUsername: authUser.displayUsername
}

export const getAuthUserState = async (userId: string) => {
  const users = await db
    .select(authUserStateColumns)
    .from(authUser)
    .where(eq(authUser.id, userId))
    .limit(1)

  return users[0] ?? null
}

const getAuthUserStateByEmail = async (email: string) => {
  const normalizedEmail = normalizeEmail(email)
  if (!normalizedEmail) {
    return null
  }

  const users = await db
    .select(authUserStateColumns)
    .from(authUser)
    .where(sql`lower(${authUser.email}) = ${normalizedEmail}`)
    .limit(1)

  return users[0] ?? null
}

export const syncPersistedUserAdminRole = async (user: PersistedAdminUser) => {
  const syncedRole = syncAdminRole(user)
  const shouldVerifyEmail = isAdminRole(syncedRole.role) && !user.emailVerified
  if (!syncedRole.changed && !shouldVerifyEmail) {
    return syncedRole
  }

  await db
    .update(authUser)
    .set({
      ...(syncedRole.changed ? { role: syncedRole.role } : {}),
      ...(shouldVerifyEmail ? { emailVerified: true } : {})
    })
    .where(eq(authUser.id, user.id))

  return syncedRole
}

export const syncPersistedUserAdminRoleByEmail = async (email: string) => {
  const user = await getAuthUserStateByEmail(email)
  return user ? syncPersistedUserAdminRole(user) : null
}

export const syncPersistedUserAdminRoleById = async (userId: string) => {
  const user = await getAuthUserState(userId)
  return user ? syncPersistedUserAdminRole(user) : null
}
