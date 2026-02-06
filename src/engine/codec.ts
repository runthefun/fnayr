import { materialize } from "./materialize";
import type {
  ArraySchema,
  MapSchema,
  ObjectSchema,
  OptionalSchema,
  SchemaLike,
  SchemaValue,
  TaggedUnionSchema,
  TupleSchema,
} from "./schema";
import {
  validate,
  type ValidationIssue,
  type ValidationOptions,
} from "./validate";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

export type SerializeOptions = {
  stripUnknown?: boolean;
  stripUndefined?: boolean;
  validation?: ValidationOptions;
};

export type SerializeResult<S extends SchemaLike> = {
  json: JsonValue | undefined;
  issues: ValidationIssue[];
};

export type DeserializeOptions = {
  applyDefaults?: boolean;
  validation?: ValidationOptions;
};

export type DeserializeResult<S extends SchemaLike> = {
  value: SchemaValue<S>;
  issues: ValidationIssue[];
};

type SerializeRuntimeOptions = Required<
  Pick<SerializeOptions, "stripUnknown" | "stripUndefined">
>;

const DEFAULT_SERIALIZE_OPTIONS: SerializeRuntimeOptions = {
  stripUnknown: false,
  stripUndefined: true,
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const serializeValue = (
  schema: SchemaLike,
  value: unknown,
  options: SerializeRuntimeOptions
): JsonValue | undefined => {
  switch (schema.type) {
    case "object": {
      const s = schema as ObjectSchema;
      if (!isObject(value)) {
        return value as JsonValue;
      }
      const result: Record<string, JsonValue> = {};
      const knownKeys = new Set(Object.keys(s.properties));
      for (const [key, propSchema] of Object.entries(s.properties)) {
        if (!Object.prototype.hasOwnProperty.call(value, key)) {
          continue;
        }
        const encoded = serializeValue(propSchema, value[key], options);
        if (encoded === undefined && options.stripUndefined) {
          continue;
        }
        result[key] = encoded as JsonValue;
      }
      if (!options.stripUnknown) {
        for (const [key, entryValue] of Object.entries(value)) {
          if (knownKeys.has(key)) {
            continue;
          }
          if (entryValue === undefined && options.stripUndefined) {
            continue;
          }
          result[key] = entryValue as JsonValue;
        }
      }
      return result;
    }
    case "array": {
      const s = schema as ArraySchema;
      if (!Array.isArray(value)) {
        return value as JsonValue;
      }
      return value.map((item) =>
        serializeValue(s.items, item, options)
      ) as JsonValue;
    }
    case "tuple": {
      const s = schema as TupleSchema;
      if (!Array.isArray(value)) {
        return value as JsonValue;
      }
      const result: JsonValue[] = [];
      const knownLength = Math.min(value.length, s.items.length);
      for (let index = 0; index < knownLength; index += 1) {
        result.push(
          serializeValue(s.items[index], value[index], options) as JsonValue
        );
      }
      if (!options.stripUnknown) {
        for (let index = s.items.length; index < value.length; index += 1) {
          result.push(value[index] as JsonValue);
        }
      }
      return result;
    }
    case "map": {
      const s = schema as MapSchema;
      if (!isObject(value)) {
        return value as JsonValue;
      }
      const result: Record<string, JsonValue> = {};
      for (const [key, entryValue] of Object.entries(value)) {
        const encoded = serializeValue(s.values, entryValue, options);
        if (encoded === undefined && options.stripUndefined) {
          continue;
        }
        result[key] = encoded as JsonValue;
      }
      return result;
    }
    case "optional": {
      const s = schema as OptionalSchema;
      if (value === undefined) {
        return undefined;
      }
      return serializeValue(s.inner, value, options);
    }
    case "taggedUnion": {
      const s = schema as TaggedUnionSchema;
      if (!isObject(value)) {
        return value as JsonValue;
      }
      const tagKey = s.tag ?? "kind";
      const tagValue = value[tagKey];
      if (typeof tagValue !== "string") {
        return value as JsonValue;
      }
      const variant = s.variants[tagValue];
      if (!variant) {
        return value as JsonValue;
      }
      return serializeValue(variant, value, options);
    }
    default: {
      return value as JsonValue;
    }
  }
};

export const serialize = <S extends SchemaLike>(
  schema: S,
  value: SchemaValue<S> | unknown,
  options: SerializeOptions = {}
): SerializeResult<S> => {
  const issues = validate(schema, value, options.validation);
  const resolvedOptions: SerializeRuntimeOptions = {
    stripUnknown: options.stripUnknown ?? DEFAULT_SERIALIZE_OPTIONS.stripUnknown,
    stripUndefined: options.stripUndefined ?? DEFAULT_SERIALIZE_OPTIONS.stripUndefined,
  };
  return {
    json: serializeValue(schema, value, resolvedOptions),
    issues,
  };
};

export const deserialize = <S extends SchemaLike>(
  schema: S,
  json: unknown,
  options: DeserializeOptions = {}
): DeserializeResult<S> => {
  if (options.applyDefaults ?? true) {
    return materialize(schema, json, { validation: options.validation });
  }
  const issues = validate(schema, json, options.validation);
  return {
    value: json as SchemaValue<S>,
    issues,
  };
};
