import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { resolve } from "node:path";
import { mkdirSync } from "node:fs";
import type { ServiceContext } from "./context.js";
import { SqliteDatabase } from "./services/database/sqlite.js";
import { LocalBlobStorage } from "./services/blob-storage/local-fs.js";
import { InlineJobQueue } from "./services/job-queue/inline.js";
import { project } from "./routes/project.js";
import { scenes } from "./routes/scenes.js";
import { assets } from "./routes/assets.js";

const DATA_DIR = resolve("data");
mkdirSync(DATA_DIR, { recursive: true });

const db = new SqliteDatabase(resolve(DATA_DIR, "fnayr.db"));
const storage = new LocalBlobStorage(resolve(DATA_DIR, "blobs"));
const queue = new InlineJobQueue();

const app = new Hono<ServiceContext>();

// Inject services into context
app.use("*", async (c, next) => {
  c.set("db", db);
  c.set("storage", storage);
  c.set("queue", queue);
  await next();
});

app.route("/api", project);
app.route("/api/scenes", scenes);
app.route("/api/assets", assets);

const port = Number(process.env.PORT ?? 3001);

serve({ fetch: app.fetch, port }, () => {
  console.log(`Server running on http://localhost:${port}`);
});

export { app };
