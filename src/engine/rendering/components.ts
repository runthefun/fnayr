import { s, defineSchema } from "../schema";
import { vec3Schema } from "../math";

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

export const Spin = defineSchema(
  s.object({
    speed: s.number({ default: 1 }),
  })
);

export const renderingRegistry = {
  Transform3D,
  MeshRenderer,
  Spin,
} as const;
