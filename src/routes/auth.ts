import type { Hono } from "hono"

import type { AppBindings } from "@/lib/app-bindings"
import { auth } from "@/lib/auth"

export const registerAuthRoutes = (app: Hono<AppBindings>) => {
  app.all("/api/auth/*", async (c) => {
    const response = await auth.handler(c.req.raw)
    if (c.req.path.endsWith("/jwks")) {
      response.headers.set("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400")
    }

    return response
  })
}
