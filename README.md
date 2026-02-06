# fnayr

A lightweight, schema-driven **Entity Component System** (ECS) engine for TypeScript. Define your components with schemas, build worlds from JSON, and run game logic with systems, queries, events, and hierarchy — all fully typed.

Built on Vite + React.

## Table of Contents

- [Getting Started](#getting-started)
- [Scripts](#scripts)
- [Schemas — Define Your Data](#schemas--define-your-data)
  - [Building a Registry](#building-a-registry)
  - [Parsing & Serializing Worlds](#parsing--serializing-worlds)
  - [Common Patterns](#common-patterns)
- [Runtime — Bring It to Life](#runtime--bring-it-to-life)
  - [Creating a World](#creating-a-world)
  - [Systems & the Scheduler](#systems--the-scheduler)
  - [Tags](#tags)
  - [In-Place Mutation](#in-place-mutation)
  - [Change Tracking](#change-tracking)
  - [Cached Queries](#cached-queries)
  - [System Phases](#system-phases)
  - [Command Buffer](#command-buffer)
  - [Resources](#resources)
  - [Events](#events)
  - [Entity Hierarchy](#entity-hierarchy)
  - [Batch Spawning](#batch-spawning)
  - [Debug Stats](#debug-stats)
  - [Runtime/JSON Bridge](#runtimejson-bridge)

## Getting Started

**You'll need:** Node.js 18+ and [pnpm](https://pnpm.io/)

```sh
pnpm install   # grab dependencies
pnpm dev       # start the dev server at http://localhost:5173
```

That's it — open the URL and you're running.

## Scripts

| Command            | What it does                 |
| ------------------ | ---------------------------- |
| `pnpm dev`         | Start dev server with HMR    |
| `pnpm build`       | Production build to `dist/`  |
| `pnpm preview`     | Preview the production build |
| `pnpm typecheck`   | TypeScript type checking     |
| `pnpm test:run`    | Run the test suite           |

---

## Schemas — Define Your Data

Before you can create worlds and entities, you describe what your components look like. The schema system gives you validation, defaults, and JSON round-tripping for free.

### Building a Registry

A registry is just an object mapping component names to schemas. Use the `s` helper:

```ts
import { s } from "./src/engine";

const registry = {
  Transform: s.object({
    position: s.tuple([s.number(), s.number()]),
    scale: s.number({ default: 1 }),
  }),
  Name: s.object({
    label: s.string(),
  }),
  Visible: s.tag(), // marker component, no data
};
```

Available types: `s.number()`, `s.string()`, `s.boolean()`, `s.tuple()`, `s.object()`, and `s.tag()`.

### Parsing & Serializing Worlds

Got a JSON file describing a world? Parse it into a validated structure, then serialize it back whenever you need to save:

```ts
import { parseWorld, serializeWorld } from "./src/engine";

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

// JSON -> validated world
const parsed = parseWorld(registry, worldJson, {
  applyDefaults: true,
  allowUnknownComponents: false,
  validation: { allowUnknownProperties: false },
});

if (parsed.issues.length > 0) {
  console.log(parsed.issues); // see what went wrong
}

// validated world -> JSON
const serialized = serializeWorld(registry, parsed.world, {
  stripUnknownComponents: false,
});
```

### Common Patterns

| What you want | How to get it |
| ------------- | ------------- |
| Keep modded/unknown components intact | `parseWorld(registry, json, { allowUnknownComponents: true })` |
| Allow freeform JSON inside an object | `s.object({}, { allowUnknown: true })` |
| Serialize strictly without losing data | `serializeWorld(registry, world, { stripUnknownComponents: false })` |

---

## Runtime — Bring It to Life

Once you have a registry, the runtime API (under the `ecs` namespace) lets you create worlds, spawn entities, run systems, and react to changes — all fully typed against your schema.

### Creating a World

```ts
import { ecs, s } from "./src/engine";

const registry = {
  Position: s.object({ x: s.number(), y: s.number() }),
  Velocity: s.object({ x: s.number(), y: s.number() }),
};

const world = ecs.createWorld(registry);

const entity = world.createEntity();
world.addComponent(entity, "Position", { x: 0, y: 0 });
world.addComponent(entity, "Velocity", { x: 2, y: 1 });
```

### Systems & the Scheduler

Systems are just functions. The scheduler calls them every frame with the world and a delta time:

```ts
const scheduler = new ecs.Scheduler(world);

scheduler.addSystem((world, dt) => {
  for (const { entity, components } of world.query(["Position", "Velocity"])) {
    world.addComponent(entity, "Position", {
      x: components.Position.x + components.Velocity.x * dt,
      y: components.Position.y + components.Velocity.y * dt,
    });
  }
});

scheduler.runFrame(0.5); // advance by 0.5 seconds
```

### Tags

Tags are marker components with no data — perfect for flags like "Player" or "Visible":

```ts
const registry = {
  Player: s.tag(),
  Position: s.object({ x: s.number(), y: s.number() }),
};

const world = ecs.createWorld(registry);
const e = world.createEntity();
world.addComponent(e, "Player");                  // no data needed
world.addComponent(e, "Position", { x: 0, y: 0 });
```

### In-Place Mutation

Need to tweak a component without replacing it? `getMut` gives you a direct reference *and* automatically flags it as changed for tracking:

```ts
const pos = world.getMut(entity, "Position");
if (pos) {
  pos.x += 10; // mutate in place, change tracking picks it up
}
```

### Change Tracking

Every frame, the world knows exactly which entities had components added, removed, or updated:

```ts
scheduler.addSystem((world) => {
  for (const entity of world.getAdded("Position")) {
    // just got a Position this frame
  }
  for (const entity of world.getUpdated("Position")) {
    // Position was modified this frame
  }
  for (const entity of world.getRemoved("Position")) {
    // Position was taken away this frame
  }
});
```

### Cached Queries

For performance-critical loops, cached queries maintain a live set of matching entities that stays up-to-date automatically:

```ts
const movers = world.createQuery(["Position", "Velocity"]);

scheduler.addSystem(() => {
  for (const { entity, components } of movers) {
    // only iterates matching entities — no filtering overhead
  }
  console.log(movers.size); // how many match right now
});
```

### System Phases

Group systems into named phases so they always run in a predictable order:

```ts
const scheduler = new ecs.Scheduler(world, ["input", "update", "render"]);

scheduler.addSystem("input", handleInput);
scheduler.addSystem("update", physics);
scheduler.addSystem("update", ai);
scheduler.addSystem("render", draw);

scheduler.disableSystem(ai);  // temporarily skip
scheduler.enableSystem(ai);   // bring it back
scheduler.removeSystem(draw); // gone for good
```

### Command Buffer

Destroying an entity while you're iterating over a query is a recipe for bugs. The `commands` argument defers those mutations until the system finishes:

```ts
scheduler.addSystem((world, dt, commands) => {
  for (const { entity, components } of world.query(["Health"])) {
    if (components.Health.hp <= 0) {
      commands.destroyEntity(entity); // happens after this system returns
    }
  }

  // Creating entities is immediate — you get a usable ID right away
  const spawned = commands.createEntity();
  commands.addComponent(spawned, "Position", { x: 0, y: 0 });
});
```

### Resources

Resources are world-level singletons — typed values that aren't attached to any entity:

```ts
const resources = {
  Time: s.object({ elapsed: s.number() }),
  Config: s.object({ gravity: s.number() }),
};

const world = ecs.createWorld(registry, { resources });

world.setResource("Time", { elapsed: 0 });
world.getResource("Time");    // { elapsed: 0 }
world.hasResource("Config");  // false
```

### Events

Frame-buffered typed events let systems talk to each other without tight coupling:

```ts
const events = {
  Collision: s.object({ a: s.number(), b: s.number() }),
};

const world = ecs.createWorld(registry, { resources: {}, events });

// One system fires the event...
scheduler.addSystem((world) => {
  world.emit("Collision", { a: entityA, b: entityB });
});

// ...another system reacts to it
scheduler.addSystem((world) => {
  for (const event of world.read("Collision")) {
    console.log("collision between", event.a, event.b);
  }
});
```

Events pile up during a frame and get cleared at the start of the next one.

### Entity Hierarchy

Set up parent-child relationships. When a parent is destroyed, its children go with it:

```ts
const hierarchy = new ecs.Hierarchy(world);

const parent = world.createEntity();
const child = world.createEntity();
hierarchy.setParent(child, parent);

hierarchy.getParent(child);              // parent
hierarchy.getChildren(parent);           // [child]
hierarchy.isDescendantOf(child, parent); // true

world.destroyEntity(parent); // child is destroyed too
```

### Batch Spawning

Need a hundred entities with similar components? `spawn` handles it in one call. Pass a function for per-entity values, or a plain object to share the same value:

```ts
const entities = world.spawn(100, {
  Position: (i) => ({ x: i * 10, y: 0 }), // unique per entity
  Velocity: { x: 1, y: 0 },               // shared by all
});
```

### Debug Stats

Peek at what's going on in your world:

```ts
world.entityCount;                // alive entities
world.componentCount("Position"); // how many have Position
world.stats();                    // full breakdown
world.clear();                    // wipe everything and start over
```

### Runtime/JSON Bridge

Save and load worlds as JSON:

```ts
// Load from JSON
const { world: runtimeWorld, issues } = ecs.worldFromJson(registry, worldJson, {
  allowUnknownComponents: true,
});

// Save to JSON
const serialized = ecs.worldToJson(registry, runtimeWorld, {
  stripUnknownComponents: false,
});
```
