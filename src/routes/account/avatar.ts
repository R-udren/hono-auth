import type { Hono } from "hono"
import { bodyLimit } from "hono/body-limit"
import { HTTPException } from "hono/http-exception"

import type { AppBindings } from "@/lib/app-bindings"
import {
  avatarUploadRequestLimitBytes,
  deleteAvatarFile,
  uploadAvatarFile
} from "@/lib/avatar-storage"
import { resolveAuthenticatedRequest } from "@/lib/request-auth"

const avatarDeleteRequestLimitBytes = 8 * 1024

const assertRequestLength = (
  contentLengthHeader: string | undefined,
  label: string,
  maxBytes: number,
  allowZero: boolean
) => {
  if (!contentLengthHeader) {
    return
  }

  const contentLength = Number(contentLengthHeader)
  if (!Number.isFinite(contentLength) || contentLength < 0 || (!allowZero && contentLength === 0)) {
    throw new HTTPException(400, {
      message: `${label} has an invalid Content-Length header.`
    })
  }

  if (contentLength > maxBytes) {
    throw new HTTPException(413, {
      message: `${label} exceeds the ${maxBytes} byte limit.`
    })
  }
}

const parseAvatarDeleteBody = async (request: Request) => {
  const rawBody = await request.text()
  if (!rawBody.trim()) {
    return null
  }

  let parsedBody: unknown

  try {
    parsedBody = JSON.parse(rawBody)
  } catch {
    throw new HTTPException(400, {
      message: "Avatar delete body must be valid JSON."
    })
  }

  if (!parsedBody || typeof parsedBody !== "object" || Array.isArray(parsedBody)) {
    throw new HTTPException(400, {
      message: "Avatar delete body must be a JSON object."
    })
  }

  const { imageUrl } = parsedBody as { imageUrl?: unknown }
  return typeof imageUrl === "string" && imageUrl.length > 0 ? imageUrl : null
}

const parseCurrentImageUrl = (value: File | string | null) => {
  if (value == null) {
    return null
  }

  if (value instanceof File) {
    throw new HTTPException(400, {
      message: "Avatar currentImageUrl must be a string."
    })
  }

  const imageUrl = value.trim()
  return imageUrl.length > 0 ? imageUrl : null
}

export const registerAvatarRoutes = (app: Hono<AppBindings>) => {
  app.post(
    "/api/account/avatar",
    bodyLimit({
      maxSize: avatarUploadRequestLimitBytes,
      onError: () => {
        throw new HTTPException(413, {
          message: `Avatar upload request exceeds the ${avatarUploadRequestLimitBytes} byte limit.`
        })
      }
    }),
    async (c) => {
      const { userId } = await resolveAuthenticatedRequest(c.req.raw.headers)
      const contentType = c.req.header("content-type")
      if (!contentType?.toLowerCase().startsWith("multipart/form-data")) {
        throw new HTTPException(400, {
          message: "Avatar upload must use multipart/form-data."
        })
      }

      assertRequestLength(
        c.req.header("content-length"),
        "Avatar upload request",
        avatarUploadRequestLimitBytes,
        false
      )

      const formData = await c.req.formData()
      const file = formData.get("file")
      const currentImageUrl = parseCurrentImageUrl(formData.get("currentImageUrl"))

      if (!(file instanceof File)) {
        throw new HTTPException(400, {
          message: "Avatar upload requires a file."
        })
      }

      const { imageUrl } = await uploadAvatarFile(userId, file, currentImageUrl)

      return c.json({
        imageUrl
      })
    }
  )

  app.delete(
    "/api/account/avatar",
    bodyLimit({
      maxSize: avatarDeleteRequestLimitBytes,
      onError: () => {
        throw new HTTPException(413, {
          message: `Avatar delete request exceeds the ${avatarDeleteRequestLimitBytes} byte limit.`
        })
      }
    }),
    async (c) => {
      const { userId } = await resolveAuthenticatedRequest(c.req.raw.headers)
      assertRequestLength(
        c.req.header("content-length"),
        "Avatar delete request",
        avatarDeleteRequestLimitBytes,
        true
      )
      const imageUrl = await parseAvatarDeleteBody(c.req.raw)

      if (!imageUrl) {
        return c.json({ success: true })
      }

      await deleteAvatarFile(userId, imageUrl)

      return c.json({ success: true })
    }
  )
}
