import type { BetterAuthPlugin } from "better-auth"
import { createAuthMiddleware } from "better-auth/api"
import { getJwtToken } from "better-auth/plugins"

import {
  getAuthUserState,
  syncPersistedUserAdminRoleByEmail,
  syncPersistedUserAdminRoleById
} from "@/lib/auth-admin-roles"
import { env } from "@/lib/env"

const getBodyEmail = (body: unknown) => {
  if (!body || typeof body !== "object") {
    return null
  }

  const email = (body as { email?: unknown }).email
  return typeof email === "string" && email.trim() ? email : null
}

export const jwtPluginOptions = {
  jwt: {
    definePayload: ({
      user
    }: {
      user: {
        name: string
        email: string
        username?: string | null
        role?: string
        displayUsername?: string | null
        emailVerified: boolean
      }
    }) => {
      const payload = {
        name: user.name,
        email: user.email,
        username: user.username ?? undefined,
        role: user.role,
        displayUsername: user.displayUsername ?? undefined
      }

      if (!user.emailVerified) {
        return { ...payload, verified: false }
      }

      return payload
    },
    expirationTime: `${env.TOKEN_EXPIRATION_HOURS}h`
  }
}

export const authSessionSyncHook = {
  id: "auth-session-sync",
  hooks: {
    before: [
      {
        matcher() {
          return true
        },
        handler: createAuthMiddleware(async (ctx) => {
          const email = getBodyEmail(ctx.body)
          if (!email) {
            return
          }

          await syncPersistedUserAdminRoleByEmail(email)
        })
      }
    ],
    after: [
      {
        matcher() {
          return true
        },
        handler: createAuthMiddleware(async (ctx) => {
          const session = ctx.context.newSession
          if (!session?.session) {
            return
          }

          const persistedUser = await getAuthUserState(session.user.id)
          const syncedRole = await syncPersistedUserAdminRoleById(session.user.id)
          session.user.role = syncedRole?.role ?? persistedUser?.role ?? undefined
          session.user.username = persistedUser?.username ?? undefined
          session.user.displayUsername = persistedUser?.displayUsername ?? undefined

          const previousSession = ctx.context.session
          ctx.context.session = session

          let jwtToken: string
          try {
            jwtToken = await getJwtToken(ctx, jwtPluginOptions)
          } finally {
            ctx.context.session = previousSession
          }

          const exposedHeaders =
            ctx.context.responseHeaders?.get("access-control-expose-headers") || ""
          const headersSet = new Set(
            exposedHeaders
              .split(",")
              .map((header) => header.trim())
              .filter(Boolean)
          )

          headersSet.add("set-auth-jwt")
          ctx.setHeader("set-auth-jwt", jwtToken)
          ctx.setHeader("Access-Control-Expose-Headers", Array.from(headersSet).join(", "))
        })
      }
    ]
  }
} satisfies BetterAuthPlugin
