import { createHash } from "node:crypto"

import { HTTPException } from "hono/http-exception"

import {
  DeleteObjectCommand,
  type ListObjectsV2CommandOutput,
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
const avatarMaxStoredFiles = 3
const avatarStorageErrorResponsePreviewBytes = 2048
const bytesPerKibibyte = 1024
const bytesPerMebibyte = bytesPerKibibyte * 1024
const managedAvatarKeyPattern = new RegExp(
  `^users/[^/]+/[0-9a-f]{${avatarHashLength}}\\.${avatarOutputExtension}$`
)

type ManagedAvatarObject = {
  lastModified: Date | null
  objectKey: string
}

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

const parseUrl = (value: string) => {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

const createInvalidAvatarFileError = (message: string) => new HTTPException(400, { message })

const formatByteCount = (bytes: number) => {
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

const createAvatarUploadLimitError = (
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

const assertAvatarFileSize = (fileSize: number, source: string) => {
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
  assertAvatarFileSize(file.size, "file-size")

  const inputBytes = new Uint8Array(await file.arrayBuffer())

  if (file.size !== inputBytes.byteLength) {
    logger.warn(
      {
        actualBytes: inputBytes.byteLength,
        actualSize: formatByteCount(inputBytes.byteLength),
        declaredBytes: file.size,
        declaredSize: formatByteCount(file.size)
      },
      "Avatar upload file size does not match parsed buffer size"
    )
  }

  assertAvatarFileSize(inputBytes.byteLength, "array-buffer")

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

  assertAvatarFileSize(outputBytes.byteLength, "normalized-output")

  return {
    body: outputBytes,
    contentType: avatarOutputMimeType,
    hash: hashAvatarBytes(outputBytes)
  }
}

const getAvatarObjectModifiedTime = (object: ManagedAvatarObject) => {
  return object.lastModified?.getTime() ?? 0
}

const sortAvatarObjectsByNewest = (objects: ManagedAvatarObject[]) => {
  return [...objects].toSorted(
    (a, b) => getAvatarObjectModifiedTime(b) - getAvatarObjectModifiedTime(a)
  )
}

const sortAvatarObjectsByOldest = (objects: ManagedAvatarObject[]) => {
  return [...objects].toSorted(
    (a, b) => getAvatarObjectModifiedTime(a) - getAvatarObjectModifiedTime(b)
  )
}

const listManagedAvatarObjects = async (client: S3Client, bucket: string, userId: string) => {
  const objects: ManagedAvatarObject[] = []
  let continuationToken: string | undefined

  while (true) {
    const prefix = getAvatarObjectKeyPrefix(userId)
    let response: ListObjectsV2CommandOutput

    try {
      logger.debug(
        { bucket, continuationToken: Boolean(continuationToken), prefix },
        "Avatar storage list starting"
      )

      response = await client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken
        })
      )

      logger.debug(
        {
          bucket,
          isTruncated: response.IsTruncated,
          keyCount: response.KeyCount,
          metadata: getAvatarStorageResponseMetadata(response),
          prefix
        },
        "Avatar storage list completed"
      )
    } catch (error) {
      logger.error(
        {
          bucket,
          prefix,
          storageError: await getAvatarStorageErrorLogDetails(error)
        },
        "Avatar storage list failed"
      )

      throw new HTTPException(502, {
        cause: error,
        message: "Avatar storage list failed."
      })
    }

    for (const object of response.Contents ?? []) {
      if (typeof object.Key !== "string") {
        continue
      }

      if (!isManagedAvatarObjectKey(object.Key)) {
        continue
      }

      objects.push({
        lastModified: object.LastModified ?? null,
        objectKey: object.Key
      })
    }

    if (!response.IsTruncated || !response.NextContinuationToken) {
      return objects
    }

    continuationToken = response.NextContinuationToken
  }
}

const deleteObjectKeys = async (client: S3Client, bucket: string, objectKeys: string[]) => {
  if (objectKeys.length === 0) {
    return
  }

  await Promise.all(
    objectKeys.map(async (objectKey) =>
      client
        .send(
          new DeleteObjectCommand({
            Bucket: bucket,
            Key: objectKey
          })
        )
        .then((response) => {
          logger.debug(
            { bucket, metadata: getAvatarStorageResponseMetadata(response), objectKey },
            "Avatar storage delete completed"
          )
        })
        .catch(async (error) => {
          logger.error(
            {
              bucket,
              objectKey,
              storageError: await getAvatarStorageErrorLogDetails(error)
            },
            "Avatar storage delete failed"
          )

          throw error
        })
    )
  )
}

const getAvatarObjectKeysToDeleteAfterUpload = (
  existingObjects: ManagedAvatarObject[],
  nextObjectKey: string
) => {
  const retainedExistingObjects = existingObjects.filter(
    (object) => object.objectKey !== nextObjectKey
  )
  const overflowCount = retainedExistingObjects.length + 1 - avatarMaxStoredFiles

  if (overflowCount <= 0) {
    return []
  }

  return sortAvatarObjectsByOldest(retainedExistingObjects)
    .slice(0, overflowCount)
    .map((object) => object.objectKey)
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

const readAvatarStorageResponsePreview = async (body: unknown) => {
  if (body == null) {
    return undefined
  }

  try {
    if (typeof body === "string") {
      return body.slice(0, avatarStorageErrorResponsePreviewBytes)
    }

    if (body instanceof Uint8Array) {
      return new TextDecoder().decode(body.slice(0, avatarStorageErrorResponsePreviewBytes))
    }

    if (body instanceof ArrayBuffer) {
      return new TextDecoder().decode(body.slice(0, avatarStorageErrorResponsePreviewBytes))
    }

    if (typeof (body as { text?: unknown }).text === "function") {
      const text = await (body as { text: () => Promise<string> }).text()
      return text.slice(0, avatarStorageErrorResponsePreviewBytes)
    }

    if (
      typeof (body as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === "function"
    ) {
      const chunks: Uint8Array[] = []
      let byteLength = 0

      for await (const chunk of body as AsyncIterable<Uint8Array | string>) {
        const bytes = typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk
        chunks.push(bytes)
        byteLength += bytes.byteLength

        if (byteLength >= avatarStorageErrorResponsePreviewBytes) {
          break
        }
      }

      const preview = new Uint8Array(Math.min(byteLength, avatarStorageErrorResponsePreviewBytes))
      let offset = 0
      for (const chunk of chunks) {
        const remainingBytes = preview.byteLength - offset
        if (remainingBytes <= 0) {
          break
        }

        preview.set(chunk.slice(0, remainingBytes), offset)
        offset += Math.min(chunk.byteLength, remainingBytes)
      }

      return new TextDecoder().decode(preview)
    }
  } catch (previewError) {
    return `Failed to read response body preview: ${String(previewError)}`
  }

  return undefined
}

const getAvatarStorageRawResponseDetails = async (error: unknown) => {
  if (typeof error !== "object" || error === null) {
    return undefined
  }

  const response = (error as { $response?: unknown }).$response
  if (typeof response !== "object" || response === null) {
    return undefined
  }

  const responseRecord = response as Record<string, unknown>
  return {
    bodyPreview: await readAvatarStorageResponsePreview(responseRecord.body),
    headers: responseRecord.headers,
    reason: responseRecord.reason,
    statusCode: responseRecord.statusCode
  }
}

const getAvatarStorageErrorLogDetails = async (error: unknown) => ({
  ...getAvatarStorageErrorDetails(error),
  rawResponse: await getAvatarStorageRawResponseDetails(error)
})

const getAvatarStorageResponseMetadata = (response: unknown) => {
  if (typeof response !== "object" || response === null) {
    return undefined
  }

  return (response as { $metadata?: unknown }).$metadata
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
  const objects = await listManagedAvatarObjects(client, bucket, userId)
  const objectKeys = objects.map((object) => object.objectKey)
  await deleteObjectKeys(client, bucket, objectKeys)
}

export const listAvatarFiles = async (userId: string) => {
  const { bucket, client, publicBaseUrl } = getAvatarStorage()
  const objects = await listManagedAvatarObjects(client, bucket, userId)

  return sortAvatarObjectsByNewest(objects)
    .slice(0, avatarMaxStoredFiles)
    .map((object) => ({
      imageUrl: getAvatarPublicUrl(object.objectKey, publicBaseUrl)
    }))
}

export const uploadAvatarFile = async (userId: string, file: File) => {
  const { bucket, client, publicBaseUrl } = getAvatarStorage()
  const normalizedFile = await normalizeAvatarFile(file)
  const nextObjectKey = getAvatarObjectKey(userId, normalizedFile.hash)
  const nextImageUrl = getAvatarPublicUrl(nextObjectKey, publicBaseUrl)

  try {
    logger.debug(
      {
        bucket,
        contentLength: normalizedFile.body.byteLength,
        contentType: normalizedFile.contentType,
        endpoint: avatarStorageConfig?.endpoint,
        forcePathStyle: env.AVATAR_S3_FORCE_PATH_STYLE,
        objectKey: nextObjectKey,
        publicBaseUrl: publicBaseUrl.toString(),
        publicUrl: nextImageUrl,
        region: env.AVATAR_S3_REGION
      },
      "Avatar upload S3 write starting"
    )

    const response = await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: nextObjectKey,
        Body: normalizedFile.body,
        ContentType: normalizedFile.contentType,
        CacheControl: "public, max-age=31536000, immutable"
      })
    )

    logger.info(
      {
        bucket,
        metadata: getAvatarStorageResponseMetadata(response),
        objectKey: nextObjectKey,
        publicUrl: nextImageUrl
      },
      "Avatar upload S3 write completed"
    )
  } catch (error) {
    logger.error(
      {
        bucket,
        endpoint: avatarStorageConfig?.endpoint,
        forcePathStyle: env.AVATAR_S3_FORCE_PATH_STYLE,
        objectKey: nextObjectKey,
        region: env.AVATAR_S3_REGION,
        storageError: await getAvatarStorageErrorLogDetails(error)
      },
      "Avatar upload S3 write failed"
    )

    throw new HTTPException(502, {
      cause: error,
      message: "Avatar upload failed."
    })
  }

  const existingObjects = await listManagedAvatarObjects(client, bucket, userId)
  const staleObjectKeys = getAvatarObjectKeysToDeleteAfterUpload(existingObjects, nextObjectKey)

  await deleteObjectKeys(client, bucket, staleObjectKeys)

  return { imageUrl: nextImageUrl }
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
