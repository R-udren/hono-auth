import type { Hono } from "hono"

import type { AppBindings } from "@/lib/app-bindings"

export const registerHealthRoutes = (app: Hono<AppBindings>) => {
	app.get("/", (c) => {
		return c.json({
			message: "healthy",
		})
	})
}
