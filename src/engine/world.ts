import {
  deserialize,
  serialize,
  type DeserializeOptions,
  type JsonValue,
  type SerializeOptions,
} from "./codec";
import type { SchemaLike, SchemaValue } from "./schema";
import type { ValidationIssue, ValidationOptions } from "./validate";

export type ComponentRegistry = Record<string, SchemaLike>;

export type EntityJson = {
  id: number;
  components: Record<string, JsonValue>;
  parent?: number;
};

export type WorldJson = {
  version: number;
  entities: EntityJson[];
  resources?: Record<string, JsonValue>;
};

export type Entity<R extends ComponentRegistry> = {
  id: number;
  components: Partial<{ [K in keyof R]: SchemaValue<R[K]> }>;
  unknownComponents?: Record<string, JsonValue>;
  parent?: number;
};

export type ResourceRegistry = Record<string, SchemaLike>;

export type World<R extends ComponentRegistry> = {
  version: 1;
  entities: Entity<R>[];
  resources?: Record<string, unknown>;
};

export type WorldParseOptions = {
  allowUnknownComponents?: boolean;
  allowUnknownResources?: boolean;
  applyDefaults?: DeserializeOptions["applyDefaults"];
  validation?: ValidationOptions;
  resourceRegistry?: ResourceRegistry;
};

export type WorldParseResult<R extends ComponentRegistry> = {
  world: World<R>;
  issues: ValidationIssue[];
};

export type WorldSerializeOptions = {
  stripUnknownComponents?: boolean;
  component?: SerializeOptions;
  resourceRegistry?: ResourceRegistry;
};

export type WorldSerializeResult = {
  json: WorldJson;
  issues: ValidationIssue[];
};

const WORLD_VERSION = 1;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isIdentifier = (key: string): boolean =>
  /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key);

