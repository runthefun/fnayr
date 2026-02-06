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
};

export type WorldJson = {
  version: number;
  entities: EntityJson[];
};

export type Entity<R extends ComponentRegistry> = {
  id: number;
  components: Partial<{ [K in keyof R]: SchemaValue<R[K]> }>;
  unknownComponents?: Record<string, JsonValue>;
};

export type World<R extends ComponentRegistry> = {
  version: 1;
  entities: Entity<R>[];
};

export type WorldParseOptions = {
  allowUnknownComponents?: boolean;
  applyDefaults?: DeserializeOptions["applyDefaults"];
  validation?: ValidationOptions;
};

export type WorldParseResult<R extends ComponentRegistry> = {
  world: World<R>;
  issues: ValidationIssue[];
};

export type WorldSerializeOptions = {
  stripUnknownComponents?: boolean;
  component?: SerializeOptions;
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
  const world: World<R> = { version: WORLD_VERSION, entities: [] };

  if (!isObject(json)) {
    pushIssue(issues, "$", "Expected object");
    return { world, issues };
  }

  const worldKeys = new Set(["version", "entities"]);
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
    return { world, issues };
  }

  const entitiesValue = json.entities;
  if (!Array.isArray(entitiesValue)) {
    pushIssue(issues, "$.entities", "Expected array");
    return { world, issues };
  }

  const parsedEntities: Entity<R>[] = [];
  entitiesValue.forEach((entityValue, index) => {
    const entityPath = pathForIndex("$.entities", index);
    if (!isObject(entityValue)) {
      pushIssue(issues, entityPath, "Expected object");
      return;
    }

    const entityKeys = new Set(["id", "components"]);
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

    parsedEntities.push(entity);
  });

  return {
    world: { version: WORLD_VERSION, entities: parsedEntities },
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

    return { id: entity.id, components };
  });

  return {
    json: { version: WORLD_VERSION, entities },
    issues,
  };
};
