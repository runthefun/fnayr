import { useEffect, useRef, useState } from "react";
import { EditorContext } from "./EditorContext";
import type { EditorContextValue } from "./EditorContext";
import { createEditorSession, type EditorSession } from "./setup";
import { Viewport } from "./Viewport";
import { Toolbar } from "./Toolbar";
import { EntityTree } from "./EntityTree";
import { Inspector } from "./Inspector";

export function EditorApp() {
  const [session, setSession] = useState<EditorSession | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = document.createElement("canvas");
    canvasRef.current = canvas;
    const s = createEditorSession(canvas);
    setSession(s);
    return () => {
      s.dispose();
    };
  }, []);

  if (!session) return null;

  const ctx: EditorContextValue = {
    store: session.store,
    world: session.world,
    hierarchy: session.hierarchy,
    binding: session.binding,
    gizmo: session.gizmo,
    controls: session.controls,
  };

  return (
    <EditorContext.Provider value={ctx}>
      <div className="w-screen h-screen flex">
        <Viewport session={session} />
        <div className="w-[280px] flex flex-col border-l border-subtle bg-panel">
          <Toolbar />
          <div className="max-h-[40%] overflow-y-auto border-b border-subtle">
            <EntityTree />
          </div>
          <div className="flex-1 overflow-y-auto min-h-0">
            <Inspector />
          </div>
        </div>
      </div>
    </EditorContext.Provider>
  );
}
