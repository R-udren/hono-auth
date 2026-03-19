import {
	DeleteObjectCommand,
	HeadObjectCommand,
	ListObjectsV2Command,
	PutObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3"
import { Transformer } from "@napi-rs/image"
import { fileTypeFromBuffer } from "file-type"
import { HTTPException } from "hono/http-exception"
import { createHash } from "node:crypto"

import { env } from "@/lib/env"

const avatarInputMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"])
const avatarOutputExtension = "webp"
const avatarOutputMimeType = "image/webp"
const avatarOutputMaxDimension = 512
const avatarOutputQuality = 80
const avatarHashLength = 12
const avatarMaxObjectsPerUser = 5
const managedAvatarKeyPattern = new RegExp(
	`^users/[^/]+/[0-9a-f]{${avatarHashLength}}\\.${avatarOutputExtension}$`,
)

const avatarStorageEnabled
	= Boolean(env.AVATAR_S3_BUCKET)
		&& Boolean(env.AVATAR_S3_ENDPOINT)
		&& Boolean(env.AVATAR_PUBLIC_BASE_URL)
		&& Boolean(env.AVATAR_S3_ACCESS_KEY_ID)
		&& Boolean(env.AVATAR_S3_SECRET_ACCESS_KEY)

const ensureTrailingSlash = (value: string) => (value.endsWith("/") ? value : `${value}/`)

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

const parseUrl = (value: string) => {
	try {
		return new URL(value)
	}
	catch {
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

const getManagedAvatarObjectKey = (imageUrl: string | null | undefined) => {
	if (!imageUrl || !baseAvatarUrl) {
		return null
	}

	const avatarUrl = parseUrl(imageUrl)
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
	return isManagedAvatarObjectKey(objectKey) ? objectKey : null
}

const getOwnedManagedAvatarObjectKey = (userId: string, imageUrl: string | null | undefined) => {
	const objectKey = getManagedAvatarObjectKey(imageUrl)
	if (!objectKey) {
		return null
	}

	if (!objectKey.startsWith(getAvatarObjectKeyPrefix(userId))) {
		throw new HTTPException(403, {
			message: "You can only manage your own avatar images.",
		})
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

	if (metadata.width > avatarOutputMaxDimension || metadata.height > avatarOutputMaxDimension) {
		transformer.resize(avatarOutputMaxDimension, avatarOutputMaxDimension)
	}

	let body: Uint8Array
	try {
		body = await transformer.webp(avatarOutputQuality)
	}
	catch {
		throw createInvalidAvatarFileError("Avatar file could not be normalized safely.")
	}

	assertAvatarFileSize(body.byteLength)

	return {
		body,
		contentType: avatarOutputMimeType,
		hash: hashAvatarBytes(body),
	}
}

const isMissingObjectError = (error: unknown) => {
	if (!(error instanceof Error)) {
		return false
	}

	if (error.name === "NotFound" || error.name === "NoSuchKey") {
		return true
	}

	const metadata = Reflect.get(error, "$metadata")
	return typeof metadata === "object" && metadata !== null
		&& Reflect.get(metadata, "httpStatusCode") === 404
}

const objectExists = async (client: S3Client, objectKey: string) => {
	try {
		await client.send(
			new HeadObjectCommand({
				Bucket: env.AVATAR_S3_BUCKET,
				Key: objectKey,
			}),
		)
		return true
	}
	catch (error) {
		if (isMissingObjectError(error)) {
			return false
		}

		throw error
	}
}

const assertAvatarObjectLimit = async (
	client: S3Client,
	userId: string,
	currentObjectKey: string | null,
	nextObjectKey: string,
) => {
	const response = await client.send(
		new ListObjectsV2Command({
			Bucket: env.AVATAR_S3_BUCKET,
			Prefix: getAvatarObjectKeyPrefix(userId),
			MaxKeys: avatarMaxObjectsPerUser,
		}),
	)

	const objectKeys = (response.Contents ?? []).flatMap(object =>
		typeof object.Key === "string" ? [object.Key] : [],
	)
	if (objectKeys.length < avatarMaxObjectsPerUser) {
		return
	}

	if (currentObjectKey && currentObjectKey !== nextObjectKey && objectKeys.includes(currentObjectKey)) {
		return
	}

	throw new HTTPException(409, {
		message: `Avatar upload limit reached for this user (${avatarMaxObjectsPerUser}).`,
	})
}

export const validateAvatarImage = (image: unknown) => {
	if (image == null || image === "") {
		return
	}

	if (typeof image !== "string") {
		throw new HTTPException(400, {
			message: "Avatar image must be a valid URL.",
		})
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
	if (!avatarUrl || (avatarUrl.protocol !== "http:" && avatarUrl.protocol !== "https:")) {
		throw new HTTPException(400, {
			message: "Avatar image must be a valid HTTP or HTTPS URL.",
		})
	}
}

export const deleteAvatarFile = async (userId: string, imageUrl: string) => {
	const objectKey = getOwnedManagedAvatarObjectKey(userId, imageUrl)
	if (!objectKey) {
		return
	}

	const { client } = assertAvatarStorageEnabled()
	await client.send(
		new DeleteObjectCommand({
			Bucket: env.AVATAR_S3_BUCKET,
			Key: objectKey,
		}),
	)
}

export const uploadAvatarFile = async (
	userId: string,
	file: File,
	currentImageUrl: string | null,
) => {
	const { client, publicBaseUrl } = assertAvatarStorageEnabled()
	const normalizedFile = await normalizeAvatarFile(file)
	const nextObjectKey = getAvatarObjectKey(userId, normalizedFile.hash)
	const nextImageUrl = getAvatarPublicUrl(nextObjectKey, publicBaseUrl)
	const currentObjectKey = getOwnedManagedAvatarObjectKey(userId, currentImageUrl)

	if (await objectExists(client, nextObjectKey)) {
		if (currentObjectKey && currentObjectKey !== nextObjectKey) {
			await deleteAvatarFile(userId, currentImageUrl!)
		}

		return { imageUrl: nextImageUrl }
	}

	await assertAvatarObjectLimit(client, userId, currentObjectKey, nextObjectKey)
	await client.send(
		new PutObjectCommand({
			Bucket: env.AVATAR_S3_BUCKET,
			Key: nextObjectKey,
			Body: normalizedFile.body,
			ContentType: normalizedFile.contentType,
			CacheControl: "public, max-age=31536000, immutable",
		}),
	)

	if (currentObjectKey && currentObjectKey !== nextObjectKey) {
		await deleteAvatarFile(userId, currentImageUrl!)
	}

	return { imageUrl: nextImageUrl }
}

export const isManagedAvatarUrl = (imageUrl: string | null | undefined) => {
	return getManagedAvatarObjectKey(imageUrl) != null
}

export const avatarUploadRequestLimitBytes = env.AVATAR_MAX_FILE_BYTES + 256 * 1024
