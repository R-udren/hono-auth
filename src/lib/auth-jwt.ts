import type { BetterAuthPlugin } from "better-auth"
import { createAuthMiddleware } from "better-auth/api"
import { getJwtToken } from "better-auth/plugins"

import { getAuthUserState } from "@/lib/auth-admin-roles"
import { env } from "@/lib/env"

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
    after: [
      {
        matcher() {
          return true
        },
        handler: createAuthMiddleware(async (ctx) => {
          const session = ctx.context.newSession ?? ctx.context.session
          if (!session?.session) {
            return
          }

          const persistedUser = await getAuthUserState(session.user.id)
          session.user.role = persistedUser?.role ?? undefined
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
