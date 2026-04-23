import { eq, sql } from "drizzle-orm"

import { db } from "@/lib/db"
import { user as authUser } from "@/lib/db/auth-schema"
import { env } from "@/lib/env"

const ADMIN_ROLE = "admin"

const normalizeEmail = (email: string) => email.trim().toLowerCase()

const adminEmails = new Set(env.ADMIN_EMAILS.split(",").map(normalizeEmail).filter(Boolean))

const splitRoles = (role?: string | null) => {
  if (typeof role !== "string") {
    return [] as string[]
  }

  const roles = role
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)

  return Array.from(new Set(roles))
}

const joinRoles = (roles: string[]) => {
  if (!roles.length) {
    return null
  }

  return roles.join(",")
}

const normalizeRole = (role?: string | null) => joinRoles(splitRoles(role))

export const syncAdminRole = (user: { email?: string | null; role?: string | null }) => {
  const normalizedRole = normalizeRole(user.role)
  if (typeof user.email !== "string" || !user.email.trim()) {
    return {
      role: normalizedRole,
      changed: false
    }
  }

  const nextRoles = splitRoles(normalizedRole)
  const isAdminEmail = adminEmails.has(normalizeEmail(user.email))

  if (isAdminEmail) {
    if (!nextRoles.includes(ADMIN_ROLE)) {
      nextRoles.push(ADMIN_ROLE)
    }
  } else {
    const adminRoleIndex = nextRoles.indexOf(ADMIN_ROLE)
    if (adminRoleIndex !== -1) {
      nextRoles.splice(adminRoleIndex, 1)
    }
  }

  const nextRole = joinRoles(nextRoles)

  return {
    role: nextRole,
    changed: nextRole !== normalizedRole
  }
}

export const getAuthUserState = async (userId: string) => {
  const existingUsers = await db
    .select({
      id: authUser.id,
      email: authUser.email,
      username: authUser.username,
      role: authUser.role,
      displayUsername: authUser.displayUsername
    })
    .from(authUser)
    .where(eq(authUser.id, userId))
    .limit(1)

  return existingUsers[0] ?? null
}

const getAuthUserAdminStateByEmail = async (email: string) => {
  const normalizedEmail = normalizeEmail(email)
  if (!normalizedEmail) {
    return null
  }

  const existingUsers = await db
    .select({
      id: authUser.id,
      email: authUser.email,
      username: authUser.username,
      role: authUser.role,
      displayUsername: authUser.displayUsername
    })
    .from(authUser)
    .where(sql`lower(${authUser.email}) = ${normalizedEmail}`)
    .limit(1)

  return existingUsers[0] ?? null
}

export const syncPersistedUserAdminRoleByEmail = async (email: string) => {
  const currentUser = await getAuthUserAdminStateByEmail(email)
  if (!currentUser) {
    return null
  }

  return syncPersistedUserAdminRole(currentUser)
}

export const syncPersistedUserAdminRoleById = async (userId: string) => {
  const currentUser = await getAuthUserState(userId)
  if (!currentUser) {
    return null
  }

  return syncPersistedUserAdminRole(currentUser)
}

export const syncPersistedUserAdminRole = async (user: {
  id: string
  email?: string | null
  role?: string | null
}) => {
  const syncedRole = syncAdminRole(user)
  if (!syncedRole.changed) {
    return syncedRole
  }

  await db.update(authUser).set({ role: syncedRole.role }).where(eq(authUser.id, user.id))

  return syncedRole
}
