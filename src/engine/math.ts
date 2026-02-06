import {
  deserialize,
  serialize,
  type DeserializeOptions,
  type DeserializeResult,
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

export type Codec<S extends SchemaLike> = {
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

const finiteNumber = s.number({ finite: true });
const colorChannel = s.number({ finite: true, min: 0, max: 1 });

export const vec2Schema = defineSchema(
  s.tuple([finiteNumber, finiteNumber])
);
export type Vec2 = InferSchema<typeof vec2Schema>;
export const vec2Codec = defineCodec(vec2Schema);

export const vec3Schema = defineSchema(
  s.tuple([finiteNumber, finiteNumber, finiteNumber])
);
export type Vec3 = InferSchema<typeof vec3Schema>;
export const vec3Codec = defineCodec(vec3Schema);

export const vec4Schema = defineSchema(
  s.tuple([finiteNumber, finiteNumber, finiteNumber, finiteNumber])
);
export type Vec4 = InferSchema<typeof vec4Schema>;
export const vec4Codec = defineCodec(vec4Schema);

export const quatSchema = defineSchema(
  s.tuple([finiteNumber, finiteNumber, finiteNumber, finiteNumber])
);
export type Quat = InferSchema<typeof quatSchema>;
export const quatCodec = defineCodec(quatSchema);

export const mat4Schema = defineSchema(
  s.tuple([
    finiteNumber,
    finiteNumber,
    finiteNumber,
    finiteNumber,
    finiteNumber,
    finiteNumber,
    finiteNumber,
    finiteNumber,
    finiteNumber,
    finiteNumber,
    finiteNumber,
    finiteNumber,
    finiteNumber,
    finiteNumber,
    finiteNumber,
    finiteNumber,
  ])
);
export type Mat4 = InferSchema<typeof mat4Schema>;
export const mat4Codec = defineCodec(mat4Schema);

export const colorSchema = defineSchema(
  s.tuple([colorChannel, colorChannel, colorChannel, colorChannel])
);
export type Color = InferSchema<typeof colorSchema>;
export const colorCodec = defineCodec(colorSchema);
