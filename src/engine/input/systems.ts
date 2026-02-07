import type { ComponentRegistry } from "../ecs/types";
import type { System } from "../ecs/systems";
import type { InputBinding } from "./input";

/**
 * Creates a system that polls the input binding once per frame.
 * Gameplay systems access the binding via closure, not via the ECS.
 */
export function createInputSystem<R extends ComponentRegistry>(
  binding: InputBinding
): System<R> {
  return () => {
    binding.poll();
  };
}
