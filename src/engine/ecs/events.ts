import type { SchemaLike, SchemaValue } from "../schema";

/**
 * Registry mapping event names to their payload schemas.
 */
export type EventRegistry = Record<string, SchemaLike>;

/**
 * Event type name within a registry.
 */
export type EventType<E extends EventRegistry = EventRegistry> = Extract<
  keyof E,
  string
>;

/**
 * Runtime data shape for an event payload.
 */
export type EventData<
  E extends EventRegistry,
  K extends EventType<E>,
> = SchemaValue<E[K]>;

/**
 * Frame-buffered event bus for decoupling systems.
 *
 * Events emitted during a frame accumulate in per-type buffers.
 * Call flush() to clear all buffers (typically at the start of a new frame).
 */
export class EventBus<E extends EventRegistry> {
  readonly eventRegistry: E;
  private readonly buffers = new Map<string, unknown[]>();

  constructor(eventRegistry: E) {
    this.eventRegistry = eventRegistry;
  }

  /**
   * Emits an event, appending it to the buffer for that event type.
   */
  emit<K extends EventType<E>>(type: K, data: EventData<E, K>): void {
    this.assertRegistered(type);
    let buffer = this.buffers.get(type);
    if (!buffer) {
      buffer = [];
      this.buffers.set(type, buffer);
    }
    buffer.push(data);
  }

  /**
   * Returns all events of the given type emitted so far this frame.
   */
  read<K extends EventType<E>>(type: K): readonly EventData<E, K>[] {
    this.assertRegistered(type);
    const buffer = this.buffers.get(type);
    return (buffer ?? []) as readonly EventData<E, K>[];
  }

  /**
   * Clears all event buffers.
   */
  flush(): void {
    for (const buffer of this.buffers.values()) {
      buffer.length = 0;
    }
  }

  private assertRegistered(type: string): void {
    if (!Object.prototype.hasOwnProperty.call(this.eventRegistry, type)) {
      throw new Error(`Unknown event type: ${type}`);
    }
  }
}
