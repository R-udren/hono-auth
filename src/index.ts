import { auth } from "@/auth";
import { Hono } from "hono";

const app = new Hono();

app.on(["POST", "GET"], "/api/auth/*", (c) => {
  console.log("Accessing auth route: ", c.req.raw.url);
  return auth.handler(c.req.raw);
});

export default app;
