import type { Hono } from "hono"
import { bodyLimit } from "hono/body-limit"
import { HTTPException } from "hono/http-exception"

import type { AppBindings } from "@/lib/app-bindings"
import {
  createAvatarUploadRequestLimitError,
  avatarUploadRequestLimitBytes,
  deleteAllAvatarFiles,
  deleteAvatarFile,
  listAvatarFiles,
  uploadAvatarFile
} from "@/lib/avatar-storage"
import { resolveAuthenticatedRequest } from "@/lib/request-auth"

type DeleteAvatarRequestBody = {
  imageUrl?: unknown
}

const deleteAvatarJsonContentType = "application/json"

const assertUploadContentLength = (contentLengthHeader: string | undefined) => {
  if (!contentLengthHeader) {
    return
  }

  const contentLength = Number(contentLengthHeader)
  if (!Number.isFinite(contentLength) || contentLength <= 0) {
    throw new HTTPException(400, {
      message: "Avatar upload request has an invalid Content-Length header."
    })
  }

  if (contentLength > avatarUploadRequestLimitBytes) {
    throw createAvatarUploadRequestLimitError({
      actualBytes: contentLength,
      source: "content-length"
    })
  }
}

const readDeleteAvatarImageUrl = async (request: Request) => {
  if (request.body === null || request.headers.get("content-length") === "0") {
    return null
  }

  const contentType = request.headers.get("content-type")?.toLowerCase()
  if (!contentType?.includes(deleteAvatarJsonContentType)) {
    throw new HTTPException(400, {
      message: "Avatar delete request body must use application/json."
    })
  }

  let body: unknown

  try {
    body = await request.json()
  } catch {
    throw new HTTPException(400, {
      message: "Avatar delete request body must be valid JSON."
    })
  }

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new HTTPException(400, {
      message: "Avatar delete request body must include an image URL."
    })
  }

  const imageUrl = (body as DeleteAvatarRequestBody).imageUrl
  if (typeof imageUrl !== "string" || !imageUrl.trim()) {
    throw new HTTPException(400, {
      message: "Avatar delete image URL must be a non-empty string."
    })
  }

  return imageUrl.trim()
}

export const registerAvatarRoutes = (app: Hono<AppBindings>) => {
  app.get("/api/account/avatar", async (c) => {
    const { userId } = await resolveAuthenticatedRequest(c.req.raw.headers)
    const avatars = await listAvatarFiles(userId)

    return c.json({ avatars })
  })

  app.post(
    "/api/account/avatar",
    bodyLimit({
      maxSize: avatarUploadRequestLimitBytes,
      onError: () => {
        throw createAvatarUploadRequestLimitError({ source: "body-limit" })
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

      assertUploadContentLength(c.req.header("content-length"))

      const formData = await c.req.formData()
      const file = formData.get("file")
      if (!(file instanceof File)) {
        throw new HTTPException(400, {
          message: "Avatar upload requires a file."
        })
      }

      const { imageUrl } = await uploadAvatarFile(userId, file)

      return c.json({ imageUrl })
    }
  )

  app.delete("/api/account/avatar", async (c) => {
    const { userId } = await resolveAuthenticatedRequest(c.req.raw.headers)
    const imageUrl = await readDeleteAvatarImageUrl(c.req.raw)

    if (imageUrl) {
      await deleteAvatarFile(userId, imageUrl)
    } else {
      await deleteAllAvatarFiles(userId)
    }

    return c.json({ success: true })
  })
}
