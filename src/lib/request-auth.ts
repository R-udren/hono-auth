import { HTTPException } from "hono/http-exception"

import { createRemoteJWKSet, jwtVerify } from "jose"

import { auth } from "@/lib/auth"
import { syncPersistedUserAdminRoleById } from "@/lib/auth-admin-roles"
import { env } from "@/lib/env"
import { logger } from "@/lib/logger"

type AuthSession = Awaited<ReturnType<typeof auth.api.getSession>>
type ActiveSession = NonNullable<AuthSession>
type SessionUserWithRole = ActiveSession["user"] & { role?: string }

const baseUrl = env.BETTER_AUTH_URL
const jwksSet = createRemoteJWKSet(new URL("/api/auth/jwks", baseUrl))

const syncSessionUserRole = async (session: ActiveSession): Promise<ActiveSession> => {
  const syncedRole = await syncPersistedUserAdminRoleById(session.user.id)
  if (!syncedRole?.changed) {
    return session
  }

  ;(session.user as SessionUserWithRole).role = syncedRole.role ?? undefined
  return session
}

const resolveUserIdFromBearerToken = async (headers: Headers) => {
  const authorization = headers.get("authorization")
  if (!authorization?.startsWith("Bearer ")) {
    return null
  }

  const token = authorization.slice(7)
  logger.debug("Verifying JWT token")

  try {
    const { payload } = await jwtVerify(token, jwksSet, {
      issuer: baseUrl,
      audience: baseUrl
    })

    if (typeof payload.sub !== "string" || payload.sub.length === 0) {
      return null
    }

    logger.debug("JWT validation successful")
    return payload.sub
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.warn({ error: errorMessage }, "JWT token validation failed")
    return null
  }
}

export const requireSession = async (headers: Headers): Promise<ActiveSession> => {
  const session = await auth.api.getSession({
    headers
  })
  if (!session) {
    throw new HTTPException(401, {
      message: "Authentication required."
    })
  }

  return syncSessionUserRole(session)
}

export const resolveAuthenticatedRequest = async (headers: Headers) => {
  const session = await auth.api.getSession({
    headers
  })
  if (session) {
    const syncedSession = await syncSessionUserRole(session)

    return {
      userId: syncedSession.user.id,
      session: syncedSession
    }
  }

  const userId = await resolveUserIdFromBearerToken(headers)
  if (userId) {
    return {
      userId,
      session: null
    }
  }

  throw new HTTPException(401, {
    message: "No active session or valid JWT",
    cause: "Unauthorized"
  })
}
