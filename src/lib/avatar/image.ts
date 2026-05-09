import { Transformer } from "@napi-rs/image"
import { fileTypeFromBuffer } from "file-type"

import {
  avatarInputMimeTypes,
  avatarOutputMaxDimension,
  avatarOutputMimeType,
  avatarOutputQuality
} from "@/lib/avatar/constants"
import {
  assertAvatarDimensions,
  assertAvatarFileSize,
  createInvalidAvatarFileError,
  formatByteCount
} from "@/lib/avatar/errors"
import { logger } from "@/lib/logger"

export type NormalizedAvatarFile = {
  body: Uint8Array
  contentType: string
}

const readFileBytes = async (file: File) => {
  assertAvatarFileSize(file.size, "file-size")

  const bytes = new Uint8Array(await file.arrayBuffer())
  if (file.size !== bytes.byteLength) {
    logger.warn(
      {
        actualBytes: bytes.byteLength,
        actualSize: formatByteCount(bytes.byteLength),
        declaredBytes: file.size,
        declaredSize: formatByteCount(file.size)
      },
      "Avatar upload file size does not match parsed buffer size"
    )
  }

  assertAvatarFileSize(bytes.byteLength, "array-buffer")
  return bytes
}

const assertFileTypeMatches = async (bytes: Uint8Array, declaredMimeType: string) => {
  const detectedFileType = await fileTypeFromBuffer(bytes)

  if (!detectedFileType || !avatarInputMimeTypes.has(detectedFileType.mime)) {
    throw createInvalidAvatarFileError("Avatar file must be a JPEG, PNG, or WebP image.")
  }

  if (declaredMimeType && declaredMimeType !== detectedFileType.mime) {
    throw createInvalidAvatarFileError("Avatar file content does not match the declared file type.")
  }
}

const createTransformer = (bytes: Uint8Array) => {
  try {
    return new Transformer(bytes)
  } catch {
    throw createInvalidAvatarFileError("Avatar file could not be decoded as an image.")
  }
}

const readImageMetadata = async (transformer: Transformer) => {
  try {
    return await transformer.metadata(true)
  } catch {
    throw createInvalidAvatarFileError("Avatar file could not be decoded as an image.")
  }
}

const writeWebp = async (transformer: Transformer) => {
  try {
    return await transformer.webp(avatarOutputQuality)
  } catch {
    throw createInvalidAvatarFileError("Avatar file could not be normalized safely.")
  }
}

export const normalizeAvatarFile = async (file: File): Promise<NormalizedAvatarFile> => {
  const inputBytes = await readFileBytes(file)
  await assertFileTypeMatches(inputBytes, file.type)

  const transformer = createTransformer(inputBytes)
  const metadata = await readImageMetadata(transformer)

  assertAvatarDimensions(metadata.width, metadata.height)
  transformer.rotate()

  if (metadata.width > avatarOutputMaxDimension || metadata.height > avatarOutputMaxDimension) {
    transformer.resize(avatarOutputMaxDimension, avatarOutputMaxDimension)
  }

  const outputBytes = await writeWebp(transformer)
  assertAvatarFileSize(outputBytes.byteLength, "normalized-output")

  return {
    body: outputBytes,
    contentType: avatarOutputMimeType
  }
}
