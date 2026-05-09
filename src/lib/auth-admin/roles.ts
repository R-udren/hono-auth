import { env } from "@/lib/env"

const adminRole = "admin"

export type RoleSyncInput = {
  email?: string | null
  role?: string | null
}

export type RoleSyncResult = {
  changed: boolean
  role: string | null
}

export const normalizeEmail = (email: string) => email.trim().toLowerCase()

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

const joinRoles = (roles: string[]) => (roles.length ? roles.join(",") : null)

const normalizeRole = (role?: string | null) => joinRoles(splitRoles(role))

const isAdminEmail = (email: string) => adminEmails.has(normalizeEmail(email))

export const isAdminRole = (role?: string | null) => splitRoles(role).includes(adminRole)

export const syncAdminRole = (user: RoleSyncInput): RoleSyncResult => {
  const normalizedRole = normalizeRole(user.role)
  if (typeof user.email !== "string" || !user.email.trim()) {
    return {
      changed: false,
      role: normalizedRole
    }
  }

  const nextRoles = splitRoles(normalizedRole)
  if (isAdminEmail(user.email)) {
    if (!nextRoles.includes(adminRole)) {
      nextRoles.push(adminRole)
    }
  } else {
    const adminRoleIndex = nextRoles.indexOf(adminRole)
    if (adminRoleIndex !== -1) {
      nextRoles.splice(adminRoleIndex, 1)
    }
  }

  const nextRole = joinRoles(nextRoles)

  return {
    changed: nextRole !== normalizedRole,
    role: nextRole
  }
}
