import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { auth } from '@/lib/auth'

const app = new Hono()

app.use(
  '*',
  cors({
    origin: process.env.ORIGINS?.split(',') || [],
    allowHeaders: ['Content-Type', 'Authorization'],
    allowMethods: ['POST', 'GET', 'OPTIONS'],
    exposeHeaders: ['Content-Length'],
    maxAge: 600,
    credentials: true,
  }),
)

app.on(['POST', 'GET'], '/api/auth/*', (c) => {
  return auth.handler(c.req.raw)
})

export default app
