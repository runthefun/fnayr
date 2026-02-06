# fnayr (Vite + React)

## Requirements

- Node.js 18+

## Setup

```sh
pnpm install
pnpm dev
```

Then open the URL shown in the terminal.

## Scripts

- `pnpm dev` – start dev server
- `pnpm build` – production build
- `pnpm preview` – preview production build
- `pnpm typecheck` – TypeScript typecheck

## ECS Schema Usage

The engine exposes helpers to define component schemas and parse/serialize ECS worlds.

```ts
import { parseWorld, serializeWorld, s } from "./src/engine";

const registry = {
  Transform: s.object({
    position: s.tuple([s.number(), s.number()]),
    scale: s.number({ default: 1 }),
  }),
  Name: s.object({
    label: s.string(),
  }),
};

const worldJson = {
  version: 1,
  entities: [
    {
      id: 1,
      components: {
        Transform: { position: [1, 2] },
        Name: { label: "Hero" },
      },
    },
  ],
};

const parsed = parseWorld(registry, worldJson, {
  applyDefaults: true,
  allowUnknownComponents: false,
  validation: { allowUnknownProperties: false },
});

if (parsed.issues.length > 0) {
  console.log(parsed.issues);
}

const serialized = serializeWorld(registry, parsed.world, {
  stripUnknownComponents: false,
});

console.log(serialized.json, serialized.issues);
```

Common patterns:

- Preserve modded components (permissive):
  - `parseWorld(registry, json, { allowUnknownComponents: true })`
- Allow per-object freeform JSON (e.g. asset options):
  - `s.object({}, { allowUnknown: true })`
- Keep serialization strict but non-destructive:
  - `serializeWorld(registry, world, { stripUnknownComponents: false })`

## ECS Runtime Usage

The runtime ECS API is available under the `ecs` namespace export.

```ts
import { ecs, s } from "./src/engine";

const registry = {
  Transform: s.object({ x: s.number() }),
  Velocity: s.object({ x: s.number() }),
};

const world = ecs.createWorld(registry);
const entity = world.createEntity();
world.addComponent(entity, "Transform", { x: 0 });
world.addComponent(entity, "Velocity", { x: 2 });

const scheduler = new ecs.Scheduler(world);
scheduler.addSystem((world, dt) => {
  for (const { entity, components } of world.query(["Transform", "Velocity"])) {
    world.addComponent(entity, "Transform", {
      x: components.Transform.x + components.Velocity.x * dt,
    });
  }
});

world.beginFrame();
scheduler.runFrame(0.5);
world.endFrame();
```

Runtime/JSON bridge helpers:

```ts
const { world: runtimeWorld, issues } = ecs.worldFromJson(registry, worldJson, {
  allowUnknownComponents: true,
});

const serialized = ecs.worldToJson(registry, runtimeWorld, {
  stripUnknownComponents: false,
});
```
