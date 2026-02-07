import type { JsonValue } from "../codec";
import type { SchemaLike } from "../schema";
import {
  parseWorld,
  serializeWorld,
  type ResourceRegistry,
  type WorldParseOptions,
  type WorldSerializeOptions,
  type WorldSerializeResult,
} from "../world";
import type { ValidationIssue } from "../validate";
import type { ComponentData, ComponentRegistry, ComponentType } from "./types";
import { Hierarchy } from "./hierarchy";
import { createWorld, type EcsWorld } from "./world";

const unknownComponentStore = new WeakMap<
  EcsWorld<any>,
  Map<number, Record<string, JsonValue>>
>();

/**
 * Options for converting JSON into a runtime world.
 */
export type WorldFromJsonOptions = WorldParseOptions & {
  /** Optional entity capacity for the runtime world. */
  capacity?: number;
  /** Resource registry for deserializing resources. */
  resources?: ResourceRegistry;
  /** If true, create and populate a Hierarchy from parent fields. */
  hierarchy?: boolean;
};

/**
 * Result of parsing JSON into a runtime world.
 */
export type WorldFromJsonResult<R extends ComponentRegistry> = {
  /** Runtime ECS world. */
  world: EcsWorld<R>;
  /** Validation issues reported by parsing or hydration. */
  issues: ValidationIssue[];
  /** Present when options.hierarchy is true. */
  hierarchy?: Hierarchy<R>;
};

/**
 * Builds a runtime ECS world from JSON using the component registry.
 */
export const worldFromJson = <R extends ComponentRegistry>(
  registry: R,
  json: unknown,
  options: WorldFromJsonOptions = {}
): WorldFromJsonResult<R> => {
  const parseOptions: WorldParseOptions = {
    ...options,
    resourceRegistry: options.resources ?? options.resourceRegistry,
  };
  const parsed = parseWorld(registry, json, parseOptions);
  const world = createWorld(registry, {
    capacity: options.capacity,
    ...(options.resources ? { resources: options.resources } : {}),
  });
  const issues: ValidationIssue[] = [...parsed.issues];

  const unknownComponents = new Map<number, Record<string, JsonValue>>();

  parsed.world.entities.forEach((entity, index) => {
    let runtimeEntity: number;
    try {
      runtimeEntity = world.createEntityWithId(entity.id);
    } catch (error) {
      issues.push({
        path: `$.entities[${index}].id`,
        message:
          error instanceof Error ? error.message : "Failed to reserve entity id",
      });
      return;
    }

    for (const [componentName, componentValue] of Object.entries(
      entity.components
    )) {
      if (componentValue === undefined) {
        continue;
      }
      try {
        world.setComponent(
          runtimeEntity,
          componentName as ComponentType<R>,
          componentValue as ComponentData<R, ComponentType<R>>
        );
      } catch (error) {
        issues.push({
          path: `$.entities[${index}].components.${componentName}`,
          message:
            error instanceof Error
              ? error.message
              : "Failed to add component",
        });
      }
    }

    if (options.allowUnknownComponents && entity.unknownComponents) {
      unknownComponents.set(runtimeEntity, entity.unknownComponents);
    }
  });

  if (unknownComponents.size > 0) {
    unknownComponentStore.set(world, unknownComponents);
    world.onEntityDestroyed((entity) => {
      unknownComponents.delete(entity);
      if (unknownComponents.size === 0) {
        unknownComponentStore.delete(world);
      }
    });
  }

  // Phase 2: Hierarchy
  let hierarchy: Hierarchy<R> | undefined;
  if (options.hierarchy) {
    hierarchy = new Hierarchy(world as any);
    parsed.world.entities.forEach((entity, index) => {
      if (entity.parent === undefined) {
        return;
      }
      if (!world.isAlive(entity.id)) {
        return;
      }
      if (!world.isAlive(entity.parent)) {
        issues.push({
          path: `$.entities[${index}].parent`,
          message: `Parent entity ${entity.parent} does not exist`,
        });
        return;
      }
      try {
        hierarchy!.setParent(entity.id, entity.parent);
      } catch (error) {
        issues.push({
          path: `$.entities[${index}].parent`,
          message:
            error instanceof Error ? error.message : "Failed to set parent",
        });
      }
    });
  }

  // Phase 3: Resources
  if (parsed.world.resources) {
    for (const [resourceName, resourceValue] of Object.entries(
      parsed.world.resources
    )) {
      try {
        (world as any).setResource(resourceName, resourceValue);
      } catch (error) {
        issues.push({
          path: `$.resources.${resourceName}`,
          message:
            error instanceof Error
              ? error.message
              : "Failed to set resource",
        });
      }
    }
  }

  const result: WorldFromJsonResult<R> = { world, issues };
  if (hierarchy) {
    result.hierarchy = hierarchy;
  }
  return result;
};

/**
 * Options for serializing a runtime world to JSON.
 */
export type WorldToJsonOptions = WorldSerializeOptions & {
  /** Duck-typed hierarchy for reading parent relationships. */
  hierarchy?: { getParent(entity: number): number | undefined };
};

/**
 * Serializes a runtime ECS world to JSON using the component registry.
 */
export const worldToJson = <R extends ComponentRegistry>(
  registry: R,
  world: EcsWorld<R>,
  options: WorldToJsonOptions = {}
): WorldSerializeResult => {
  type SchemaComponents = Partial<{
    [K in keyof R]: ComponentData<R, K & ComponentType<R>>;
  }>;

  const entities = Array.from(world.entities()).map((entity) => {
    const components: SchemaComponents = {};

    for (const type of Object.keys(registry) as ComponentType<R>[]) {
      if (world.hasComponent(entity, type)) {
        const value = world.getComponent(entity, type);
        if (value !== undefined) {
          components[type as keyof R] = value as ComponentData<
            R,
            ComponentType<R>
          >;
        }
      }
    }

    const entry: {
      id: number;
      components: SchemaComponents;
      unknownComponents?: Record<string, JsonValue> | undefined;
      parent?: number;
    } = {
      id: entity,
      components,
    };

    if (!options.stripUnknownComponents) {
      const unknown = unknownComponentStore.get(world)?.get(entity);
      if (unknown) {
        entry.unknownComponents = unknown;
      }
    }

    if (options.hierarchy) {
      const parent = options.hierarchy.getParent(entity);
      if (parent !== undefined) {
        entry.parent = parent;
      }
    }

    return entry;
  });

  // Build resources from the world's resource registry
  const resourceRegistry = (world as any).resourceRegistry as
    | Record<string, SchemaLike>
    | undefined;
  let resources: Record<string, unknown> | undefined;
  if (resourceRegistry && Object.keys(resourceRegistry).length > 0) {
    resources = {};
    let hasResources = false;
    for (const resourceName of Object.keys(resourceRegistry)) {
      if ((world as any).hasResource(resourceName)) {
        resources[resourceName] = (world as any).getResource(resourceName);
        hasResources = true;
      }
    }
    if (!hasResources) {
      resources = undefined;
    }
  }

  const intermediate: {
    version: 1;
    entities: typeof entities;
    resources?: Record<string, unknown>;
  } = { version: 1, entities };
  if (resources) {
    intermediate.resources = resources;
  }

  return serializeWorld(registry, intermediate, {
    ...options,
    resourceRegistry: resourceRegistry,
  });
};
