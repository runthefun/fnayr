import { Hono } from "hono";
import type { ServiceContext } from "../context.js";

const scenes = new Hono<ServiceContext>();

scenes.get("/", async (c) => {
  const db = c.get("db");
  const rows = await db.listScenes();
  return c.json(rows.map(({ id, name, created_at, updated_at }) => ({ id, name, created_at, updated_at })));
});

scenes.get("/:id", async (c) => {
  const db = c.get("db");
  const row = await db.getScene(c.req.param("id"));
  if (!row) return c.json({ error: "Not found" }, 404);
  return c.json({ ...row, data: JSON.parse(row.data) });
});

scenes.post("/", async (c) => {
  const db = c.get("db");
  const { name, data } = await c.req.json<{ name: string; data: unknown }>();
  const row = await db.createScene(name, JSON.stringify(data));
  return c.json({ ...row, data: JSON.parse(row.data) }, 201);
});

scenes.put("/:id", async (c) => {
  const db = c.get("db");
  const { name, data } = await c.req.json<{ name: string; data: unknown }>();
  try {
    const row = await db.updateScene(c.req.param("id"), name, JSON.stringify(data));
    return c.json({ ...row, data: JSON.parse(row.data) });
  } catch {
    return c.json({ error: "Not found" }, 404);
  }
});

scenes.delete("/:id", async (c) => {
  const db = c.get("db");
  await db.deleteScene(c.req.param("id"));
  return c.body(null, 204);
});

export { scenes };
