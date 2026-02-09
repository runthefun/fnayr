import type { ComponentRegistry, World } from "../ecs/types";
import type { Commands } from "../ecs/commands";
import type { System } from "../ecs/systems";
import type { SchemaLike } from "../schema";
import { AssetManager } from "./manager";

/* ------------------------------------------------------------------ */
/*  SlotEntry                                                          */
/* ------------------------------------------------------------------ */

export type SlotEntry = {
  key: string;
  type: string;
  uri: string;
  options?: Record<string, unknown>;
  version: number;
  sub?: string;
  status: "pending" | "active" | "failed";
  clearOnPending: boolean;
};

/* ------------------------------------------------------------------ */
/*  Schema-walking helper: find asset-ref paths in component schemas  */
/* ------------------------------------------------------------------ */

export function findAssetRefPaths(
  registry: Record<string, SchemaLike>,
): Map<string, string[]> {
  const result = new Map<string, string[]>();

  function walk(schema: SchemaLike, path: string[]): string[][] {
    if (schema.meta?.kind === "assetRef") return [path];
    if (schema.type === "object") {
      const obj = schema as unknown as { properties: Record<string, SchemaLike> };
      const found: string[][] = [];
      for (const [key, propSchema] of Object.entries(obj.properties)) {
        found.push(...walk(propSchema, [...path, key]));
      }
      return found;
    }
    if (schema.type === "optional") {
      const opt = schema as unknown as { inner: SchemaLike };
      return walk(opt.inner, path);
    }
    if (schema.type === "taggedUnion") {
      const tu = schema as unknown as { variants: Record<string, SchemaLike> };
      const seen = new Set<string>();
      const found: string[][] = [];
      for (const variantSchema of Object.values(tu.variants)) {
        for (const p of walk(variantSchema, path)) {
          const key = p.join(".");
          if (!seen.has(key)) {
            seen.add(key);
            found.push(p);
          }
        }
      }
      return found;
    }
    // Skip array, tuple, map
    return [];
  }

  for (const [componentType, schema] of Object.entries(registry)) {
    const paths = walk(schema as SchemaLike, []);
    if (paths.length > 1) {
      throw new Error(
        `Multiple AssetRef fields per component not yet supported: ${componentType}`,
      );
    }
    if (paths.length === 1) {
      result.set(componentType, paths[0]);
    }
  }
  return result;
}

