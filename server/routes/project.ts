import { Hono } from "hono";
import type { ServiceContext } from "../context.js";

const project = new Hono<ServiceContext>();

project.get("/health", (c) => {
  return c.json({ status: "ok" });
});

export { project };
