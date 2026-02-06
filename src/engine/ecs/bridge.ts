import type { JsonValue } from "../codec";
import {
  parseWorld,
  serializeWorld,
  type WorldParseOptions,
  type WorldSerializeOptions,
  type WorldSerializeResult,
} from "../world";
import type { ValidationIssue } from "../validate";
import type { ComponentData, ComponentRegistry, ComponentType } from "./types";
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
};

/**
 * Result of parsing JSON into a runtime world.
 */
export type WorldFromJsonResult<R extends ComponentRegistry> = {
  /** Runtime ECS world. */
  world: EcsWorld<R>;
  /** Validation issues reported by parsing or hydration. */
  issues: ValidationIssue[];
};

/**
 * Builds a runtime ECS world from JSON using the component registry.
 */
export const worldFromJson = <R extends ComponentRegistry>(
  registry: R,
  json: unknown,
  options: WorldFromJsonOptions = {}
): WorldFromJsonResult<R> => {
  const parsed = parseWorld(registry, json, options);
  const world = createWorld(registry, { capacity: options.capacity });
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
        world.addComponent(
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

  return { world, issues };
};

/**
 * Options for serializing a runtime world to JSON.
 */
export type WorldToJsonOptions = WorldSerializeOptions;

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

    return entry;
  });

  return serializeWorld(registry, { version: 1, entities }, options);
};
