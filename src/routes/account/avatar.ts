import type { Hono } from "hono"
import { bodyLimit } from "hono/body-limit"
import { HTTPException } from "hono/http-exception"

import type { AppBindings } from "@/lib/app-bindings"
import {
  avatarUploadRequestLimitBytes,
  deleteAllAvatarFiles,
  uploadAvatarFile
} from "@/lib/avatar-storage"
import { resolveAuthenticatedRequest } from "@/lib/request-auth"

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
    throw new HTTPException(413, {
      message: `Avatar upload request exceeds the ${avatarUploadRequestLimitBytes} byte limit.`
    })
  }
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
    await deleteAllAvatarFiles(userId)

    return c.json({ success: true })
  })
}
