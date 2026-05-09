import { randomBytes } from "node:crypto"

import {
  avatarObjectIdLength,
  avatarOutputExtension,
  managedAvatarKeyPattern
} from "@/lib/avatar/constants"

export const ensureTrailingSlash = (value: string) => (value.endsWith("/") ? value : `${value}/`)

export const parseUrl = (value: string) => {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

export const createAvatarObjectId = () => {
  return randomBytes(avatarObjectIdLength / 2).toString("hex")
}

export const getAvatarObjectKeyPrefix = (userId: string) => `users/${encodeURIComponent(userId)}/`

export const getAvatarObjectKey = (userId: string, objectId: string) => {
  return `${getAvatarObjectKeyPrefix(userId)}${objectId}.${avatarOutputExtension}`
}

export const getAvatarPublicUrl = (objectKey: string, publicBaseUrl: URL) => {
  return new URL(objectKey, publicBaseUrl).toString()
}

export const isManagedAvatarObjectKey = (objectKey: string) => {
  return managedAvatarKeyPattern.test(objectKey)
}

export const getManagedAvatarObjectKeyFromPublicUrl = (
  userId: string,
  imageUrl: string,
  publicBaseUrl: URL
) => {
  const avatarUrl = parseUrl(imageUrl)
  if (!avatarUrl || avatarUrl.origin !== publicBaseUrl.origin) {
    return null
  }

  const basePath = ensureTrailingSlash(publicBaseUrl.pathname)
  if (!avatarUrl.pathname.startsWith(basePath)) {
    return null
  }

  const objectKey = avatarUrl.pathname.slice(basePath.length)
  if (!objectKey.startsWith(getAvatarObjectKeyPrefix(userId))) {
    return null
  }

  return isManagedAvatarObjectKey(objectKey) ? objectKey : null
}
