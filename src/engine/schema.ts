export type SchemaMeta = { kind?: string; [key: string]: unknown };

export type SchemaLike = { type: string; required?: boolean; meta?: SchemaMeta };

export type SchemaBase<Type extends string> = {
  type: Type;
  required?: boolean;
  meta?: SchemaMeta;
};

export type LiteralValue = string | number | boolean | null;

export type StringSchema = SchemaBase<"string"> & {
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  default?: string;
};

export type NumberSchema = SchemaBase<"number"> & {
  min?: number;
  max?: number;
  integer?: boolean;
  finite?: boolean;
  default?: number;
};

export type BooleanSchema = SchemaBase<"boolean"> & {
  default?: boolean;
};

export type EnumSchema<Values extends readonly string[] = readonly string[]> =
  SchemaBase<"enum"> & {
    values: Values;
    default?: Values[number];
  };

export type LiteralSchema<Value extends LiteralValue = LiteralValue> =
  SchemaBase<"literal"> & {
    value: Value;
    default?: Value;
  };

export type ObjectSchema<
  Props extends Record<string, SchemaLike> = Record<string, SchemaLike>,
> = SchemaBase<"object"> & {
  properties: Props;
  allowUnknown?: boolean;
};

export type ArraySchema<Item extends SchemaLike = SchemaLike> =
  SchemaBase<"array"> & {
    items: Item;
    minItems?: number;
    maxItems?: number;
  };

export type TupleSchema<Items extends readonly SchemaLike[] = readonly SchemaLike[]> =
  SchemaBase<"tuple"> & {
    items: Items;
  };

export type MapSchema<ValueSchema extends SchemaLike = SchemaLike> =
  SchemaBase<"map"> & {
    values: ValueSchema;
  };

export type OptionalSchema<Inner extends SchemaLike = SchemaLike> =
  SchemaBase<"optional"> & {
    inner: Inner;
  };

export type TagSchema = SchemaBase<"tag">;

export type TaggedUnionSchema<
  TagKey extends string = "kind",
  Variants extends Record<string, ObjectSchema> = Record<string, ObjectSchema>,
> = SchemaBase<"taggedUnion"> & {
  tag?: TagKey;
  variants: Variants;
  // If omitted, default is derived from the first declared variant.
  default?: SchemaValue<Variants[keyof Variants]>;
};

type TaggedUnionOptions<
  TagKey extends string,
  Variants extends Record<string, ObjectSchema>,
> = Omit<TaggedUnionSchema<TagKey, Variants>, "type" | "tag" | "variants">;

export type Schema =
  | StringSchema
  | NumberSchema
  | BooleanSchema
  | EnumSchema
  | LiteralSchema
  | ObjectSchema
  | ArraySchema
  | TupleSchema
  | MapSchema
  | OptionalSchema
  | TaggedUnionSchema
  | TagSchema;

export type UnwrapOptional<S extends SchemaLike> =
  S extends OptionalSchema<infer Inner> ? Inner : S;

export type OptionalKeys<Props extends Record<string, SchemaLike>> = {
  [K in keyof Props]: Props[K] extends OptionalSchema ? K : never;
}[keyof Props];

export type RequiredKeys<Props extends Record<string, SchemaLike>> = Exclude<
  keyof Props,
  OptionalKeys<Props>
>;

export type ObjectValue<Props extends Record<string, SchemaLike>> = {
  [K in RequiredKeys<Props>]: SchemaValue<Props[K]>;
} & {
  [K in OptionalKeys<Props>]?: SchemaValue<UnwrapOptional<Props[K]>>;
};

export type SchemaValue<S extends SchemaLike> = S extends TagSchema
  ? true
  : S extends StringSchema
    ? string
    : S extends NumberSchema
      ? number
      : S extends BooleanSchema
        ? boolean
        : S extends EnumSchema<infer Values>
          ? Values[number]
          : S extends LiteralSchema<infer Value>
            ? Value
            : S extends ArraySchema<infer Item>
              ? SchemaValue<Item>[]
              : S extends TupleSchema<infer Items>
                ? { [K in keyof Items]: SchemaValue<Items[K]> }
                : S extends MapSchema<infer ValueSchema>
                  ? Record<string, SchemaValue<ValueSchema>>
                  : S extends OptionalSchema<infer Inner>
                    ? SchemaValue<Inner> | undefined
                    : S extends ObjectSchema<infer Props>
                      ? ObjectValue<Props>
                      : S extends TaggedUnionSchema<any, infer Variants>
                        ? SchemaValue<Variants[keyof Variants]>
                        : unknown;

export type Prettify<T> = T extends readonly any[]
  ? T
  : T extends object
    ? { [K in keyof T]: T[K] }
    : T;

export type InferSchema<S extends SchemaLike> = Prettify<SchemaValue<S>>;

export const defineSchema = <const S extends Schema>(schema: S): S => schema;

