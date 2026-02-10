import { Hono } from "hono";
import type { ServiceContext } from "./context.js";
import type { IDatabase, IBlobStorage, IJobQueue } from "./services/types.js";
import { project } from "./routes/project.js";
import { scenes } from "./routes/scenes.js";
import { assets } from "./routes/assets.js";

export function createApp(db: IDatabase, storage: IBlobStorage, queue: IJobQueue) {
  const app = new Hono<ServiceContext>();

  app.use("*", async (c, next) => {
    c.set("db", db);
    c.set("storage", storage);
    c.set("queue", queue);
    await next();
  });

  app.route("/api", project);
  app.route("/api/scenes", scenes);
  app.route("/api/assets", assets);

  return app;
}
