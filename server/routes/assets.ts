import { Hono } from "hono";
import type { ServiceContext } from "../context.js";
import { inferSubfolder, deduplicateName } from "../../shared/types.js";

const assets = new Hono<ServiceContext>();

assets.get("/tree", async (c) => {
  const storage = c.get("storage");
  const tree = await storage.list();
  return c.json(tree);
});

assets.get("/file/*", async (c) => {
  const storage = c.get("storage");
  const path = c.req.path.replace(/^\/api\/assets\/file\//, "");
  if (!path) return c.json({ error: "Path required" }, 400);

  const result = await storage.read(path);
  if (!result) return c.json({ error: "Not found" }, 404);

  return new Response(new Uint8Array(result.data), {
    status: 200,
    headers: { "Content-Type": result.mime },
  });
});

assets.post("/upload", async (c) => {
  const storage = c.get("storage");
  const formData = await c.req.formData();
  const file = formData.get("file") as File | null;
  if (!file) return c.json({ error: "No file provided" }, 400);

  const mime = file.type || "application/octet-stream";
  const subfolder = inferSubfolder(file.name, mime);
  const data = Buffer.from(await file.arrayBuffer());

  // Deduplicate name within subfolder
  const tree = await storage.list();
  const folderNode = tree.find((n) => n.kind === "directory" && n.name === subfolder);
  const existing = new Set<string>();
  if (folderNode && folderNode.kind === "directory") {
    for (const child of folderNode.children) {
      existing.add(child.name);
    }
  }
  const finalName = deduplicateName(existing, file.name);
  const path = `${subfolder}/${finalName}`;

  await storage.write(path, data, mime);
  return c.json({ path }, 201);
});

assets.delete("/file/*", async (c) => {
  const storage = c.get("storage");
  const path = c.req.path.replace(/^\/api\/assets\/file\//, "");
  if (!path) return c.json({ error: "Path required" }, 400);

  await storage.remove(path);
  return c.body(null, 204);
});

export { assets };