function tagged<const Variants extends Record<string, ObjectSchema>>(
  variants: Variants,
  options?: TaggedUnionOptions<"kind", Variants>
): TaggedUnionSchema<"kind", Variants>;
function tagged<TagKey extends string, const Variants extends Record<string, ObjectSchema>>(
  tag: TagKey,
  variants: Variants,
  options?: TaggedUnionOptions<TagKey, Variants>
): TaggedUnionSchema<TagKey, Variants>;
function tagged(
  tagOrVariants: unknown,
  variantsOrOptions?: unknown,
  options?: unknown
): TaggedUnionSchema<any, any> {
  const tag = typeof tagOrVariants === "string" ? tagOrVariants : "kind";
  const variants =
    typeof tagOrVariants === "string"
      ? (variantsOrOptions as Record<string, ObjectSchema> | undefined)
      : (tagOrVariants as Record<string, ObjectSchema>);
  const maybeOptions =
    typeof tagOrVariants === "string"
      ? (options as TaggedUnionOptions<string, Record<string, ObjectSchema>> | undefined)
      : (variantsOrOptions as
          | TaggedUnionOptions<string, Record<string, ObjectSchema>>
          | undefined);
  return {
    type: "taggedUnion",
    tag,
    variants: variants ?? {},
    ...(maybeOptions ?? {}),
  };
}

export const s = {
  string: (options: Omit<StringSchema, "type"> = {}): StringSchema => ({
    type: "string",
    ...options,
  }),
  number: (options: Omit<NumberSchema, "type"> = {}): NumberSchema => ({
    type: "number",
    ...options,
  }),
  boolean: (options: Omit<BooleanSchema, "type"> = {}): BooleanSchema => ({
    type: "boolean",
    ...options,
  }),
  enum: <const Values extends readonly string[]>(
    values: Values,
    options: Omit<EnumSchema<Values>, "type" | "values"> = {}
  ): EnumSchema<Values> => ({
    type: "enum",
    values,
    ...options,
  }),
  literal: <Value extends LiteralValue>(
    value: Value,
    options: Omit<LiteralSchema<Value>, "type" | "value"> = {}
  ): LiteralSchema<Value> => ({
    type: "literal",
    value,
    ...options,
  }),
  object: <const Props extends Record<string, SchemaLike>>(
    properties: Props,
    options: Omit<ObjectSchema<Props>, "type" | "properties"> = {}
  ): ObjectSchema<Props> => ({
    type: "object",
    properties,
    ...options,
  }),
  array: <Item extends SchemaLike>(
    items: Item,
    options: Omit<ArraySchema<Item>, "type" | "items"> = {}
  ): ArraySchema<Item> => ({
    type: "array",
    items,
    ...options,
  }),
  tuple: <const Items extends readonly SchemaLike[]>(
    items: Items
  ): TupleSchema<Items> => ({
    type: "tuple",
    items,
  }),
  map: <ValueSchema extends SchemaLike>(
    values: ValueSchema
  ): MapSchema<ValueSchema> => ({
    type: "map",
    values,
  }),
  optional: <Inner extends SchemaLike>(
    inner: Inner
  ): OptionalSchema<Inner> => ({
    type: "optional",
    inner,
  }),
  tagged,
  tag: (): TagSchema => ({
    type: "tag",
  }),
} as const;

const getDefaultValue = (schema: SchemaLike): unknown => {
  switch (schema.type) {
    case "string": {
      const s = schema as StringSchema;
      return s.default ?? "";
    }
    case "number": {
      const s = schema as NumberSchema;
      return s.default ?? 0;
    }
    case "boolean": {
      const s = schema as BooleanSchema;
      return s.default ?? false;
    }
    case "enum": {
      const s = schema as EnumSchema;
      return s.default ?? s.values[0];
    }
    case "literal": {
      const s = schema as LiteralSchema;
      return s.default ?? s.value;
    }
    case "object": {
      const s = schema as ObjectSchema;
      const result: Record<string, unknown> = {};
      for (const [key, propSchema] of Object.entries(s.properties)) {
        if (propSchema.type === "optional") {
          continue;
        }
        result[key] = getDefaultValue(propSchema);
      }
      return result;
    }
    case "array": {
      return [];
    }
    case "tuple": {
      const s = schema as TupleSchema;
      return s.items.map((item) => getDefaultValue(item));
    }
    case "map": {
      return {};
    }
    case "optional": {
      return undefined;
    }
    case "tag": {
      return true;
    }
    case "taggedUnion": {
      const s = schema as TaggedUnionSchema;
      if (s.default !== undefined) {
        return s.default;
      }
      const variantKeys = Object.keys(s.variants);
      if (variantKeys.length === 0) {
        return undefined;
      }
      return getDefaultValue(s.variants[variantKeys[0]]);
    }
    default: {
      return undefined;
    }
  }
};

export const getDefault = <S extends SchemaLike>(schema: S): SchemaValue<S> =>
  getDefaultValue(schema) as SchemaValue<S>;
