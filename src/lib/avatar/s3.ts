import { HTTPException } from "hono/http-exception"

import {
  DeleteObjectCommand,
  type ListObjectsV2CommandOutput,
  ListObjectsV2Command,
  PutObjectCommand
} from "@aws-sdk/client-s3"

import { type AvatarStorage, avatarStorageConfig } from "@/lib/avatar/config"
import type { NormalizedAvatarFile } from "@/lib/avatar/image"
import {
  getAvatarStorageErrorLogDetails,
  getAvatarStorageResponseMetadata
} from "@/lib/avatar/storage-log"
import { getAvatarObjectKeyPrefix, isManagedAvatarObjectKey } from "@/lib/avatar/urls"
import { env } from "@/lib/env"
import { logger } from "@/lib/logger"

export type ManagedAvatarObject = {
  lastModified: Date | null
  objectKey: string
}

export const listManagedAvatarObjects = async (storage: AvatarStorage, userId: string) => {
  const objects: ManagedAvatarObject[] = []
  const prefix = getAvatarObjectKeyPrefix(userId)
  let continuationToken: string | undefined

  while (true) {
    let response: ListObjectsV2CommandOutput

    try {
      logger.debug(
        { bucket: storage.bucket, continuationToken: Boolean(continuationToken), prefix },
        "Avatar storage list starting"
      )

      response = await storage.client.send(
        new ListObjectsV2Command({
          Bucket: storage.bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken
        })
      )

      logger.debug(
        {
          bucket: storage.bucket,
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
          bucket: storage.bucket,
          prefix,
          storageError: getAvatarStorageErrorLogDetails(error)
        },
        "Avatar storage list failed"
      )

      throw new HTTPException(502, {
        cause: error,
        message: "Avatar storage list failed."
      })
    }

    for (const object of response.Contents ?? []) {
      if (typeof object.Key !== "string" || !isManagedAvatarObjectKey(object.Key)) {
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

export const deleteObjectKeys = async (storage: AvatarStorage, objectKeys: string[]) => {
  if (objectKeys.length === 0) {
    return
  }

  await Promise.all(objectKeys.map((objectKey) => deleteObjectKey(storage, objectKey)))
}

const deleteObjectKey = async (storage: AvatarStorage, objectKey: string) => {
  try {
    const response = await storage.client.send(
      new DeleteObjectCommand({
        Bucket: storage.bucket,
        Key: objectKey
      })
    )

    logger.debug(
      {
        bucket: storage.bucket,
        metadata: getAvatarStorageResponseMetadata(response),
        objectKey
      },
      "Avatar storage delete completed"
    )
  } catch (error) {
    logger.error(
      {
        bucket: storage.bucket,
        objectKey,
        storageError: getAvatarStorageErrorLogDetails(error)
      },
      "Avatar storage delete failed"
    )

    throw error
  }
}

export const putAvatarObject = async (
  storage: AvatarStorage,
  objectKey: string,
  publicUrl: string,
  file: NormalizedAvatarFile
) => {
  try {
    logger.debug(
      {
        bucket: storage.bucket,
        contentLength: file.body.byteLength,
        contentType: file.contentType,
        endpoint: avatarStorageConfig?.endpoint,
        forcePathStyle: env.AVATAR_S3_FORCE_PATH_STYLE,
        objectKey,
        publicBaseUrl: storage.publicBaseUrl.toString(),
        publicUrl,
        region: env.AVATAR_S3_REGION
      },
      "Avatar upload S3 write starting"
    )

    const response = await storage.client.send(
      new PutObjectCommand({
        Bucket: storage.bucket,
        Key: objectKey,
        ACL: "public-read",
        Body: file.body,
        ContentType: file.contentType,
        CacheControl: "public, max-age=31536000, immutable"
      })
    )

    logger.info(
      {
        bucket: storage.bucket,
        metadata: getAvatarStorageResponseMetadata(response),
        objectKey,
        publicUrl
      },
      "Avatar upload S3 write completed"
    )
  } catch (error) {
    logger.error(
      {
        bucket: storage.bucket,
        endpoint: avatarStorageConfig?.endpoint,
        forcePathStyle: env.AVATAR_S3_FORCE_PATH_STYLE,
        objectKey,
        region: env.AVATAR_S3_REGION,
        storageError: getAvatarStorageErrorLogDetails(error)
      },
      "Avatar upload S3 write failed"
    )

    throw new HTTPException(502, {
      cause: error,
      message: "Avatar upload failed."
    })
  }
}
