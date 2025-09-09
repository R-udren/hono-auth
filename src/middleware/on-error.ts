import type { ErrorHandler } from "hono"
import type { ContentfulStatusCode } from "hono/utils/http-status"

const INTERNAL_SERVER_ERROR = 500

const onError: ErrorHandler = (err, c) => {
	let statusCode: ContentfulStatusCode = INTERNAL_SERVER_ERROR

	if ("status" in err) {
		statusCode = err.status as ContentfulStatusCode
	}
	else {
		statusCode = c.newResponse(null).status as ContentfulStatusCode
	}

	const env = c.env?.NODE_ENV || process.env?.NODE_ENV
	return c.json(
		{
			message: err.message,
			status: statusCode,
			stack: env === "production" ? undefined : err.stack,
		},
		statusCode,
	)
}

export default onError
