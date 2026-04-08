import type { BetterAuthPlugin } from "better-auth"
import { createAuthMiddleware } from "better-auth/api"
import { getJwtToken } from "better-auth/plugins"

import { env } from "@/lib/env"

export const jwtPluginOptions = {
  jwt: {
    definePayload: ({
      user
    }: {
      user: { name: string; email: string; role?: string; emailVerified: boolean }
    }) => {
      const payload = {
        name: user.name,
        email: user.email,
        role: user.role
      }

      if (!user.emailVerified) {
        return { ...payload, verified: false }
      }

      return payload
    },
    expirationTime: `${env.TOKEN_EXPIRATION_HOURS}h`
  }
}

export const jwtHeaderExposureHook = {
  id: "jwt-header-exposure",
  hooks: {
    after: [
      {
        matcher(context) {
          return context.path === "/sign-in/email" || context.path === "/sign-up/email"
        },
        handler: createAuthMiddleware(async (ctx) => {
          const session = ctx.context.session || ctx.context.newSession
          if (!session?.session) {
            return
          }

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
