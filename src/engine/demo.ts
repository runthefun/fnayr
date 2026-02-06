import { s, type InferSchema } from "./schema";

export const transformSchema = s.object({
  position: s.tuple([s.number(), s.number(), s.number()]),
  scale: s.number({ default: 1 }),
  name: s.optional(s.string()),
});

export const tagsSchema = s.array(s.string());

export const colliderSchema = s.tagged("kind", {
  box: s.object({
    kind: s.literal("box"),
    size: s.tuple([s.number(), s.number(), s.number()]),
  }),
  sphere: s.object({
    kind: s.literal("sphere"),
    radius: s.number({ min: 0 }),
  }),
});

export type Transform = InferSchema<typeof transformSchema>;
export type TransformPosition = InferSchema<
  typeof transformSchema.properties.position
>;
export type TransformScale = InferSchema<typeof transformSchema.properties.scale>;
export type TransformName = InferSchema<typeof transformSchema.properties.name>;
export type Tags = InferSchema<typeof tagsSchema>;
export type Collider = InferSchema<typeof colliderSchema>;
export type ColliderBox = InferSchema<typeof colliderSchema.variants.box>;
export type ColliderSphere = InferSchema<typeof colliderSchema.variants.sphere>;

export const exampleTransform: Transform = {
  position: [1, 2, 3],
  scale: 2,
};

export const exampleTags: Tags = ["player", "controllable"];

export const exampleCollider: Collider = {
  kind: "sphere",
  radius: 0.5,
};
