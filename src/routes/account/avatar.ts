import type { Hono } from "hono"

import { bodyLimit } from "hono/body-limit"
import { HTTPException } from "hono/http-exception"

import type { AppBindings } from "@/lib/app-bindings"

import {
	avatarUploadRequestLimitBytes,
	deleteAvatarFile,
	uploadAvatarFile,
} from "@/lib/avatar-storage"
import { requireSession } from "@/lib/request-auth"

const parseAvatarDeleteBody = async (request: Request) => {
	const rawBody = await request.text()
	if (!rawBody.trim()) {
		return { imageUrl: undefined }
	}

	let parsedBody: unknown

	try {
		parsedBody = JSON.parse(rawBody)
	}
	catch {
		throw new HTTPException(400, {
			message: "Avatar delete body must be valid JSON.",
		})
	}

	if (!parsedBody || typeof parsedBody !== "object" || Array.isArray(parsedBody)) {
		throw new HTTPException(400, {
			message: "Avatar delete body must be a JSON object.",
		})
	}

	return parsedBody as { imageUrl?: unknown }
}

const assertAvatarRequestLength = (contentLengthHeader: string | undefined) => {
	if (!contentLengthHeader) {
		return
	}

	const contentLength = Number(contentLengthHeader)
	if (!Number.isFinite(contentLength) || contentLength <= 0) {
		throw new HTTPException(400, {
			message: "Avatar upload request has an invalid Content-Length header.",
		})
	}

	if (contentLength > avatarUploadRequestLimitBytes) {
		throw new HTTPException(413, {
			message: `Avatar upload request exceeds the ${avatarUploadRequestLimitBytes} byte limit.`,
		})
	}
}

export const registerAvatarRoutes = (app: Hono<AppBindings>) => {
	app.post(
		"/api/account/avatar",
		bodyLimit({
			maxSize: avatarUploadRequestLimitBytes,
			onError: () => {
				throw new HTTPException(413, {
					message: `Avatar upload request exceeds the ${avatarUploadRequestLimitBytes} byte limit.`,
				})
			},
		}),
		async (c) => {
			const contentType = c.req.header("content-type")
			if (!contentType?.toLowerCase().startsWith("multipart/form-data")) {
				throw new HTTPException(400, {
					message: "Avatar upload must use multipart/form-data.",
				})
			}

			assertAvatarRequestLength(c.req.header("content-length"))

			const session = await requireSession(c.req.raw.headers)
			const formData = await c.req.formData()
			const file = formData.get("file")

			if (!(file instanceof File)) {
				throw new HTTPException(400, {
					message: "Avatar upload requires a file.",
				})
			}

			const imageUrl = await uploadAvatarFile(session.user.id, file)

			return c.json({
				imageUrl,
			})
		},
	)

	app.delete("/api/account/avatar", async (c) => {
		const session = await requireSession(c.req.raw.headers)
		const body = await parseAvatarDeleteBody(c.req.raw)

		if (typeof body.imageUrl !== "string" || body.imageUrl.length === 0) {
			return c.json({ success: true })
		}

		await deleteAvatarFile(session.user.id, body.imageUrl)

		return c.json({ success: true })
	})
}
