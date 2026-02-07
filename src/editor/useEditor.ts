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
