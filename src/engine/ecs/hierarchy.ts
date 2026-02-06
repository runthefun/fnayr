import type { EntityId, World, ComponentRegistry, ResourceRegistry } from "./types";

/**
 * Manages parent-child entity relationships for scene graph hierarchies.
 * Destroying a parent cascades destruction to all descendants.
 */
export class Hierarchy<
  R extends ComponentRegistry,
  Res extends ResourceRegistry = {},
> {
  private readonly world: World<R, Res>;
  private readonly parentOf = new Map<EntityId, EntityId>();
  private readonly childrenOf = new Map<EntityId, EntityId[]>();
  private readonly unsubscribe: () => void;

  constructor(world: World<R, Res>) {
    this.world = world;

    // Register a destroy listener to cascade deletes and clean up hierarchy state.
    // The listener fires while the entity is still alive and components are accessible.
    this.unsubscribe = (world as any).onEntityDestroyed((entity: EntityId) => {
      this.onEntityDestroyed(entity);
    });
  }

  /**
   * Sets the parent of a child entity. Both must be alive.
   * Prevents cycles (child cannot be an ancestor of parent).
   * If the child already has a parent, it is reparented.
   */
  setParent(child: EntityId, parent: EntityId): void {
    if (!this.world.isAlive(child)) {
      throw new Error(`Cannot set parent: child entity ${child} is not alive`);
    }
    if (!this.world.isAlive(parent)) {
      throw new Error(`Cannot set parent: parent entity ${parent} is not alive`);
    }
    if (child === parent) {
      throw new Error("Cannot set parent: entity cannot be its own parent");
    }
    if (this.isDescendantOf(parent, child)) {
      throw new Error("Cannot set parent: would create a cycle");
    }

    // Remove from old parent if reparenting
    const oldParent = this.parentOf.get(child);
    if (oldParent !== undefined) {
      const siblings = this.childrenOf.get(oldParent);
      if (siblings) {
        const idx = siblings.indexOf(child);
        if (idx !== -1) {
          siblings.splice(idx, 1);
        }
        if (siblings.length === 0) {
          this.childrenOf.delete(oldParent);
        }
      }
    }

    this.parentOf.set(child, parent);
    let children = this.childrenOf.get(parent);
    if (!children) {
      children = [];
      this.childrenOf.set(parent, children);
    }
    children.push(child);
  }

  /**
   * Returns the parent of an entity, or undefined if it has no parent (root).
   */
  getParent(entity: EntityId): EntityId | undefined {
    return this.parentOf.get(entity);
  }

  /**
   * Returns the children of an entity as a readonly array.
   * Returns an empty array if the entity has no children.
   */
  getChildren(parent: EntityId): readonly EntityId[] {
    return this.childrenOf.get(parent) ?? [];
  }

  /**
   * Removes the parent of an entity (orphans it).
   */
  removeParent(child: EntityId): void {
    const parent = this.parentOf.get(child);
    if (parent === undefined) {
      return;
    }
    this.parentOf.delete(child);
    const siblings = this.childrenOf.get(parent);
    if (siblings) {
      const idx = siblings.indexOf(child);
      if (idx !== -1) {
        siblings.splice(idx, 1);
      }
      if (siblings.length === 0) {
        this.childrenOf.delete(parent);
      }
    }
  }

  /**
   * Returns true if `entity` is a descendant of `ancestor` (at any depth).
   */
  isDescendantOf(entity: EntityId, ancestor: EntityId): boolean {
    let current = this.parentOf.get(entity);
    while (current !== undefined) {
      if (current === ancestor) {
        return true;
      }
      current = this.parentOf.get(current);
    }
    return false;
  }

  /**
   * Called when an entity is destroyed. Cascades destruction to children
   * and removes the entity from its parent's children list.
   */
  private onEntityDestroyed(entity: EntityId): void {
    // Remove from parent's children list
    const parent = this.parentOf.get(entity);
    if (parent !== undefined) {
      this.parentOf.delete(entity);
      const siblings = this.childrenOf.get(parent);
      if (siblings) {
        const idx = siblings.indexOf(entity);
        if (idx !== -1) {
          siblings.splice(idx, 1);
        }
        if (siblings.length === 0) {
          this.childrenOf.delete(parent);
        }
      }
    }

    // Cascade destroy to children (snapshot to avoid mutation during iteration)
    const children = this.childrenOf.get(entity);
    if (children) {
      const snapshot = children.slice();
      this.childrenOf.delete(entity);
      for (const child of snapshot) {
        // Clean up the child's parentOf entry before destroying
        // (destroyEntity will re-enter this listener for each child)
        this.parentOf.delete(child);
        this.world.destroyEntity(child);
      }
    }
  }
}
