import type { NotFoundHandler } from "hono"

const notFound: NotFoundHandler = (c) => {
	return c.json({
		message: `Not Found - ${c.req.method} ${c.req.path}`,
		path: c.req.url,
	}, 404)
}

export default notFound
