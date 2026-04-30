import type { ErrorHandler } from "hono"

import type { ContentfulStatusCode } from "hono/utils/http-status"

import { env } from "@/lib/env"
import { logger } from "@/lib/logger"

const INTERNAL_SERVER_ERROR = 500
const CONFLICT = 409
const UNIQUE_VIOLATION_CODE = "23505"
const USERNAME_UNIQUE_CONSTRAINT = "user_username_unique"

const statusByName: Record<string, ContentfulStatusCode> = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE_ENTITY: 422,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR
}

const getErrorField = (error: unknown, field: string) => {
  if (typeof error !== "object" || error === null || !(field in error)) {
    return undefined
  }

  return (error as Record<string, unknown>)[field]
}

const getNestedErrorField = (error: unknown, field: string) => {
  const directValue = getErrorField(error, field)
  if (directValue !== undefined) {
    return directValue
  }

  return getErrorField(getErrorField(error, "cause"), field)
}

const getStatusCode = (error: unknown): ContentfulStatusCode => {
  const status = getErrorField(error, "status")

  if (typeof status === "number") {
    return status as ContentfulStatusCode
  }

  if (typeof status === "string" && status in statusByName) {
    return statusByName[status]
  }

  return INTERNAL_SERVER_ERROR
}

const getClientMessage = (error: unknown, statusCode: ContentfulStatusCode, nodeEnv: string) => {
  if (getNestedErrorField(error, "constraint") === USERNAME_UNIQUE_CONSTRAINT) {
    return "Username already exists"
  }

  const body = getErrorField(error, "body")
  const bodyMessage = getErrorField(body, "message")
  if (typeof bodyMessage === "string" && bodyMessage) {
    return bodyMessage
  }

  const message = getErrorField(error, "message")
  if (typeof message === "string" && message) {
    if (nodeEnv === "production" && statusCode >= INTERNAL_SERVER_ERROR) {
      return "Internal Server Error"
    }

    return message
  }

  return "Internal Server Error"
}

const getErrorLogDetails = (error: unknown) => {
  if (typeof error !== "object" || error === null) {
    return { error }
  }

  const errorRecord = error as Record<string, unknown>
  const cause = errorRecord.cause

  return {
    cause:
      typeof cause === "object" && cause !== null
        ? {
            code: (cause as Record<string, unknown>).code,
            message: (cause as Record<string, unknown>).message,
            name: (cause as Record<string, unknown>).name,
            stack: (cause as Record<string, unknown>).stack
          }
        : cause,
    code: errorRecord.code,
    message: errorRecord.message,
    name: errorRecord.name,
    stack: errorRecord.stack,
    status: errorRecord.status
  }
}

const onError: ErrorHandler = (err, c) => {
  let statusCode: ContentfulStatusCode = getStatusCode(err)

  if (
    getNestedErrorField(err, "code") === UNIQUE_VIOLATION_CODE &&
    getNestedErrorField(err, "constraint") === USERNAME_UNIQUE_CONSTRAINT
  ) {
    statusCode = CONFLICT
  }

  const nodeEnv = c.env?.NODE_ENV || env.NODE_ENV
  const message = getClientMessage(err, statusCode, nodeEnv)

  if (statusCode >= INTERNAL_SERVER_ERROR) {
    logger.error(
      {
        error: getErrorLogDetails(err),
        method: c.req.method,
        path: c.req.path,
        statusCode
      },
      "Request failed"
    )
  }

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
