import { Hono } from "hono"

import type { AppBindings } from "@/lib/app-bindings"

import { notFound, onError } from "@/middleware"
import { corsMiddleware } from "@/middleware/cors"
import { requestLogger } from "@/middleware/request-logger"
import { registerAvatarRoutes } from "@/routes/account/avatar"
import { registerAuthRoutes } from "@/routes/auth"
import { registerHealthRoutes } from "@/routes/health"
import { registerMeRoutes } from "@/routes/me"

const app = new Hono<AppBindings>()

app.use(requestLogger)
app.notFound(notFound)
app.onError(onError)
app.use("*", corsMiddleware)

registerHealthRoutes(app)
registerAvatarRoutes(app)
registerMeRoutes(app)
registerAuthRoutes(app)

export default app