export function getNestedValue(obj: unknown, path: string[]): unknown {
  let current: unknown = obj;
  for (const key of path) {
    if (current == null) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/* ------------------------------------------------------------------ */
/*  createAssetRequestSystem                                          */
/* ------------------------------------------------------------------ */

export function createAssetRequestSystem<R extends ComponentRegistry>(
  assetManager: AssetManager,
  slots: Map<string, SlotEntry>,
  registry: Record<string, SchemaLike>,
  options?: {
    onLoadingStats?: (stats: { pending: number; ready: number; failed: number; total: number }) => void;
  },
): System<R> & { retryFailed(key: string): void } {
  // Pre-compute asset-ref paths per component type
  const assetRefPaths = findAssetRefPaths(registry);

  function slotKey(entity: number, componentType: string): string {
    return `${entity}:${componentType}`;
  }

  function extractRef(
    entity: number,
    componentType: string,
    world: World<R>,
  ): { type: string; uri: string; sub?: string; options?: Record<string, unknown> } | undefined {
    const path = assetRefPaths.get(componentType);
    if (!path) return undefined;
    const component = world.getComponent(entity, componentType as any);
    if (!component) return undefined;
    const ref = getNestedValue(component, path);
    if (!ref) return undefined;
    return ref as { type: string; uri: string; sub?: string; options?: Record<string, unknown> };
  }

  function handleAdded(
    entity: number,
    componentType: string,
    world: World<R>,
  ): void {
    const ref = extractRef(entity, componentType, world);
    if (!ref) return;
    const sk = slotKey(entity, componentType);

    if (!ref.uri) {
      // Empty URI on add: skip (no slot created)
      return;
    }

    if (!assetManager.hasLoader(ref.type)) {
      console.warn(
        `No loader registered for asset type "${ref.type}" (entity ${entity}, component ${componentType})`,
      );
      slots.set(sk, {
        key: "",
        type: ref.type,
        uri: ref.uri,
        options: ref.options,
        version: 0,
        sub: ref.sub,
        status: "failed",
        clearOnPending: false,
      });
      return;
    }

    const cacheKey = AssetManager.cacheKey(ref.type, ref.uri);
    const entry = assetManager.request(ref.type, ref.uri, ref.options);
    slots.set(sk, {
      key: cacheKey,
      type: ref.type,
      uri: ref.uri,
      options: ref.options,
      version: 0,
      sub: ref.sub,
      status: entry.status === "error" ? "failed" : "pending",
      clearOnPending: false,
    });
  }

  function handleUpdated(
    entity: number,
    componentType: string,
    world: World<R>,
    emptyUriCleanup: Set<string>,
  ): void {
    const ref = extractRef(entity, componentType, world);
    if (!ref) {
      // Variant switched away from asset-bearing (e.g. model→mesh): clean up existing slot
      const sk = slotKey(entity, componentType);
      if (slots.has(sk)) {
        emptyUriCleanup.add(sk);
      }
      return;
    }
    const sk = slotKey(entity, componentType);
    const existing = slots.get(sk);

    // No existing slot → treat like getAdded
    if (!existing) {
      handleAdded(entity, componentType, world);
      return;
    }

    // URI became empty → schedule cleanup
    if (!ref.uri) {
      emptyUriCleanup.add(sk);
      return;
    }

    const newCacheKey = assetManager.hasLoader(ref.type)
      ? AssetManager.cacheKey(ref.type, ref.uri)
      : "";

    // Branch A: cache key changed
    if (newCacheKey !== existing.key) {
      if (existing.key !== "") {
        assetManager.release(existing.key);
      }
      const wasActive = existing.status === "active";
      if (!assetManager.hasLoader(ref.type)) {
        console.warn(
          `No loader registered for asset type "${ref.type}" (entity ${entity}, component ${componentType})`,
        );
        existing.key = "";
        existing.type = ref.type;
        existing.uri = ref.uri;
        existing.options = ref.options;
        existing.sub = ref.sub;
        existing.status = "failed";
        existing.version++;
        existing.clearOnPending = wasActive;
        return;
      }
      const entry = assetManager.request(ref.type, ref.uri, ref.options);
      existing.key = newCacheKey;
      existing.type = ref.type;
      existing.uri = ref.uri;
      existing.options = ref.options;
      existing.sub = ref.sub;
      existing.status = entry.status === "error" ? "failed" : "pending";
      existing.version++;
      existing.clearOnPending = wasActive;
      return;
    }

    // Branch B: same key, sub changed
    if (ref.sub !== existing.sub) {
      existing.sub = ref.sub;
      existing.version++;
      if (existing.status === "active") {
        existing.status = "pending";
        existing.clearOnPending = true;
      }
      return;
    }

    // Branch C: same key+sub, peek missing due to invalidate
    if (existing.key !== "" && !assetManager.peek(existing.key)) {
      assetManager.request(ref.type, ref.uri, ref.options);
      existing.status = "pending";
      existing.version++;
      existing.clearOnPending = false;
      return;
    }

    // Branch D: same key+sub, cache exists or key==""
    if (existing.key === "") {
      // Re-check if loader became available
      if (assetManager.hasLoader(ref.type)) {
        const ck = AssetManager.cacheKey(ref.type, ref.uri);
        assetManager.request(ref.type, ref.uri, ref.options);
        existing.key = ck;
        existing.status = "pending";
        existing.version++;
        existing.clearOnPending = false;
      } else {
        // Still no loader — update tracked metadata if URI/options/sub changed
        const uriChanged = ref.uri !== existing.uri;
        const subChanged = ref.sub !== existing.sub;
        if (uriChanged || subChanged) {
          existing.uri = ref.uri;
          existing.options = ref.options;
          existing.sub = ref.sub;
          existing.type = ref.type;
          existing.version++;
        }
      }
    }
  }

  const system = ((world: World<R>, _dt: number, _commands: Commands<R>) => {
    const emptyUriCleanup = new Set<string>();

    // Process each asset-bearing component type
    for (const componentType of assetRefPaths.keys()) {
      // Handle added
      for (const entity of world.getAdded(componentType as any)) {
        handleAdded(entity, componentType, world);
      }

      // Handle updated
      for (const entity of world.getUpdated(componentType as any)) {
        handleUpdated(entity, componentType, world, emptyUriCleanup);
      }

      // Handle removed
      for (const entity of world.getRemoved(componentType as any)) {
        const sk = slotKey(entity, componentType);
        const slot = slots.get(sk);
        if (slot) {
          if (slot.key !== "") {
            assetManager.release(slot.key);
          }
          slots.delete(sk);
        }
      }
    }

    // Empty-URI cleanup pass
    for (const sk of emptyUriCleanup) {
      const slot = slots.get(sk);
      if (slot) {
        if (slot.key !== "") {
          assetManager.release(slot.key);
        }
        slots.delete(sk);
      }
    }

    // Dead-entity prune
    for (const [sk, slot] of slots) {
      const entityId = parseInt(sk.split(":")[0], 10);
      if (!world.isAlive(entityId)) {
        if (slot.key !== "") {
          assetManager.release(slot.key);
        }
        slots.delete(sk);
      }
    }

    // Compute loading stats
    let pending = 0;
    let ready = 0;
    let failed = 0;
    for (const slot of slots.values()) {
      switch (slot.status) {
        case "pending":
          pending++;
          break;
        case "active":
          ready++;
          break;
        case "failed":
          failed++;
          break;
      }
    }
    const total = slots.size;
    if (options?.onLoadingStats) {
      options.onLoadingStats({ pending, ready, failed, total });
    }
  }) as System<R> & { retryFailed(key: string): void };

  system.retryFailed = (key: string) => {
    assetManager.invalidate(key);
    for (const [, slot] of slots) {
      if (slot.status !== "failed") continue;
      const matches =
        slot.key === key ||
        (slot.key === "" && AssetManager.cacheKey(slot.type, slot.uri) === key);
      if (matches && assetManager.hasLoader(slot.type)) {
        const ck = AssetManager.cacheKey(slot.type, slot.uri);
        assetManager.request(slot.type, slot.uri, slot.options);
        slot.key = ck;
        slot.status = "pending";
        slot.version++;
      }
    }
  };

  return system;
}

/* ------------------------------------------------------------------ */
/*  AssetResolver & createAssetResolveSystem                          */
/* ------------------------------------------------------------------ */

export type AssetReadyHandler<R extends ComponentRegistry, Ctx = unknown> = (
  entity: number,
  asset: unknown,
  slot: SlotEntry,
  world: World<R>,
  ctx: Ctx,
) => void;

export type AssetClearHandler<R extends ComponentRegistry, Ctx = unknown> = (
  entity: number,
  world: World<R>,
  ctx: Ctx,
) => void;

export type ComponentSyncHandler<R extends ComponentRegistry, Ctx = unknown> = (
  entity: number,
  world: World<R>,
  ctx: Ctx,
) => void;

export interface AssetTypeHandler<R extends ComponentRegistry, Ctx = unknown> {
  componentType: string;
  onReady: AssetReadyHandler<R, Ctx>;
  onClear?: AssetClearHandler<R, Ctx>;
  onAdded?: ComponentSyncHandler<R, Ctx>;
  onUpdated?: ComponentSyncHandler<R, Ctx>;
  onRemoved?: ComponentSyncHandler<R, Ctx>;
  filter?: (entity: number, world: World<R>) => boolean;
}

export class AssetResolver<R extends ComponentRegistry, Ctx = unknown> {
  private handlers: AssetTypeHandler<R, Ctx>[] = [];

  register(handler: AssetTypeHandler<R, Ctx>): void {
    this.handlers.push(handler);
  }

  getHandlers(): ReadonlyArray<AssetTypeHandler<R, Ctx>> {
    return this.handlers;
  }

  getHandlersForComponent(componentType: string): AssetTypeHandler<R, Ctx>[] {
    return this.handlers.filter((h) => h.componentType === componentType);
  }
}

/**
 * Creates a single system that resolves pending asset slots via peek().
 */
export function createAssetResolveSystem<R extends ComponentRegistry, Ctx>(
  assetManager: AssetManager,
  ctx: Ctx,
  slots: Map<string, SlotEntry>,
  resolver: AssetResolver<R, Ctx>,
): System<R> {
  return (world: World<R>, _dt: number, _commands: Commands<R>) => {
    const handlers = resolver.getHandlers();

    // 1. Per-handler: empty-URI cleanup on updated components + clear on pending
    for (const handler of handlers) {
      if (handler.onClear) {
        for (const entity of world.getUpdated(handler.componentType as any)) {
          if (handler.filter && !handler.filter(entity, world)) continue;
          // Check for empty URI by looking at the slot
          const sk = `${entity}:${handler.componentType}`;
          const slot = slots.get(sk);
          if (!slot) {
            // Component updated but no slot = variant switched away or empty URI
            handler.onClear(entity, world, ctx);
          }
        }
      }
    }

    // 2. Pre-clear pass: slots with clearOnPending
    for (const [sk, slot] of slots) {
      if ((slot.status === "pending" || slot.status === "failed") && slot.clearOnPending) {
        const colonIdx = sk.indexOf(":");
        const entityId = parseInt(sk.substring(0, colonIdx), 10);
        const componentType = sk.substring(colonIdx + 1);
        if (!world.isAlive(entityId) || !world.hasComponent(entityId, componentType as any)) continue;
        const matchingHandlers = resolver.getHandlersForComponent(componentType);
        for (const handler of matchingHandlers) {
          if (handler.filter && !handler.filter(entityId, world)) continue;
          if (handler.onClear) {
            handler.onClear(entityId, world, ctx);
          }
        }
        slot.clearOnPending = false;
      }
    }

    // 3. Resolve pending slots via peek()
    for (const [sk, slot] of slots) {
      if (slot.status !== "pending") continue;
      if (slot.key === "") continue;

      const colonIdx = sk.indexOf(":");
      const entityId = parseInt(sk.substring(0, colonIdx), 10);
      const componentType = sk.substring(colonIdx + 1);

      if (!world.isAlive(entityId) || !world.hasComponent(entityId, componentType as any)) continue;

      const entry = assetManager.peek(slot.key);
      if (!entry) continue;

      if (entry.status === "ready") {
        const matchingHandlers = resolver.getHandlersForComponent(componentType);
        let handled = false;
        for (const handler of matchingHandlers) {
          if (handler.filter && !handler.filter(entityId, world)) continue;
          handler.onReady(entityId, entry.asset, slot, world, ctx);
          handled = true;
        }
        if (handled || matchingHandlers.length === 0) {
          slot.status = "active";
        }
      } else if (entry.status === "error") {
        slot.status = "failed";
      }
    }

    // 4. Component sync callbacks (onAdded/onUpdated/onRemoved)
    for (const handler of handlers) {
      if (handler.onAdded) {
        for (const entity of world.getAdded(handler.componentType as any)) {
          handler.onAdded(entity, world, ctx);
        }
      }
      if (handler.onUpdated) {
        for (const entity of world.getUpdated(handler.componentType as any)) {
          handler.onUpdated(entity, world, ctx);
        }
      }
      if (handler.onRemoved) {
        for (const entity of world.getRemoved(handler.componentType as any)) {
          handler.onRemoved(entity, world, ctx);
        }
      }
    }
  };
}
