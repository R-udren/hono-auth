import { HTTPException } from "hono/http-exception"

import type { BetterAuthOptions } from "better-auth"
import { APIError } from "better-auth/api"

import { prepareAuthUserCreate } from "@/lib/auth-user-creation"
import { validateAvatarImage } from "@/lib/avatar-storage"

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

        return {
          data: nextUser
        }
      }
    }
  }
}
