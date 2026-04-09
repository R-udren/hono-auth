import { HTTPException } from "hono/http-exception"

import type { BetterAuthOptions, GenericEndpointContext } from "better-auth"
import { APIError } from "better-auth/api"
import { and, eq, ne } from "drizzle-orm"

import { prepareAuthUserCreate } from "@/lib/auth-user-creation"
import { validateAvatarImage } from "@/lib/avatar-storage"
import { db } from "@/lib/db"
import { user as authUser } from "@/lib/db/auth-schema"

type CreateUserInput = Partial<{
  id: string
  createdAt: Date
  updatedAt: Date
  email: string
  emailVerified: boolean
  name: string
  image?: string | null
  username?: string | null
  displayUsername?: string | null
}> &
  Record<string, unknown>

type UpdateUserInput = Partial<{
  id: string
  createdAt: Date
  updatedAt: Date
  email: string
  emailVerified: boolean
  name: string
  image?: string | null
  username?: string | null
  displayUsername?: string | null
}> &
  Record<string, unknown>

const getSessionUserId = (context: GenericEndpointContext | null): string | undefined => {
  if (!context || typeof context !== "object") {
    return undefined
  }

  const sessionValue = (context as Record<string, unknown>).session
  if (!sessionValue || typeof sessionValue !== "object") {
    return undefined
  }

  const sessionContainer = (sessionValue as Record<string, unknown>).session
  if (!sessionContainer || typeof sessionContainer !== "object") {
    return undefined
  }

  const userId = (sessionContainer as Record<string, unknown>).userId
  return typeof userId === "string" && userId ? userId : undefined
}

export const authDatabaseHooks: BetterAuthOptions["databaseHooks"] = {
  user: {
    create: {
      before: async (nextUser: CreateUserInput) => {
        return {
          data: await prepareAuthUserCreate(nextUser)
        }
      }
    },
    update: {
      before: async (nextUser: UpdateUserInput, context: GenericEndpointContext | null) => {
        try {
          validateAvatarImage(nextUser.image)
        } catch (error) {
          if (error instanceof HTTPException) {
            throw new APIError("BAD_REQUEST", {
              message: error.message
            })
          }

          throw error
        }

        if (typeof nextUser.username === "string" && nextUser.username.trim()) {
          const requestedUsername = nextUser.username.trim()
          const currentUserId =
            typeof nextUser.id === "string" && nextUser.id ? nextUser.id : getSessionUserId(context)

          const conflictingUser = await db
            .select({ id: authUser.id })
            .from(authUser)
            .where(
              currentUserId
                ? and(eq(authUser.username, requestedUsername), ne(authUser.id, currentUserId))
                : eq(authUser.username, requestedUsername)
            )
            .limit(1)

          if (conflictingUser.length) {
            throw new APIError("BAD_REQUEST", {
              message: "Username already exists"
            })
          }
        }

        return {
          data: {
            ...nextUser,
            ...(typeof nextUser.username === "string" && nextUser.username.trim()
              ? { username: nextUser.username.trim() }
              : {})
          }
        }
      }
    }
  }
}
