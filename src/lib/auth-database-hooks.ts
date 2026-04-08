import { HTTPException } from "hono/http-exception"

import type { BetterAuthOptions } from "better-auth"
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
}> &
  Record<string, unknown>

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
      before: async (nextUser: UpdateUserInput) => {
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

        if (
          typeof nextUser.id === "string" &&
          typeof nextUser.username === "string" &&
          nextUser.username.trim()
        ) {
          const conflictingUser = await db
            .select({ id: authUser.id })
            .from(authUser)
            .where(and(eq(authUser.username, nextUser.username), ne(authUser.id, nextUser.id)))
            .limit(1)

          if (conflictingUser.length) {
            throw new APIError("BAD_REQUEST", {
              message: "Username already exists"
            })
          }
        }

        return {
          data: nextUser
        }
      }
    }
  }
}
