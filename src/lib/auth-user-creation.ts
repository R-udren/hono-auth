import { APIError } from "better-auth/api"
import { eq } from "drizzle-orm"
import slugify from "slugify"

import { db } from "@/lib/db"
import { user as authUser } from "@/lib/db/auth-schema"

const USERNAME_MIN = 3
const USERNAME_MAX = 30

type PendingAuthUser = {
  username?: string | null
  email?: string
  name?: string
} & Record<string, unknown>

const fail = (message: string): never => {
  throw new APIError("BAD_REQUEST", { message })
}

const randomToken = () => Math.random().toString(36).slice(2, 8)

const toSlug = (value: string) => {
  const slug = slugify(value, {
    lower: true,
    replacement: "_",
    strict: true,
    trim: true
  })

  if (!slug) {
    return fail("A valid username source is required to generate a username")
  }

  if (slug.length >= USERNAME_MIN) {
    return slug.slice(0, USERNAME_MAX)
  }

  return `${slug}_${randomToken()}`
}

const baseUsernameFrom = (user: PendingAuthUser): string => {
  if (typeof user.username === "string" && user.username.trim()) {
    return toSlug(user.username)
  }

  if (typeof user.email === "string" && user.email.trim()) {
    const localPart = user.email.trim().split("@")[0] ?? ""

    if (!localPart) {
      return fail("A valid email is required to generate a username")
    }

    return toSlug(localPart)
  }

  if (typeof user.name === "string" && user.name.trim()) {
    return toSlug(user.name)
  }

  return fail("A valid email or name is required to generate a username")
}

const withSuffix = (baseUsername: string, suffix: number) => {
  if (suffix === 0) {
    return baseUsername
  }

  const suffixText = `.${suffix}`
  const trimmedBaseUsername = baseUsername.slice(0, USERNAME_MAX - suffixText.length)

  return `${trimmedBaseUsername}${suffixText}`
}

const uniqueUsername = async (baseUsername: string) => {
  for (let suffix = 0; ; suffix += 1) {
    const candidate = withSuffix(baseUsername, suffix)
    const existingUser = await db
      .select({ id: authUser.id })
      .from(authUser)
      .where(eq(authUser.username, candidate))
      .limit(1)

    if (!existingUser.length) {
      return candidate
    }
  }
}

export const prepareAuthUserCreate = async (nextUser: PendingAuthUser) => {
  const username = await uniqueUsername(baseUsernameFrom(nextUser))

  return {
    ...nextUser,
    username,
    displayUsername: username
  }
}
