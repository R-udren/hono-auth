import {
	DeleteObjectCommand,
	PutObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3"
import { Transformer } from "@napi-rs/image"
import { fileTypeFromBuffer } from "file-type"
import { HTTPException } from "hono/http-exception"

import { env } from "@/lib/env"

const avatarProtocols = new Set(["http:", "https:"])
const avatarInputMimeTypes = new Set([
	"image/jpeg",
	"image/png",
	"image/webp",
])
const avatarManagedExtensions = new Set(["jpg", "png", "webp", "gif"])
const avatarOutputExtension = "webp"
const avatarOutputMimeType = "image/webp"
const avatarOutputMaxDimension = 512
const avatarOutputQuality = 80

const avatarStorageEnabled
	= Boolean(env.AVATAR_S3_BUCKET)
		&& Boolean(env.AVATAR_S3_ENDPOINT)
		&& Boolean(env.AVATAR_PUBLIC_BASE_URL)
		&& Boolean(env.AVATAR_S3_ACCESS_KEY_ID)
		&& Boolean(env.AVATAR_S3_SECRET_ACCESS_KEY)

const ensureTrailingSlash = (value: string) => {
	return value.endsWith("/") ? value : `${value}/`
}

const baseAvatarUrl = env.AVATAR_PUBLIC_BASE_URL
	? new URL(ensureTrailingSlash(env.AVATAR_PUBLIC_BASE_URL))
	: null

const avatarStorageClient = avatarStorageEnabled
	? new S3Client({
			region: env.AVATAR_S3_REGION,
			endpoint: env.AVATAR_S3_ENDPOINT,
			forcePathStyle: env.AVATAR_S3_FORCE_PATH_STYLE,
			credentials: {
				accessKeyId: env.AVATAR_S3_ACCESS_KEY_ID!,
				secretAccessKey: env.AVATAR_S3_SECRET_ACCESS_KEY!,
			},
		})
	: null

const getAvatarObjectKeyPrefix = (userId: string) => {
	return `users/${encodeURIComponent(userId)}/`
}

const parseUrl = (value: string) => {
	try {
		return new URL(value)
	}
	catch {
		return null
	}
}

const isManagedAvatarObjectKey = (objectKey: string) => {
	const extension = objectKey.split(".").pop()?.toLowerCase()
	if (!extension || !avatarManagedExtensions.has(extension)) {
		return false
	}

	return /^users\/[^/]+\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]+$/.test(
		objectKey,
	)
}

const getAvatarObjectKeyFromUrl = (url: string) => {
	if (!baseAvatarUrl) {
		return null
	}

	const avatarUrl = parseUrl(url)
	if (!avatarUrl) {
		return null
	}

	if (avatarUrl.origin !== baseAvatarUrl.origin) {
		return null
	}

	if (!avatarUrl.pathname.startsWith(baseAvatarUrl.pathname)) {
		return null
	}

	const objectKey = avatarUrl.pathname.slice(baseAvatarUrl.pathname.length)
	if (!isManagedAvatarObjectKey(objectKey)) {
		return null
	}

	return objectKey
}

const assertAvatarStorageEnabled = () => {
	if (!avatarStorageEnabled || !avatarStorageClient || !baseAvatarUrl) {
		throw new HTTPException(501, {
			message: "Avatar uploads are not configured.",
		})
	}

	return {
		client: avatarStorageClient,
		publicBaseUrl: baseAvatarUrl,
	}
}

const createInvalidAvatarFileError = (message: string) => {
	return new HTTPException(400, { message })
}

const assertAvatarFileSize = (fileSize: number) => {
	if (fileSize === 0) {
		throw createInvalidAvatarFileError("Avatar file cannot be empty.")
	}

	if (fileSize > env.AVATAR_MAX_FILE_BYTES) {
		throw createInvalidAvatarFileError(
			`Avatar file exceeds the ${env.AVATAR_MAX_FILE_BYTES} byte limit.`,
		)
	}
}

const assertAvatarDimensions = (width: number, height: number) => {
	if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
		throw createInvalidAvatarFileError("Avatar image dimensions are invalid.")
	}

	if (width > env.AVATAR_MAX_IMAGE_DIMENSION || height > env.AVATAR_MAX_IMAGE_DIMENSION) {
		throw createInvalidAvatarFileError(
			`Avatar image dimensions exceed the ${env.AVATAR_MAX_IMAGE_DIMENSION}px limit.`,
		)
	}

	if (width * height > env.AVATAR_MAX_IMAGE_PIXELS) {
		throw createInvalidAvatarFileError(
			`Avatar image exceeds the ${env.AVATAR_MAX_IMAGE_PIXELS} pixel limit.`,
		)
	}
}

