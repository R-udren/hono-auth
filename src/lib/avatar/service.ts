import { HTTPException } from "hono/http-exception"

import { getAvatarStorage } from "@/lib/avatar/config"
import { avatarMaxStoredFiles } from "@/lib/avatar/constants"
import { normalizeAvatarFile } from "@/lib/avatar/image"
import {
  deleteObjectKeys,
  listManagedAvatarObjects,
  type ManagedAvatarObject,
  putAvatarObject
} from "@/lib/avatar/s3"
import {
  createAvatarObjectId,
  getAvatarObjectKey,
  getAvatarPublicUrl,
  getManagedAvatarObjectKeyFromPublicUrl,
  parseUrl
} from "@/lib/avatar/urls"
import { logger } from "@/lib/logger"

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

const getAvatarObjectKeysToDeleteAfterUpload = (
  existingObjects: ManagedAvatarObject[],
  nextObjectKey: string
) => {
  const retainedObjects = sortAvatarObjectsByOldest(existingObjects).filter(
    (object) => object.objectKey !== nextObjectKey
  )
  const overflowCount = retainedObjects.length + 1 - avatarMaxStoredFiles

  return overflowCount > 0
    ? retainedObjects.slice(0, overflowCount).map((object) => object.objectKey)
    : []
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
  const storage = getAvatarStorage()
  const objects = await listManagedAvatarObjects(storage, userId)
  await deleteObjectKeys(
    storage,
    objects.map((object) => object.objectKey)
  )
}

export const deleteAvatarFile = async (userId: string, imageUrl: string) => {
  const storage = getAvatarStorage()
  const objectKey = getManagedAvatarObjectKeyFromPublicUrl(userId, imageUrl, storage.publicBaseUrl)

  if (!objectKey) {
    logger.debug({ imageUrl, userId }, "Avatar storage delete skipped for unmanaged URL")
    return
  }

  await deleteObjectKeys(storage, [objectKey])
}

export const listAvatarFiles = async (userId: string) => {
  const storage = getAvatarStorage()
  const objects = await listManagedAvatarObjects(storage, userId)

  return sortAvatarObjectsByNewest(objects)
    .slice(0, avatarMaxStoredFiles)
    .map((object) => ({
      imageUrl: getAvatarPublicUrl(object.objectKey, storage.publicBaseUrl)
    }))
}

export const uploadAvatarFile = async (userId: string, file: File) => {
  const storage = getAvatarStorage()
  const normalizedFile = await normalizeAvatarFile(file)
  const nextObjectKey = getAvatarObjectKey(userId, createAvatarObjectId())
  const nextImageUrl = getAvatarPublicUrl(nextObjectKey, storage.publicBaseUrl)

  await putAvatarObject(storage, nextObjectKey, nextImageUrl, normalizedFile)

  const existingObjects = await listManagedAvatarObjects(storage, userId)
  const staleObjectKeys = getAvatarObjectKeysToDeleteAfterUpload(existingObjects, nextObjectKey)
  await deleteObjectKeys(storage, staleObjectKeys)

  return { imageUrl: nextImageUrl }
}
