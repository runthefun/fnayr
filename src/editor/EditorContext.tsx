import { createContext } from "react";
import type { EditorStore } from "./EditorStore";
import type { ThreeBinding } from "../engine/rendering/binding";
import type { Hierarchy } from "../engine/ecs/hierarchy";
import type { EcsWorld } from "../engine/ecs/world";
import type { renderingRegistry } from "../engine/rendering/components";
import type { GizmoManager } from "./GizmoManager";
import type { EditorCameraControls } from "./EditorCameraControls";
import type { ProjectFolder } from "./ProjectFolder";
import type { ThumbnailCache } from "./ThumbnailCache";

type Registry = typeof renderingRegistry;

export type EditorContextValue = {
  store: EditorStore<Registry>;
  world: EcsWorld<Registry>;
  hierarchy: Hierarchy<Registry>;
  binding: ThreeBinding<Registry>;
  gizmo: GizmoManager;
  controls: EditorCameraControls;
  projectFolder: ProjectFolder;
  thumbnailCache: ThumbnailCache;
};

export const EditorContext = createContext<EditorContextValue | null>(null);
