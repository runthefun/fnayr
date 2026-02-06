import type {
  ComponentData,
  ComponentRegistry,
  ComponentType,
  EntityId,
  World,
} from "./types";

/**
 * Deferred command interface for queuing world mutations during system execution.
 */
export interface Commands<R extends ComponentRegistry> {
  /** Creates a new entity immediately and returns its ID. */
  createEntity(): EntityId;
  /** Queues an entity for destruction (applied on flush). */
  destroyEntity(entity: EntityId): void;
  /** Queues a component addition (applied on flush). */
  addComponent<K extends ComponentType<R>>(
    entity: EntityId,
    type: K,
    data?: ComponentData<R, K>
  ): void;
  /** Queues a component removal (applied on flush). */
  removeComponent<K extends ComponentType<R>>(entity: EntityId, type: K): void;
}

type Command<R extends ComponentRegistry> =
  | { kind: "destroy"; entity: EntityId }
  | { kind: "addComponent"; entity: EntityId; type: ComponentType<R>; data?: unknown }
  | { kind: "removeComponent"; entity: EntityId; type: ComponentType<R> };

/**
 * Buffers world mutations and applies them in order on flush.
 * createEntity is executed immediately so the returned ID can be used
 * in subsequent addComponent calls within the same system.
 */
export class CommandBuffer<R extends ComponentRegistry> implements Commands<R> {
  private readonly world: World<R>;
  private readonly buffer: Command<R>[] = [];

  constructor(world: World<R>) {
    this.world = world;
  }

  createEntity(): EntityId {
    return this.world.createEntity();
  }

  destroyEntity(entity: EntityId): void {
    this.buffer.push({ kind: "destroy", entity });
  }

  addComponent<K extends ComponentType<R>>(
    entity: EntityId,
    type: K,
    data?: ComponentData<R, K>
  ): void {
    this.buffer.push({ kind: "addComponent", entity, type, data });
  }

  removeComponent<K extends ComponentType<R>>(entity: EntityId, type: K): void {
    this.buffer.push({ kind: "removeComponent", entity, type });
  }

  /**
   * Applies all buffered commands to the world in order, then clears the buffer.
   */
  flush(): void {
    for (const cmd of this.buffer) {
      switch (cmd.kind) {
        case "destroy":
          this.world.destroyEntity(cmd.entity);
          break;
        case "addComponent":
          this.world.addComponent(cmd.entity, cmd.type, cmd.data as never);
          break;
        case "removeComponent":
          this.world.removeComponent(cmd.entity, cmd.type);
          break;
      }
    }
    this.buffer.length = 0;
  }
}
