import { s, defineSchema } from "../schema";
import { vec3Schema } from "../math";
import { assetRef } from "../asset";

const finiteNumber = s.number({ finite: true });

/** Quaternion with identity default [0, 0, 0, 1] */
export const quatIdentitySchema = defineSchema({
  ...s.tuple([
    s.number({ finite: true, default: 0 }),
    s.number({ finite: true, default: 0 }),
    s.number({ finite: true, default: 0 }),
    s.number({ finite: true, default: 1 }),
  ]),
  meta: { kind: "euler" },
});

/** Vec3 with default [1, 1, 1] for scale */
export const scaleVec3Schema = defineSchema(
  s.tuple([
    s.number({ finite: true, default: 1 }),
    s.number({ finite: true, default: 1 }),
    s.number({ finite: true, default: 1 }),
  ])
);

/** RGBA color tuple with default opaque light gray [0.8, 0.8, 0.8, 1.0] */
export const colorTuple = defineSchema({
  ...s.tuple([
    s.number({ finite: true, min: 0, max: 1, default: 0.8 }),
    s.number({ finite: true, min: 0, max: 1, default: 0.8 }),
    s.number({ finite: true, min: 0, max: 1, default: 0.8 }),
    s.number({ finite: true, min: 0, max: 1, default: 1.0 }),
  ]),
  meta: { kind: "color" },
});

/** RGB color tuple (no alpha) with default light gray [0.8, 0.8, 0.8] */
export const colorRgbTuple = defineSchema({
  ...s.tuple([
    s.number({ finite: true, min: 0, max: 1, default: 0.8 }),
    s.number({ finite: true, min: 0, max: 1, default: 0.8 }),
    s.number({ finite: true, min: 0, max: 1, default: 0.8 }),
  ]),
  meta: { kind: "color" },
});

export const Transform3D = defineSchema(
  s.object({
    position: vec3Schema,
    rotation: quatIdentitySchema,
    scale: scaleVec3Schema,
  })
);

export const VisualRenderer = defineSchema(
  s.tagged("kind", {
    mesh: s.object({
      kind: s.literal("mesh"),
    }),
    model: s.object({
      kind: s.literal("model"),
      asset: assetRef("glb", { hidden: ["sub", "options"] }),
    }),
  })
);

export const Geometry = defineSchema(
  s.tagged("kind", {
    box: s.object({
      kind: s.literal("box"),
      width: s.number({ finite: true, default: 1 }),
      height: s.number({ finite: true, default: 1 }),
      depth: s.number({ finite: true, default: 1 }),
    }),
    sphere: s.object({
      kind: s.literal("sphere"),
      radius: s.number({ finite: true, default: 0.5 }),
      widthSegments: s.number({ integer: true, default: 32 }),
      heightSegments: s.number({ integer: true, default: 16 }),
    }),
    plane: s.object({
      kind: s.literal("plane"),
      width: s.number({ finite: true, default: 1 }),
      height: s.number({ finite: true, default: 1 }),
    }),
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

export const Background = defineSchema(
  s.object({
    color: colorRgbTuple,
    intensity: s.number({ default: 1, min: 0 }),
    blurriness: s.number({ default: 0, min: 0, max: 1 }),
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

export const MeshMaterial = defineSchema(
  s.object({
    texture: assetRef("texture", { hidden: ["sub", "options"] }),
    color: colorTuple,
  })
);

export const renderingResources = {
  LoadingState,
} as const;

export const renderingRegistry = {
  Transform3D,
  VisualRenderer,
  Geometry,
  Spin,
  DirectionalLight,
  AmbientLight,
  PointLight,
  SpotLight,
  Background,
  MeshMaterial,
} as const;
