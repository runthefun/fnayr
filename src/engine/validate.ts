import type {
  ArraySchema,
  BooleanSchema,
  EnumSchema,
  LiteralSchema,
  MapSchema,
  NumberSchema,
  ObjectSchema,
  OptionalSchema,
  SchemaLike,
  StringSchema,
  TaggedUnionSchema,
  TupleSchema,
} from "./schema";

export type ValidationIssue = {
  path: string;
  message: string;
};

export type ValidationOptions = {
  allowUnknownProperties?: boolean;
};

const DEFAULT_VALIDATION_OPTIONS: Required<ValidationOptions> = {
  allowUnknownProperties: false,
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isIdentifier = (key: string): boolean =>
  /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key);

const pathForProp = (path: string, key: string): string =>
  isIdentifier(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`;

const pathForIndex = (path: string, index: number): string =>
  `${path}[${index}]`;

const pushIssue = (issues: ValidationIssue[], path: string, message: string) => {
  issues.push({ path, message });
};

export const validate = (
  schema: SchemaLike,
  value: unknown,
  options: ValidationOptions = {}
): ValidationIssue[] => {
  const issues: ValidationIssue[] = [];
  const resolvedOptions = { ...DEFAULT_VALIDATION_OPTIONS, ...options };
  validateValue(schema, value, "$", issues, resolvedOptions);
  return issues;
};

const validateValue = (
  schema: SchemaLike,
  value: unknown,
  path: string,
  issues: ValidationIssue[],
  options: Required<ValidationOptions>
): void => {
  switch (schema.type) {
    case "string": {
      const s = schema as StringSchema;
      if (typeof value !== "string") {
        pushIssue(issues, path, "Expected string");
        return;
      }
      if (s.minLength !== undefined && value.length < s.minLength) {
        pushIssue(issues, path, `Expected min length ${s.minLength}`);
      }
      if (s.maxLength !== undefined && value.length > s.maxLength) {
        pushIssue(issues, path, `Expected max length ${s.maxLength}`);
      }
      if (s.pattern !== undefined) {
        const regex = new RegExp(s.pattern);
        if (!regex.test(value)) {
          pushIssue(
            issues,
            path,
            `Expected string to match pattern ${s.pattern}`
          );
        }
      }
      return;
    }
    case "number": {
      const s = schema as NumberSchema;
      if (typeof value !== "number" || Number.isNaN(value)) {
        pushIssue(issues, path, "Expected number");
        return;
      }
      if (s.finite && !Number.isFinite(value)) {
        pushIssue(issues, path, "Expected finite number");
      }
      if (s.integer && !Number.isInteger(value)) {
        pushIssue(issues, path, "Expected integer");
      }
      if (s.min !== undefined && value < s.min) {
        pushIssue(issues, path, `Expected number >= ${s.min}`);
      }
      if (s.max !== undefined && value > s.max) {
        pushIssue(issues, path, `Expected number <= ${s.max}`);
      }
      return;
    }
    case "boolean": {
      if (typeof value !== "boolean") {
        pushIssue(issues, path, "Expected boolean");
      }
      return;
    }
    case "enum": {
      const s = schema as EnumSchema;
      if (!s.values.includes(value as string)) {
        pushIssue(
          issues,
          path,
          `Expected one of ${s.values.map(String).join(", ")}`
        );
      }
      return;
    }
    case "literal": {
      const s = schema as LiteralSchema;
      if (value !== s.value) {
        pushIssue(issues, path, `Expected literal ${JSON.stringify(s.value)}`);
      }
      return;
    }
    case "object": {
      const s = schema as ObjectSchema;
      if (!isObject(value)) {
        pushIssue(issues, path, "Expected object");
        return;
      }
      const allowUnknown =
        s.allowUnknown ?? options.allowUnknownProperties;
      for (const [key, propSchema] of Object.entries(s.properties)) {
        const propPath = pathForProp(path, key);
        if (!Object.prototype.hasOwnProperty.call(value, key)) {
          if ((propSchema as OptionalSchema).type !== "optional") {
            pushIssue(issues, propPath, "Missing required property");
          }
          continue;
        }
        const propValue = value[key];
        if (propSchema.type === "optional" && propValue === undefined) {
          continue;
        }
        validateValue(propSchema, propValue, propPath, issues, options);
      }
      if (!allowUnknown) {
        for (const key of Object.keys(value)) {
          if (!Object.prototype.hasOwnProperty.call(s.properties, key)) {
            pushIssue(issues, pathForProp(path, key), "Unknown property");
          }
        }
      }
      return;
    }
    case "array": {
      const s = schema as ArraySchema;
      if (!Array.isArray(value)) {
        pushIssue(issues, path, "Expected array");
        return;
      }
      if (s.minItems !== undefined && value.length < s.minItems) {
        pushIssue(issues, path, `Expected at least ${s.minItems} items`);
      }
      if (s.maxItems !== undefined && value.length > s.maxItems) {
        pushIssue(issues, path, `Expected at most ${s.maxItems} items`);
      }
      value.forEach((item, index) => {
        validateValue(s.items, item, pathForIndex(path, index), issues, options);
      });
      return;
    }
    case "tuple": {
      const s = schema as TupleSchema;
      if (!Array.isArray(value)) {
        pushIssue(issues, path, "Expected array");
        return;
      }
      if (value.length !== s.items.length) {
        pushIssue(issues, path, `Expected tuple length ${s.items.length}`);
      }
      const len = Math.min(value.length, s.items.length);
      for (let index = 0; index < len; index += 1) {
        validateValue(
          s.items[index],
          value[index],
          pathForIndex(path, index),
          issues,
          options
        );
      }
      return;
    }
    case "map": {
      const s = schema as MapSchema;
      if (!isObject(value)) {
        pushIssue(issues, path, "Expected object");
        return;
      }
      for (const [key, entryValue] of Object.entries(value)) {
        validateValue(s.values, entryValue, pathForProp(path, key), issues, options);
      }
      return;
    }
    case "optional": {
      const s = schema as OptionalSchema;
      if (value === undefined) {
        return;
      }
      validateValue(s.inner, value, path, issues, options);
      return;
    }
    case "tag": {
      if (value !== true) {
        pushIssue(issues, path, "Expected true");
      }
      return;
    }
    case "taggedUnion": {
      const s = schema as TaggedUnionSchema;
      if (!isObject(value)) {
        pushIssue(issues, path, "Expected object");
        return;
      }
      const tagKey = s.tag ?? "kind";
      const tagValue = value[tagKey];
      const tagPath = pathForProp(path, tagKey);
      if (typeof tagValue !== "string") {
        pushIssue(issues, tagPath, `Expected tag \"${tagKey}\" to be a string`);
        return;
      }
      const variant = s.variants[tagValue];
      if (!variant) {
        pushIssue(issues, tagPath, `Unknown tag \"${tagValue}\"`);
        return;
      }
      validateValue(variant, value, path, issues, options);
      return;
    }
    default: {
      pushIssue(issues, path, `Unknown schema type "${schema.type}"`);
      return;
    }
  }
};
