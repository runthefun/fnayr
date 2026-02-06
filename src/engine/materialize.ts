import {
  getDefault,
  type ArraySchema,
  type BooleanSchema,
  type EnumSchema,
  type LiteralSchema,
  type MapSchema,
  type NumberSchema,
  type ObjectSchema,
  type OptionalSchema,
  type SchemaLike,
  type SchemaValue,
  type StringSchema,
  type TaggedUnionSchema,
  type TupleSchema,
} from "./schema";
import {
  validate,
  type ValidationIssue,
  type ValidationOptions,
} from "./validate";

export type MaterializeResult<S extends SchemaLike> = {
  value: SchemaValue<S>;
  issues: ValidationIssue[];
};

export type MaterializeOptions = {
  validation?: ValidationOptions;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const applyDefaultsValue = (
  schema: SchemaLike,
  value: unknown,
  missing: boolean
): unknown => {
  const isRequired = schema.required === true;
  if (missing && isRequired) {
    return undefined;
  }
  switch (schema.type) {
    case "string": {
      const s = schema as StringSchema;
      return missing ? s.default ?? "" : value;
    }
    case "number": {
      const s = schema as NumberSchema;
      return missing ? s.default ?? 0 : value;
    }
    case "boolean": {
      const s = schema as BooleanSchema;
      return missing ? s.default ?? false : value;
    }
    case "enum": {
      const s = schema as EnumSchema;
      return missing ? s.default ?? s.values[0] : value;
    }
    case "literal": {
      const s = schema as LiteralSchema;
      return missing ? s.default ?? s.value : value;
    }
    case "object": {
      const s = schema as ObjectSchema;
      if (missing) {
        return getDefault(s);
      }
      if (!isObject(value)) {
        return value;
      }
      const result: Record<string, unknown> = { ...value };
      for (const [key, propSchema] of Object.entries(s.properties)) {
        if (!Object.prototype.hasOwnProperty.call(value, key)) {
          if (
            propSchema.type === "optional" ||
            propSchema.required === true
          ) {
            continue;
          }
          const defaultValue = applyDefaultsValue(propSchema, undefined, true);
          if (defaultValue !== undefined) {
            result[key] = defaultValue;
          }
          continue;
        }
        const propValue = value[key];
        if (propSchema.type === "optional" && propValue === undefined) {
          delete result[key];
          continue;
        }
        if (propValue === undefined) {
          result[key] = propValue;
          continue;
        }
        result[key] = applyDefaultsValue(propSchema, propValue, false);
      }
      return result;
    }
    case "array": {
      const s = schema as ArraySchema;
      if (missing) {
        return [];
      }
      if (!Array.isArray(value)) {
        return value;
      }
      return value.map((item) => applyDefaultsValue(s.items, item, false));
    }
    case "tuple": {
      const s = schema as TupleSchema;
      if (missing) {
        return getDefault(s);
      }
      if (!Array.isArray(value)) {
        return value;
      }
      return s.items.map((item, index) =>
        applyDefaultsValue(item, value[index], false)
      );
    }
    case "map": {
      const s = schema as MapSchema;
      if (missing) {
        return {};
      }
      if (!isObject(value)) {
        return value;
      }
      const result: Record<string, unknown> = {};
      for (const [key, entryValue] of Object.entries(value)) {
        result[key] = applyDefaultsValue(s.values, entryValue, false);
      }
      return result;
    }
    case "optional": {
      const s = schema as OptionalSchema;
      if (missing || value === undefined) {
        return undefined;
      }
      return applyDefaultsValue(s.inner, value, false);
    }
    case "tag": {
      return true;
    }
    case "taggedUnion": {
      const s = schema as TaggedUnionSchema;
      if (missing) {
        return getDefault(s);
      }
      if (!isObject(value)) {
        return value;
      }
      const tagKey = s.tag ?? "kind";
      const tagValue = value[tagKey];
      if (typeof tagValue !== "string") {
        return value;
      }
      const variant = s.variants[tagValue];
      if (!variant) {
        return value;
      }
      return applyDefaultsValue(variant, value, false);
    }
    default: {
      return value;
    }
  }
};

export const applyDefaults = <S extends SchemaLike>(
  schema: S,
  value: unknown
): SchemaValue<S> =>
  applyDefaultsValue(schema, value, value === undefined) as SchemaValue<S>;

export const materialize = <S extends SchemaLike>(
  schema: S,
  value: unknown,
  options: MaterializeOptions = {}
): MaterializeResult<S> => {
  const resolved = applyDefaults(schema, value);
  return {
    value: resolved,
    issues: validate(schema, resolved, options.validation),
  };
};
