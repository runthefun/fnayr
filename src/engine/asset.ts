import {
  deserialize,
  serialize,
  type DeserializeOptions,
  type DeserializeResult,
  type JsonValue,
  type SerializeOptions,
  type SerializeResult,
} from "./codec";
import {
  defineSchema,
  s,
  type InferSchema,
  type SchemaLike,
  type SchemaValue,
} from "./schema";

export const assetTypeValues = [
  "texture",
  "glb",
  "videoClip",
  "audioClip",
] as const;

export type AssetType = (typeof assetTypeValues)[number];
export type AssetOptions = Record<string, JsonValue>;

type AssetRefOptions = {
  /** Property names to hide in the editor UI. */
  hidden?: string[];
};

export function assetRef<const T extends readonly AssetType[]>(
  ...args: [...T] | [...T, AssetRefOptions]
) {
  const opts: AssetRefOptions =
    typeof args[args.length - 1] === "object" && !Array.isArray(args[args.length - 1]) && typeof args[args.length - 1] !== "string"
      ? (args.pop() as AssetRefOptions)
      : {};
  const types = args as unknown as T;
  const hide = new Set(opts.hidden);

  const typeSchema =
    types.length === 1 ? s.literal(types[0] as string) : s.enum(types as unknown as readonly string[]);

  const mark = <S extends SchemaLike>(schema: S, key: string): S =>
    hide.has(key) ? { ...schema, meta: { ...schema.meta, hidden: true } } : schema;

  return defineSchema({
    ...s.object({
      kind: s.literal("asset"),
      type: typeSchema,
      uri: s.string(),
      sub: mark(s.optional(s.string()), "sub"),
      options: mark(s.optional(s.object({}, { allowUnknown: true })), "options"),
    }),
    meta: { kind: "assetRef" },
  });
}

/** Generic asset ref that accepts any asset type. */
export const assetRefSchema = assetRef(...assetTypeValues);

export type AssetRef = InferSchema<typeof assetRefSchema> & {
  options?: AssetOptions;
};

type Codec<S extends SchemaLike> = {
  schema: S;
  encode: (
    value: SchemaValue<S> | unknown,
    options?: SerializeOptions
  ) => SerializeResult<S>;
  decode: (json: unknown, options?: DeserializeOptions) => DeserializeResult<S>;
};

const defineCodec = <S extends SchemaLike>(schema: S): Codec<S> => ({
  schema,
  encode: (value, options) => serialize(schema, value, options),
  decode: (json, options) => deserialize(schema, json, options),
});

export const assetRefCodec = defineCodec(assetRefSchema);
