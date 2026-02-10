import { useContext, useSyncExternalStore } from "react";
import { EditorContext } from "./EditorContext";
import type { EditorContextValue } from "./EditorContext";

export function useEditor(): EditorContextValue {
  const ctx = useContext(EditorContext);
  if (!ctx) throw new Error("useEditor must be used within EditorContext");
  return ctx;
}

export function useSelectedEntity(): number | null {
  const { store } = useEditor();
  useSyncExternalStore(store.subscribeSelection, store.getSelectionSnapshot);
  return store.getSelectedEntity();
}

export function useEntities(): number {
  const { store } = useEditor();
  return useSyncExternalStore(store.subscribeEntities, store.getEntitySnapshot);
}

export function useProjectFolder() {
  const { projectFolder } = useEditor();
  useSyncExternalStore(projectFolder.subscribe, projectFolder.getSnapshot);
  return projectFolder;
}

export function useSceneName(): string | null {
  const { store } = useEditor();
  useSyncExternalStore(store.subscribeScene, store.getSceneSnapshot);
  return store.getSceneName();
}

export function useThumbnailCache() {
  const { thumbnailCache } = useEditor();
  useSyncExternalStore(thumbnailCache.subscribe, thumbnailCache.getSnapshot);
  return thumbnailCache;
}