const pathForProp = (path: string, key: string): string =>
  isIdentifier(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`;

const pathForIndex = (path: string, index: number): string =>
  `${path}[${index}]`;

const prefixIssuePath = (base: string, issuePath: string): string => {
  if (issuePath === "$") {
    return base;
  }
  if (issuePath.startsWith("$.")) {
    return `${base}${issuePath.slice(1)}`;
  }
  if (issuePath.startsWith("$[")) {
    return `${base}${issuePath.slice(1)}`;
  }
  return `${base}.${issuePath}`;
};

const pushIssue = (
  issues: ValidationIssue[],
  path: string,
  message: string
) => {
  issues.push({ path, message });
};

export const parseWorld = <R extends ComponentRegistry>(
  registry: R,
  json: unknown,
  options: WorldParseOptions = {}
): WorldParseResult<R> => {
  const issues: ValidationIssue[] = [];
  const allowUnknownComponents = options.allowUnknownComponents ?? false;
  const allowUnknownProperties = options.validation?.allowUnknownProperties ?? false;
  const applyDefaults = options.applyDefaults ?? true;
  const emptyWorld: World<R> = { version: WORLD_VERSION, entities: [] };

  if (!isObject(json)) {
    pushIssue(issues, "$", "Expected object");
    return { world: emptyWorld, issues };
  }

  const worldKeys = new Set(["version", "entities", "resources"]);
  if (!allowUnknownProperties) {
    for (const key of Object.keys(json)) {
      if (!worldKeys.has(key)) {
        pushIssue(issues, pathForProp("$", key), "Unknown property");
      }
    }
  }

  if (!Object.prototype.hasOwnProperty.call(json, "version")) {
    pushIssue(issues, "$.version", "Missing required property");
  } else {
    const version = json.version;
    if (typeof version !== "number" || Number.isNaN(version)) {
      pushIssue(issues, "$.version", "Expected number");
    } else if (!Number.isFinite(version)) {
      pushIssue(issues, "$.version", "Expected finite number");
    } else if (!Number.isInteger(version)) {
      pushIssue(issues, "$.version", "Expected integer");
    } else if (version !== WORLD_VERSION) {
      pushIssue(issues, "$.version", `Expected version ${WORLD_VERSION}`);
    }
  }

  if (!Object.prototype.hasOwnProperty.call(json, "entities")) {
    pushIssue(issues, "$.entities", "Missing required property");
    return { world: emptyWorld, issues };
  }

  const entitiesValue = json.entities;
  if (!Array.isArray(entitiesValue)) {
    pushIssue(issues, "$.entities", "Expected array");
    return { world: emptyWorld, issues };
  }

  const parsedEntities: Entity<R>[] = [];
  entitiesValue.forEach((entityValue, index) => {
    const entityPath = pathForIndex("$.entities", index);
    if (!isObject(entityValue)) {
      pushIssue(issues, entityPath, "Expected object");
      return;
    }

    const entityKeys = new Set(["id", "components", "parent"]);
    if (!allowUnknownProperties) {
      for (const key of Object.keys(entityValue)) {
        if (!entityKeys.has(key)) {
          pushIssue(issues, pathForProp(entityPath, key), "Unknown property");
        }
      }
    }

    let id = 0;
    if (!Object.prototype.hasOwnProperty.call(entityValue, "id")) {
      pushIssue(issues, `${entityPath}.id`, "Missing required property");
    } else {
      const idValue = entityValue.id;
      if (typeof idValue !== "number" || Number.isNaN(idValue)) {
        pushIssue(issues, `${entityPath}.id`, "Expected number");
      } else if (!Number.isFinite(idValue)) {
        pushIssue(issues, `${entityPath}.id`, "Expected finite number");
      } else {
        if (!Number.isInteger(idValue)) {
          pushIssue(issues, `${entityPath}.id`, "Expected integer");
        }
        id = idValue;
      }
    }

    const entity: Entity<R> = { id, components: {} };

    if (!Object.prototype.hasOwnProperty.call(entityValue, "components")) {
      pushIssue(issues, `${entityPath}.components`, "Missing required property");
      parsedEntities.push(entity);
      return;
    }

    const componentsValue = entityValue.components;
    if (!isObject(componentsValue)) {
      pushIssue(issues, `${entityPath}.components`, "Expected object");
      parsedEntities.push(entity);
      return;
    }

    const componentsPath = pathForProp(entityPath, "components");
    const unknownComponents: Record<string, JsonValue> = {};

    for (const [componentName, componentJson] of Object.entries(
      componentsValue
    )) {
      const componentPath = pathForProp(componentsPath, componentName);
      const schema = registry[componentName];
      if (!schema) {
        if (allowUnknownComponents) {
          unknownComponents[componentName] = componentJson as JsonValue;
        } else {
          pushIssue(issues, componentPath, "Unknown component");
        }
        continue;
      }
      const decoded = deserialize(schema, componentJson, {
        applyDefaults,
        validation: options.validation,
      });
      (entity.components as Record<string, SchemaValue<SchemaLike>>)[
        componentName
      ] = decoded.value;
      for (const issue of decoded.issues) {
        pushIssue(issues, prefixIssuePath(componentPath, issue.path), issue.message);
      }
    }

    if (allowUnknownComponents && Object.keys(unknownComponents).length > 0) {
      entity.unknownComponents = unknownComponents;
    }

    if (Object.prototype.hasOwnProperty.call(entityValue, "parent")) {
      const parentValue = entityValue.parent;
      if (typeof parentValue !== "number" || Number.isNaN(parentValue)) {
        pushIssue(issues, `${entityPath}.parent`, "Expected number");
      } else if (!Number.isFinite(parentValue)) {
        pushIssue(issues, `${entityPath}.parent`, "Expected finite number");
      } else if (!Number.isInteger(parentValue)) {
        pushIssue(issues, `${entityPath}.parent`, "Expected integer");
      } else {
        entity.parent = parentValue;
      }
    }

    parsedEntities.push(entity);
  });

  const resourceRegistry = options.resourceRegistry;
  const allowUnknownResources = options.allowUnknownResources ?? false;
  const parsedResources: Record<string, unknown> = {};
  let hasResources = false;

  if (Object.prototype.hasOwnProperty.call(json, "resources")) {
    const resourcesValue = json.resources;
    if (!isObject(resourcesValue)) {
      pushIssue(issues, "$.resources", "Expected object");
    } else {
      for (const [resourceName, resourceJson] of Object.entries(resourcesValue)) {
        const resourcePath = pathForProp("$.resources", resourceName);
        if (!resourceRegistry) {
          pushIssue(issues, resourcePath, "Unknown resource");
          continue;
        }
        const schema = resourceRegistry[resourceName];
        if (!schema) {
          if (!allowUnknownResources) {
            pushIssue(issues, resourcePath, "Unknown resource");
          }
          continue;
        }
        const decoded = deserialize(schema, resourceJson, {
          applyDefaults,
          validation: options.validation,
        });
        parsedResources[resourceName] = decoded.value;
        hasResources = true;
        for (const issue of decoded.issues) {
          pushIssue(issues, prefixIssuePath(resourcePath, issue.path), issue.message);
        }
      }
    }
  }

  const world: World<R> = { version: WORLD_VERSION, entities: parsedEntities };
  if (hasResources) {
    world.resources = parsedResources;
  }

  return {
    world,
    issues,
  };
};

export const serializeWorld = <R extends ComponentRegistry>(
  registry: R,
  world: World<R>,
  options: WorldSerializeOptions = {}
): WorldSerializeResult => {
  const issues: ValidationIssue[] = [];
  const componentOptions = options.component ?? {};

  const entities = world.entities.map((entity, index) => {
    const components: Record<string, JsonValue> = {};
    const entityPath = pathForIndex("$.entities", index);
    const componentsPath = pathForProp(entityPath, "components");

    for (const [componentName, componentValue] of Object.entries(
      entity.components
    )) {
      if (componentValue === undefined) {
        continue;
      }
      const schema = registry[componentName];
      const componentPath = pathForProp(componentsPath, componentName);
      if (!schema) {
        if (!options.stripUnknownComponents) {
          components[componentName] = componentValue as JsonValue;
        }
        pushIssue(issues, componentPath, "Unknown component");
        continue;
      }
      const encoded = serialize(schema, componentValue, componentOptions);
      if (encoded.json !== undefined) {
        components[componentName] = encoded.json;
      }
      for (const issue of encoded.issues) {
        pushIssue(issues, prefixIssuePath(componentPath, issue.path), issue.message);
      }
    }

    if (!options.stripUnknownComponents && entity.unknownComponents) {
      for (const [componentName, componentJson] of Object.entries(
        entity.unknownComponents
      )) {
        if (Object.prototype.hasOwnProperty.call(components, componentName)) {
          continue;
        }
        components[componentName] = componentJson;
      }
    }

    const entry: EntityJson = { id: entity.id, components };
    if (entity.parent !== undefined) {
      entry.parent = entity.parent;
    }
    return entry;
  });

  const json: WorldJson = { version: WORLD_VERSION, entities };

  const resourceRegistry = options.resourceRegistry;
  if (world.resources && resourceRegistry) {
    const serializedResources: Record<string, JsonValue> = {};
    let hasResources = false;
    for (const [resourceName, resourceValue] of Object.entries(world.resources)) {
      if (resourceValue === undefined) {
        continue;
      }
      const schema = resourceRegistry[resourceName];
      const resourcePath = pathForProp("$.resources", resourceName);
      if (!schema) {
        pushIssue(issues, resourcePath, "Unknown resource");
        continue;
      }
      const encoded = serialize(schema, resourceValue, componentOptions);
      if (encoded.json !== undefined) {
        serializedResources[resourceName] = encoded.json;
        hasResources = true;
      }
      for (const issue of encoded.issues) {
        pushIssue(issues, prefixIssuePath(resourcePath, issue.path), issue.message);
      }
    }
    if (hasResources) {
      json.resources = serializedResources;
    }
  }

  return { json, issues };
};
