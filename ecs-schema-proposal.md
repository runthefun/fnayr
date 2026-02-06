# ECS Schema Proposal (v1)

## Goals

- Component/entity data is **pure JSON**.
- Use **optional fields** instead of `null`.
- Every component defines a **schema** for:
  - validation
  - defaults
  - canonical serialization/deserialization

## Canonical JSON Encodings

### Math Types (tuple arrays)

- `vec2`: `[x, y]`
- `vec3`: `[x, y, z]`
- `vec4`: `[x, y, z, w]`
- `quat`: `[x, y, z, w]`
- `mat4`: `[m00, m01, m02, m03, m10, m11, m12, m13, m20, m21, m22, m23, m30, m31, m32, m33]`
- `color`: `[r, g, b, a]` where each channel is `0..1`

## Schema Types

### Scalars

- `string` (min/max length, pattern)
- `number` (min/max, integer, finite-only)
- `boolean`
- `enum` (string enums)
- `literal` (exact match)

### Structural

- `object(shape)`:
  - properties with per-field schemas
  - optional properties (absence = undefined)
- `array(itemSchema)` (min/max items)
- `tuple([s1, s2, ...])` (fixed-length arrays)
- `map(valueSchema)` encoded as JSON object `{ [key: string]: V }`

### Wrappers

- `optional(inner)`:
  - field may be absent (undefined)

Example (defaults inline):

```
scale: { type: "number", default: 1 }
```

### Sum Types

- `taggedUnion(tagKey, variants)`:
  - discriminated objects: `{ kind: "box", ... } | { kind: "sphere", ... }`
  - unknown tag ⇒ validation error
  - default can be set explicitly; if omitted, default falls back to the first variant

## Assets

### Asset Reference (object form)

```
{
  "type": "texture" | "glb" | "videoClip" | "audioClip",
  "uri": "path/or/url",
  "sub"?: "optional-subresource",
  "options"?: { [key: string]: Json }
}
```

- `options` stays JSON to allow loader-specific parameters.
- More asset types can be added later.

## Validation & Errors

- Validate component data against its schema at component boundaries.
- Collect **all** issues (don’t fail fast).
- Each issue includes:
  - JSON path (e.g. `$.components.Transform.position[2]`)
  - message (human-readable)
- Paths use dot notation for identifier-like keys and bracket-notation for others:
  - `$.foo.bar`
  - `$["foo-bar"]`
  - `$.items[0]`
- `taggedUnion` requires the tag property to be a string; unknown tags are errors.

## Defaults & Optional Fields

- `optional(T)` means field may be absent.
- Defaults apply **only** when a field is missing.
- Defaults are supported on scalar schemas and `taggedUnion`.
- Natural defaults for scalars:
  - `string`: `""`
  - `number`: `0`
  - `boolean`: `false`
  - `enum`: first value in `values`
  - `literal`: the literal value
- Compound defaults are composed from their components; optional fields default to absent.
- Avoid `null` unless a future `nullable(T)` is explicitly added.

## ECS JSON Shape (v1)

- Entity JSON:

```
{ "id": 1, "components": { "Transform": { ... }, "Mesh": { ... } } }
```

- World JSON:

```
{ "version": 1, "entities": [ ... ] }
```

## Deserialization Policy (recommended)

- `allowUnknownComponents`:
  - `false` (strict): unknown components are errors
  - `true` (permissive): preserve unknown component blobs as raw JSON

## Deferred / Future Considerations

- Schema versioning + migrations
- Numeric “flavors” (degrees/radians, normalized, etc.)
- Cross-reference types (`entityRef`, `assetRef` validation against registries)
- Canonicalization rules (e.g. float rounding) if deterministic diffs become important

## TODOs / Next Steps

- [x] Define TypeScript schema shapes and inference helpers (`defineSchema`, `InferSchema`, `Prettify`).
- [x] Implement runtime validation with path-aware error reporting.
- [x] Add Vitest coverage for all schema types and edge cases.
- [x] Implement default materialization (`getDefault(schema)`), including tagged-union fallback to first variant.
- [x] Add schema authoring helpers (e.g. `s.object`, `s.number`, `s.optional`) to reduce boilerplate.
- [x] Add validation options (e.g. strict/allow-unknown properties) once a policy is chosen.
- [x] Define serializer/deserializer API surface (inputs/outputs/options).
- [x] Implement canonical encoders/decoders for math tuples (`vec2/3/4`, `quat`, `mat4`, `color`).
- [x] Add asset reference schema + encode/decode helpers.
- [x] Implement entity/world parsing with versioning (`{ version: 1, entities: [...] }`).
- [x] Implement `allowUnknownComponents` behavior (strict vs preserve blobs).
- [x] Decide policy for unknown object properties (strict vs allow).
- [x] Add round-trip tests for serialize → deserialize → serialize stability.
- [x] Add boundary tests for world/entity/component error paths.