const normalizeAvatarFile = async (file: File) => {
	assertAvatarFileSize(file.size)

	const inputBytes = new Uint8Array(await file.arrayBuffer())
	const detectedFileType = await fileTypeFromBuffer(inputBytes)

	if (!detectedFileType || !avatarInputMimeTypes.has(detectedFileType.mime)) {
		throw createInvalidAvatarFileError(
			"Avatar file must be a JPEG, PNG, or WebP image.",
		)
	}

	if (file.type && file.type !== detectedFileType.mime) {
		throw createInvalidAvatarFileError(
			"Avatar file content does not match the declared file type.",
		)
	}

	let transformer: Transformer
	try {
		transformer = new Transformer(inputBytes)
	}
	catch {
		throw createInvalidAvatarFileError("Avatar file could not be decoded as an image.")
	}

	let metadata: Awaited<ReturnType<Transformer["metadata"]>>
	try {
		metadata = await transformer.metadata(true)
	}
	catch {
		throw createInvalidAvatarFileError("Avatar file could not be decoded as an image.")
	}

	assertAvatarDimensions(metadata.width, metadata.height)
	transformer.rotate()

	if (
		metadata.width > avatarOutputMaxDimension
		|| metadata.height > avatarOutputMaxDimension
	) {
		transformer.resize(avatarOutputMaxDimension, avatarOutputMaxDimension)
	}

	let normalizedBytes: Uint8Array
	try {
		normalizedBytes = await transformer.webp(avatarOutputQuality)
	}
	catch {
		throw createInvalidAvatarFileError("Avatar file could not be normalized safely.")
	}

	assertAvatarFileSize(normalizedBytes.byteLength)

	return {
		body: normalizedBytes,
		contentType: avatarOutputMimeType,
		extension: avatarOutputExtension,
	}
}

export const validateAvatarImage = (image: unknown) => {
	if (image == null) {
		return
	}

	if (typeof image !== "string") {
		throw new HTTPException(400, {
			message: "Avatar image must be a valid URL.",
		})
	}

	if (image.length === 0) {
		return
	}

	if (image.startsWith("data:")) {
		throw new HTTPException(400, {
			message: "Avatar image must be a hosted URL, not an inline data URI.",
		})
	}

	if (image.length > 2048) {
		throw new HTTPException(400, {
			message: "Avatar image URL is too long.",
		})
	}

	const avatarUrl = parseUrl(image)
	if (!avatarUrl || !avatarProtocols.has(avatarUrl.protocol)) {
		throw new HTTPException(400, {
			message: "Avatar image must be a valid HTTP or HTTPS URL.",
		})
	}
}

export const uploadAvatarFile = async (userId: string, file: File) => {
	const { client, publicBaseUrl } = assertAvatarStorageEnabled()
	const normalizedFile = await normalizeAvatarFile(file)
	const objectKey
		= `${getAvatarObjectKeyPrefix(userId)}${crypto.randomUUID()}.${normalizedFile.extension}`

	await client.send(
		new PutObjectCommand({
			Bucket: env.AVATAR_S3_BUCKET,
			Key: objectKey,
			Body: normalizedFile.body,
			ContentType: normalizedFile.contentType,
			CacheControl: "public, max-age=31536000, immutable",
		}),
	)

	return new URL(objectKey, publicBaseUrl).toString()
}

export const deleteAvatarFile = async (userId: string, imageUrl: string) => {
	const objectKey = getAvatarObjectKeyFromUrl(imageUrl)

	if (!objectKey) {
		return
	}

	const { client } = assertAvatarStorageEnabled()

	if (!objectKey.startsWith(getAvatarObjectKeyPrefix(userId))) {
		throw new HTTPException(403, {
			message: "You can only delete your own avatar images.",
		})
	}

	await client.send(
		new DeleteObjectCommand({
			Bucket: env.AVATAR_S3_BUCKET,
			Key: objectKey,
		}),
	)
}

export const isManagedAvatarUrl = (imageUrl: string | null | undefined) => {
	if (!imageUrl || !baseAvatarUrl) {
		return false
	}

	return getAvatarObjectKeyFromUrl(imageUrl) != null
}

export const avatarUploadRequestLimitBytes = env.AVATAR_MAX_FILE_BYTES + 256 * 1024
