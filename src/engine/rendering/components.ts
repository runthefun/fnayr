import { s, defineSchema } from "../schema";
import { vec3Schema } from "../math";
import { assetRefSchema } from "../asset";

const finiteNumber = s.number({ finite: true });

/** Quaternion with identity default [0, 0, 0, 1] */
export const quatIdentitySchema = defineSchema(
  s.tuple([
    s.number({ finite: true, default: 0 }),
    s.number({ finite: true, default: 0 }),
    s.number({ finite: true, default: 0 }),
    s.number({ finite: true, default: 1 }),
  ])
);

/** Vec3 with default [1, 1, 1] for scale */
export const scaleVec3Schema = defineSchema(
  s.tuple([
    s.number({ finite: true, default: 1 }),
    s.number({ finite: true, default: 1 }),
    s.number({ finite: true, default: 1 }),
  ])
);

/** RGBA color tuple with default opaque light gray [0.8, 0.8, 0.8, 1.0] */
export const colorTuple = defineSchema(
  s.tuple([
    s.number({ finite: true, min: 0, max: 1, default: 0.8 }),
    s.number({ finite: true, min: 0, max: 1, default: 0.8 }),
    s.number({ finite: true, min: 0, max: 1, default: 0.8 }),
    s.number({ finite: true, min: 0, max: 1, default: 1.0 }),
  ])
);

export const Transform3D = defineSchema(
  s.object({
    position: vec3Schema,
    rotation: quatIdentitySchema,
    scale: scaleVec3Schema,
  })
);

export const MeshRenderer = defineSchema(
  s.object({
    geometry: s.enum(["box", "sphere", "plane"] as const, { default: "box" }),
    color: colorTuple,
  })
);

export const ModelRenderer = defineSchema(
  s.object({
    asset: assetRefSchema,
  })
);

export const Spin = defineSchema(
  s.object({
    speed: s.number({ default: 1 }),
  })
);

export const DirectionalLight = defineSchema(
  s.object({
    color: colorTuple,
    intensity: s.number({ default: 1, min: 0 }),
  })
);

export const AmbientLight = defineSchema(
  s.object({
    color: colorTuple,
    intensity: s.number({ default: 1, min: 0 }),
  })
);

export const PointLight = defineSchema(
  s.object({
    color: colorTuple,
    intensity: s.number({ default: 1, min: 0 }),
    distance: s.number({ default: 0, min: 0 }),
    decay: s.number({ default: 2, min: 0 }),
  })
);

export const SpotLight = defineSchema(
  s.object({
    color: s.number({ integer: true, default: 0xffffff }),
    intensity: s.number({ default: 1 }),
    distance: s.number({ default: 0 }),
    angle: s.number({ default: Math.PI / 3 }),
    penumbra: s.number({ default: 0 }),
    decay: s.number({ default: 2 }),
    castShadow: s.boolean({ default: false }),
    showHelper: s.boolean({ default: false }),
  })
);

export const LoadingState = defineSchema(
  s.object({
    pending: s.number({ integer: true, default: 0 }),
    ready: s.number({ integer: true, default: 0 }),
    failed: s.number({ integer: true, default: 0 }),
    total: s.number({ integer: true, default: 0 }),
    blockGameplay: s.boolean({ default: false }),
  })
);

export const renderingResources = {
  LoadingState,
} as const;

export const renderingRegistry = {
  Transform3D,
  MeshRenderer,
  ModelRenderer,
  Spin,
  DirectionalLight,
  AmbientLight,
  PointLight,
  SpotLight,
} as const;
