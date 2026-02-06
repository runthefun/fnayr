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
- `pnpm test:run` – run test suite

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
  Visible: s.tag(),
};

const worldJson = {
  version: 1,
  entities: [
    {
      id: 1,
      components: {
        Transform: { position: [1, 2] },
        Name: { label: "Hero" },
        Visible: true,
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

### Basic world and systems

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

scheduler.runFrame(0.5);
```

### Tags (marker components)

Tag components carry no data — useful for flags like "Visible" or "Player":

```ts
const registry = {
  Player: s.tag(),
  Position: s.object({ x: s.number(), y: s.number() }),
};

const world = ecs.createWorld(registry);
const e = world.createEntity();
world.addComponent(e, "Player");        // no data argument needed
world.addComponent(e, "Position", { x: 0, y: 0 });
```

### In-place mutation with dirty tracking

`getMut` returns the component reference and marks it as updated for change tracking:

```ts
const pos = world.getMut(entity, "Position");
if (pos) {
  pos.x += 10; // mutate in place, change tracking records the update
}
```

### Change tracking

Each frame tracks which entities had components added, removed, or updated:

```ts
scheduler.addSystem((world) => {
  for (const entity of world.getAdded("Position")) {
    // entity just received a Position component this frame
  }
  for (const entity of world.getUpdated("Position")) {
    // entity's Position was modified this frame
  }
  for (const entity of world.getRemoved("Position")) {
    // entity's Position was removed this frame
  }
});
```

### Cached queries

For hot-path iteration, cached queries maintain a live set of matched entities incrementally:

```ts
const movers = world.createQuery(["Transform", "Velocity"]);

scheduler.addSystem(() => {
  for (const { entity, components } of movers) {
    // iterates only entities matching the query
  }
  console.log(movers.size); // number of matched entities
});
```

### System phases

The scheduler supports named execution phases for deterministic ordering:

```ts
const scheduler = new ecs.Scheduler(world, ["input", "update", "render"]);
scheduler.addSystem("input", handleInput);
scheduler.addSystem("update", physics);
scheduler.addSystem("update", ai);
scheduler.addSystem("render", draw);

scheduler.disableSystem(ai);  // skip a system
scheduler.enableSystem(ai);   // re-enable it
scheduler.removeSystem(draw); // remove entirely
```

### Command buffer (deferred mutations)

Each system receives a `commands` argument for safe mutations during iteration:

```ts
scheduler.addSystem((world, dt, commands) => {
  for (const { entity, components } of world.query(["Health"])) {
    if (components.Health.hp <= 0) {
      commands.destroyEntity(entity);  // deferred until after system returns
    }
  }
  const spawned = commands.createEntity(); // immediate, returns usable ID
  commands.addComponent(spawned, "Position", { x: 0, y: 0 });
});
```

### Resources (singletons)

Resources are typed singleton values, not attached to entities:

```ts
const resources = {
  Time: s.object({ elapsed: s.number() }),
  Config: s.object({ gravity: s.number() }),
};

const world = ecs.createWorld(registry, { resources });
world.setResource("Time", { elapsed: 0 });
world.getResource("Time"); // { elapsed: 0 }
world.hasResource("Config"); // false
```

### Events

Frame-buffered typed events decouple producer and consumer systems:

```ts
const events = {
  Collision: s.object({ a: s.number(), b: s.number() }),
};

const world = ecs.createWorld(registry, { resources: {}, events });

// producer system
scheduler.addSystem((world) => {
  world.emit("Collision", { a: entityA, b: entityB });
});

// consumer system (runs later in the same frame)
scheduler.addSystem((world) => {
  for (const event of world.read("Collision")) {
    console.log("collision between", event.a, event.b);
  }
});
```

Events accumulate during a frame and are cleared at the start of the next frame.

### Entity hierarchy

Parent-child relationships with cascade destroy:

```ts
const hierarchy = new ecs.Hierarchy(world);

const parent = world.createEntity();
const child = world.createEntity();
hierarchy.setParent(child, parent);

hierarchy.getParent(child);       // parent
hierarchy.getChildren(parent);    // [child]
hierarchy.isDescendantOf(child, parent); // true

world.destroyEntity(parent); // also destroys child
```

### Batch entity creation

`spawn` creates multiple entities with components in one call:

```ts
const entities = world.spawn(100, {
  Position: (i) => ({ x: i * 10, y: 0 }),
  Velocity: { x: 1, y: 0 },  // static value shared by all
});
```

### Debug stats

```ts
world.entityCount;              // number of alive entities
world.componentCount("Position"); // entities with Position
world.stats();                  // { entities: N, components: { Position: N, ... } }
world.clear();                  // destroy all entities and reset
```

### Runtime/JSON bridge

```ts
const { world: runtimeWorld, issues } = ecs.worldFromJson(registry, worldJson, {
  allowUnknownComponents: true,
});

const serialized = ecs.worldToJson(registry, runtimeWorld, {
  stripUnknownComponents: false,
});
```
