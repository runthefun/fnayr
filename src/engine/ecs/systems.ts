import type { ComponentRegistry, World } from "./types";

/**
 * Runtime system function signature.
 */
export type System<R extends ComponentRegistry> = (world: World<R>, dt: number) => void;

/**
 * Deterministic system scheduler.
 */
export class Scheduler<R extends ComponentRegistry> {
  private readonly systems: System<R>[] = [];
  private readonly world: World<R>;

  /**
   * Creates a scheduler bound to a world.
   */
  constructor(world: World<R>) {
    this.world = world;
  }

  /**
   * Adds a system to the end of the schedule.
   */
  addSystem(system: System<R>): void {
    this.systems.push(system);
  }

  /**
   * Runs all systems in insertion order for the given frame delta.
   */
  runFrame(dt: number): void {
    for (const system of this.systems) {
      system(this.world, dt);
    }
  }
}
