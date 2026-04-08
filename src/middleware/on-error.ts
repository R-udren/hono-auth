import type { ErrorHandler } from "hono"

import type { ContentfulStatusCode } from "hono/utils/http-status"

import { env } from "@/lib/env"

const INTERNAL_SERVER_ERROR = 500
const CONFLICT = 409
const UNIQUE_VIOLATION_CODE = "23505"
const USERNAME_UNIQUE_CONSTRAINT = "user_username_unique"

const getErrorField = (error: unknown, field: string) => {
  if (typeof error !== "object" || error === null || !(field in error)) {
    return undefined
  }

  return (error as Record<string, unknown>)[field]
}

const onError: ErrorHandler = (err, c) => {
  let statusCode: ContentfulStatusCode = INTERNAL_SERVER_ERROR

  if (typeof err === "object" && err !== null && "status" in err) {
    statusCode = err.status as ContentfulStatusCode
  }

  if (
    getErrorField(err, "code") === UNIQUE_VIOLATION_CODE &&
    getErrorField(err, "constraint") === USERNAME_UNIQUE_CONSTRAINT
  ) {
    statusCode = CONFLICT
  }

  const nodeEnv = c.env?.NODE_ENV || env.NODE_ENV
  const isServerError = statusCode >= INTERNAL_SERVER_ERROR
  const message =
    getErrorField(err, "constraint") === USERNAME_UNIQUE_CONSTRAINT
      ? "Username already exists"
      : nodeEnv === "production" && isServerError
        ? "Internal Server Error"
        : err.message

  return c.json(
    {
      message,
      status: statusCode,
      stack: nodeEnv === "production" ? undefined : err.stack
    },
    statusCode
  )
}

export default onError
