import { HTTPException } from "hono/http-exception"

import { bytesPerKibibyte, bytesPerMebibyte } from "@/lib/avatar/constants"
import { env } from "@/lib/env"
import { logger } from "@/lib/logger"

export const formatByteCount = (bytes: number) => {
  if (bytes >= bytesPerMebibyte) {
    const mebibytes = bytes / bytesPerMebibyte
    return `${Number.isInteger(mebibytes) ? mebibytes : mebibytes.toFixed(1)} MiB`
  }

  if (bytes >= bytesPerKibibyte) {
    const kibibytes = bytes / bytesPerKibibyte
    return `${Number.isInteger(kibibytes) ? kibibytes : kibibytes.toFixed(1)} KiB`
  }

  return bytes === 1 ? "1 byte" : `${bytes} bytes`
}

export const createInvalidAvatarFileError = (message: string) => new HTTPException(400, { message })

const logAvatarUploadLimitExceeded = (options: {
  actualBytes?: number
  limitBytes: number
  scope: "file" | "request"
  source: string
}) => {
  logger.warn(
    {
      actualBytes: options.actualBytes,
      actualSize: options.actualBytes == null ? undefined : formatByteCount(options.actualBytes),
      limitBytes: options.limitBytes,
      limitSize: formatByteCount(options.limitBytes),
      scope: options.scope,
      source: options.source
    },
    "Avatar upload exceeded size limit"
  )
}

export const createAvatarUploadLimitError = (
  scope: "file" | "request",
  bytes: number,
  options: { actualBytes?: number; source: string }
) => {
  logAvatarUploadLimitExceeded({
    actualBytes: options.actualBytes,
    limitBytes: bytes,
    scope,
    source: options.source
  })

  return new HTTPException(413, {
    message: `Avatar upload ${scope} exceeds ${formatByteCount(bytes)} limit.`
  })
}

export const assertAvatarFileSize = (fileSize: number, source: string) => {
  if (fileSize === 0) {
    throw createInvalidAvatarFileError("Avatar file cannot be empty.")
  }

  if (fileSize > env.AVATAR_MAX_FILE_BYTES) {
    throw createAvatarUploadLimitError("file", env.AVATAR_MAX_FILE_BYTES, {
      actualBytes: fileSize,
      source
    })
  }
}

export const assertAvatarDimensions = (width: number, height: number) => {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw createInvalidAvatarFileError("Avatar image dimensions are invalid.")
  }

  if (width > env.AVATAR_MAX_IMAGE_DIMENSION || height > env.AVATAR_MAX_IMAGE_DIMENSION) {
    throw createInvalidAvatarFileError(
      `Avatar image dimensions exceed the ${env.AVATAR_MAX_IMAGE_DIMENSION}px limit.`
    )
  }

  if (width * height > env.AVATAR_MAX_IMAGE_PIXELS) {
    throw createInvalidAvatarFileError(
      `Avatar image exceeds the ${env.AVATAR_MAX_IMAGE_PIXELS} pixel limit.`
    )
  }
}

export const avatarUploadRequestLimitBytes = env.AVATAR_MAX_FILE_BYTES + 256 * 1024

export const createAvatarUploadRequestLimitError = (options?: {
  actualBytes?: number
  source?: string
}) => {
  return createAvatarUploadLimitError("request", avatarUploadRequestLimitBytes, {
    actualBytes: options?.actualBytes,
    source: options?.source ?? "request-limit"
  })
}
