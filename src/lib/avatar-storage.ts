import { createHash } from "node:crypto"

import { HTTPException } from "hono/http-exception"

import {
  DeleteObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3"
import { Transformer } from "@napi-rs/image"
import { fileTypeFromBuffer } from "file-type"

import { env } from "@/lib/env"
import { logger } from "@/lib/logger"

const avatarInputMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"])
const avatarOutputExtension = "webp"
const avatarOutputMimeType = "image/webp"
const avatarOutputMaxDimension = 512
const avatarOutputQuality = 80
const avatarHashLength = 12
const managedAvatarKeyPattern = new RegExp(
  `^users/[^/]+/[0-9a-f]{${avatarHashLength}}\\.${avatarOutputExtension}$`
)

const getAvatarStorageConfig = () => {
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

const avatarStorageConfig = getAvatarStorageConfig()

const ensureTrailingSlash = (value: string) => (value.endsWith("/") ? value : `${value}/`)

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

const parseUrl = (value: string) => {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

const createInvalidAvatarFileError = (message: string) => new HTTPException(400, { message })

const getAvatarObjectKeyPrefix = (userId: string) => `users/${encodeURIComponent(userId)}/`

const getAvatarObjectKey = (userId: string, hash: string) => {
  return `${getAvatarObjectKeyPrefix(userId)}${hash}.${avatarOutputExtension}`
}

const getAvatarPublicUrl = (objectKey: string, publicBaseUrl: URL) => {
  return new URL(objectKey, publicBaseUrl).toString()
}

const isManagedAvatarObjectKey = (objectKey: string) => managedAvatarKeyPattern.test(objectKey)

const getAvatarStorage = () => {
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

const assertAvatarFileSize = (fileSize: number) => {
  if (fileSize === 0) {
    throw createInvalidAvatarFileError("Avatar file cannot be empty.")
  }

  if (fileSize > env.AVATAR_MAX_FILE_BYTES) {
    throw createInvalidAvatarFileError(
      `Avatar file exceeds the ${env.AVATAR_MAX_FILE_BYTES} byte limit.`
    )
  }
}

const assertAvatarDimensions = (width: number, height: number) => {
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

const hashAvatarBytes = (bytes: Uint8Array) => {
  return createHash("sha256").update(bytes).digest("hex").slice(0, avatarHashLength)
}

const normalizeAvatarFile = async (file: File) => {
  assertAvatarFileSize(file.size)

  const inputBytes = new Uint8Array(await file.arrayBuffer())
  const detectedFileType = await fileTypeFromBuffer(inputBytes)

  if (!detectedFileType || !avatarInputMimeTypes.has(detectedFileType.mime)) {
    throw createInvalidAvatarFileError("Avatar file must be a JPEG, PNG, or WebP image.")
  }

  if (file.type && file.type !== detectedFileType.mime) {
    throw createInvalidAvatarFileError("Avatar file content does not match the declared file type.")
  }

  let transformer: Transformer
  try {
    transformer = new Transformer(inputBytes)
  } catch {
    throw createInvalidAvatarFileError("Avatar file could not be decoded as an image.")
  }

  let metadata: Awaited<ReturnType<Transformer["metadata"]>>
  try {
    metadata = await transformer.metadata(true)
  } catch {
    throw createInvalidAvatarFileError("Avatar file could not be decoded as an image.")
  }

  assertAvatarDimensions(metadata.width, metadata.height)
  transformer.rotate()

  if (metadata.width > avatarOutputMaxDimension || metadata.height > avatarOutputMaxDimension) {
    transformer.resize(avatarOutputMaxDimension, avatarOutputMaxDimension)
  }

  let outputBytes: Uint8Array
  try {
    outputBytes = await transformer.webp(avatarOutputQuality)
  } catch {
    throw createInvalidAvatarFileError("Avatar file could not be normalized safely.")
  }

  assertAvatarFileSize(outputBytes.byteLength)

  return {
    body: outputBytes,
    contentType: avatarOutputMimeType,
    hash: hashAvatarBytes(outputBytes)
  }
}

const listManagedAvatarObjectKeys = async (client: S3Client, bucket: string, userId: string) => {
  const objectKeys: string[] = []
  let continuationToken: string | undefined

  while (true) {
    const response = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: getAvatarObjectKeyPrefix(userId),
        ContinuationToken: continuationToken
      })
    )

    for (const object of response.Contents ?? []) {
      if (typeof object.Key !== "string") {
        continue
      }

      if (!isManagedAvatarObjectKey(object.Key)) {
        continue
      }

      objectKeys.push(object.Key)
    }

    if (!response.IsTruncated || !response.NextContinuationToken) {
      return objectKeys
    }

    continuationToken = response.NextContinuationToken
  }
}

const deleteObjectKeys = async (client: S3Client, bucket: string, objectKeys: string[]) => {
  if (objectKeys.length === 0) {
    return
  }

  await Promise.all(
    objectKeys.map((objectKey) =>
      client.send(
        new DeleteObjectCommand({
          Bucket: bucket,
          Key: objectKey
        })
      )
    )
  )
}

const getAvatarStorageErrorDetails = (error: unknown) => {
  if (typeof error !== "object" || error === null) {
    return { error }
  }

  const errorRecord = error as Record<string, unknown>
  const metadata = errorRecord.$metadata as Record<string, unknown> | undefined

  return {
    code: errorRecord.Code ?? errorRecord.code,
    httpStatusCode: metadata?.httpStatusCode,
    message: errorRecord.message,
    name: errorRecord.name,
    requestId: metadata?.requestId
  }
}

const assertPublicAvatarUrlExists = async (imageUrl: string) => {
  let response: Response
  try {
    response = await fetch(imageUrl, { method: "HEAD" })
  } catch (error) {
    logger.error({ error, imageUrl }, "Public avatar URL is not reachable")

    throw new HTTPException(502, {
      cause: error,
      message: "Avatar upload failed."
    })
  }

  if (response.ok) {
    return
  }

  logger.error(
    { imageUrl, status: response.status },
    "Public avatar URL returned a non-success status"
  )

  throw new HTTPException(502, {
    message: "Avatar upload failed."
  })
}

export const validateAvatarImage = (image: unknown) => {
  if (image == null || image === "") {
    return
  }

  if (typeof image !== "string") {
    throw new HTTPException(400, {
      message: "Avatar image must be a valid URL."
    })
  }

  if (image.startsWith("data:")) {
    throw new HTTPException(400, {
      message: "Avatar image must be a hosted URL, not an inline data URI."
    })
  }

  if (image.length > 2048) {
    throw new HTTPException(400, {
      message: "Avatar image URL is too long."
    })
  }

  const avatarUrl = parseUrl(image)
  if (!avatarUrl || (avatarUrl.protocol !== "http:" && avatarUrl.protocol !== "https:")) {
    throw new HTTPException(400, {
      message: "Avatar image must be a valid HTTP or HTTPS URL."
    })
  }
}

export const deleteAllAvatarFiles = async (userId: string) => {
  const { bucket, client } = getAvatarStorage()
  const objectKeys = await listManagedAvatarObjectKeys(client, bucket, userId)
  await deleteObjectKeys(client, bucket, objectKeys)
}

export const listAvatarFiles = async (userId: string) => {
  const { bucket, client, publicBaseUrl } = getAvatarStorage()
  const objectKeys = await listManagedAvatarObjectKeys(client, bucket, userId)

  return objectKeys.map((objectKey) => ({
    imageUrl: getAvatarPublicUrl(objectKey, publicBaseUrl)
  }))
}

export const uploadAvatarFile = async (userId: string, file: File) => {
  const { bucket, client, publicBaseUrl } = getAvatarStorage()
  const normalizedFile = await normalizeAvatarFile(file)
  const nextObjectKey = getAvatarObjectKey(userId, normalizedFile.hash)
  const nextImageUrl = getAvatarPublicUrl(nextObjectKey, publicBaseUrl)

  const existingObjectKeys = await listManagedAvatarObjectKeys(client, bucket, userId)
  const staleObjectKeys = existingObjectKeys.filter((objectKey) => objectKey !== nextObjectKey)

  try {
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: nextObjectKey,
        Body: normalizedFile.body,
        ContentType: normalizedFile.contentType,
        CacheControl: "public, max-age=31536000, immutable"
      })
    )
  } catch (error) {
    logger.error(
      { bucket, objectKey: nextObjectKey, storageError: getAvatarStorageErrorDetails(error) },
      "Avatar upload S3 write failed"
    )

    throw new HTTPException(502, {
      cause: error,
      message: "Avatar upload failed."
    })
  }

  await assertPublicAvatarUrlExists(nextImageUrl)

  await deleteObjectKeys(client, bucket, staleObjectKeys)

  return { imageUrl: nextImageUrl }
}

export const avatarUploadRequestLimitBytes = env.AVATAR_MAX_FILE_BYTES + 256 * 1024
