import type { EcsWorld } from "../engine/ecs/world";
import type { ComponentRegistry, ResourceRegistry } from "../engine/ecs/types";

/**
 * Push-based store that bridges ECS world changes to React via useSyncExternalStore.
 */
export class EditorStore<
  R extends ComponentRegistry,
  Res extends ResourceRegistry = {},
> {
  private selectedEntity: number | null = null;
  private readonly selectionListeners = new Set<() => void>();
  private readonly entityListeners = new Set<() => void>();
  private readonly sceneListeners = new Set<() => void>();
  private entityVersion = 0;
  private selectionVersion = 0;
  private sceneVersion = 0;
  private sceneId: string | null = null;
  private sceneName: string | null = null;
  private readonly unsubComponentChanged: () => void;
  private readonly unsubEntityDestroyed: () => void;

  constructor(private readonly world: EcsWorld<R, Res>) {
    this.unsubComponentChanged = world.onComponentChanged(
      (entity: number, _type: string) => {
        if (entity === this.selectedEntity) {
          this.selectionVersion++;
          this.notifySelection();
        }
        // Component add/remove also affects entity tree display
        this.entityVersion++;
        this.notifyEntities();
      }
    );

    this.unsubEntityDestroyed = world.onEntityDestroyed((entity: number) => {
      if (entity === this.selectedEntity) {
        this.selectedEntity = null;
        this.selectionVersion++;
        this.notifySelection();
      }
      this.entityVersion++;
      this.notifyEntities();
    });
  }

  getSelectedEntity(): number | null {
    return this.selectedEntity;
  }

  selectEntity(entity: number | null): void {
    if (entity === this.selectedEntity) return;
    this.selectedEntity = entity;
    this.selectionVersion++;
    this.notifySelection();
  }

  getSelectionSnapshot = (): number => {
    return this.selectionVersion;
  };

  subscribeSelection = (callback: () => void): (() => void) => {
    this.selectionListeners.add(callback);
    return () => {
      this.selectionListeners.delete(callback);
    };
  };

  getEntitySnapshot = (): number => {
    return this.entityVersion;
  };

  subscribeEntities = (callback: () => void): (() => void) => {
    this.entityListeners.add(callback);
    return () => {
      this.entityListeners.delete(callback);
    };
  };

  getSceneId(): string | null {
    return this.sceneId;
  }

  getSceneName(): string | null {
    return this.sceneName;
  }

  private static LAST_SCENE_KEY = "editor-last-scene-id";

  setScene(id: string | null, name: string | null): void {
    this.sceneId = id;
    this.sceneName = name;
    if (id) {
      localStorage.setItem(EditorStore.LAST_SCENE_KEY, id);
    } else {
      localStorage.removeItem(EditorStore.LAST_SCENE_KEY);
    }
    this.sceneVersion++;
    this.notifyScene();
  }

  getLastSceneId(): string | null {
    return localStorage.getItem(EditorStore.LAST_SCENE_KEY);
  }

  getSceneSnapshot = (): number => {
    return this.sceneVersion;
  };

  subscribeScene = (callback: () => void): (() => void) => {
    this.sceneListeners.add(callback);
    return () => {
      this.sceneListeners.delete(callback);
    };
  };

  dispose(): void {
    this.unsubComponentChanged();
    this.unsubEntityDestroyed();
    this.selectionListeners.clear();
    this.entityListeners.clear();
    this.sceneListeners.clear();
  }

  private notifySelection(): void {
    for (const listener of this.selectionListeners) {
      listener();
    }
  }

  private notifyEntities(): void {
    for (const listener of this.entityListeners) {
      listener();
    }
  }

  private notifyScene(): void {
    for (const listener of this.sceneListeners) {
      listener();
    }
  }
}
