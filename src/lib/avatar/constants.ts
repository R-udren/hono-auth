export const avatarInputMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"])
export const avatarOutputExtension = "webp"
export const avatarOutputMimeType = "image/webp"
export const avatarOutputMaxDimension = 512
export const avatarOutputQuality = 80
export const avatarObjectIdLength = 12
export const avatarMaxStoredFiles = 3

export const bytesPerKibibyte = 1024
export const bytesPerMebibyte = bytesPerKibibyte * 1024

export const managedAvatarKeyPattern = new RegExp(
  `^users/[^/]+/[0-9a-f]{${avatarObjectIdLength}}\\.${avatarOutputExtension}$`
)
