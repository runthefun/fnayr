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

export const assetRefSchema = defineSchema(
  {
    ...s.object({
      kind: s.literal("asset"),
      type: s.enum(assetTypeValues),
      uri: s.string(),
      sub: s.optional(s.string()),
      options: s.optional(s.object({}, { allowUnknown: true })),
    }),
    meta: { kind: "assetRef" },
  }
);

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
