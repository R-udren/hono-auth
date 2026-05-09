import { HTTPException } from "hono/http-exception"

import { S3Client } from "@aws-sdk/client-s3"

import { ensureTrailingSlash } from "@/lib/avatar/urls"
import { env } from "@/lib/env"
import { logger } from "@/lib/logger"

type AvatarStorageConfig = {
  accessKeyId: string
  bucket: string
  endpoint: string
  publicBaseUrl: string
  secretAccessKey: string
}

export type AvatarStorage = {
  bucket: string
  client: S3Client
  publicBaseUrl: URL
}

const readAvatarStorageConfig = (): AvatarStorageConfig | null => {
  const bucket = env.AVATAR_S3_BUCKET
  const endpoint = env.AVATAR_S3_ENDPOINT
  const publicBaseUrl = env.AVATAR_PUBLIC_BASE_URL
  const accessKeyId = env.AVATAR_S3_ACCESS_KEY_ID
  const secretAccessKey = env.AVATAR_S3_SECRET_ACCESS_KEY

  if (!bucket || !endpoint || !publicBaseUrl || !accessKeyId || !secretAccessKey) {
    return null
  }

  return {
    accessKeyId,
    bucket,
    endpoint,
    publicBaseUrl,
    secretAccessKey
  }
}

export const avatarStorageConfig = readAvatarStorageConfig()

const avatarPublicBaseUrl = avatarStorageConfig
  ? new URL(ensureTrailingSlash(avatarStorageConfig.publicBaseUrl))
  : null

const avatarStorageClient = avatarStorageConfig
  ? new S3Client({
      region: env.AVATAR_S3_REGION,
      endpoint: avatarStorageConfig.endpoint,
      forcePathStyle: env.AVATAR_S3_FORCE_PATH_STYLE,
      credentials: {
        accessKeyId: avatarStorageConfig.accessKeyId,
        secretAccessKey: avatarStorageConfig.secretAccessKey
      }
    })
  : null

if (avatarStorageConfig) {
  logger.info(
    {
      bucket: avatarStorageConfig.bucket,
      endpoint: avatarStorageConfig.endpoint,
      forcePathStyle: env.AVATAR_S3_FORCE_PATH_STYLE,
      publicBaseUrl: avatarStorageConfig.publicBaseUrl,
      region: env.AVATAR_S3_REGION
    },
    "Avatar storage configured"
  )
} else {
  logger.warn("Avatar storage not configured")
}

export const getAvatarStorage = (): AvatarStorage => {
  if (!avatarStorageConfig || !avatarStorageClient || !avatarPublicBaseUrl) {
    throw new HTTPException(501, {
      message: "Avatar uploads are not configured."
    })
  }

  return {
    bucket: avatarStorageConfig.bucket,
    client: avatarStorageClient,
    publicBaseUrl: avatarPublicBaseUrl
  }
}
