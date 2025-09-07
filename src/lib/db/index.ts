import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";

const db = drizzle({
  connection: process.env.DATABASE_URL!,
  schema: schema,
});

export { db };
