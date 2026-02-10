import { useEffect, useRef, useState } from "react";
import { EditorContext } from "./EditorContext";
import type { EditorContextValue } from "./EditorContext";
import { createEditorSession, type EditorSession } from "./setup";
import { Viewport } from "./Viewport";
import { Toolbar } from "./Toolbar";
import { EntityTree } from "./EntityTree";
import { Inspector } from "./Inspector";
import { AssetBrowser } from "./AssetBrowser";
import { ThemeTweakerButton, ThemeTweakerPanel } from "./ThemeTweaker";
import { useSceneName } from "./useEditor";
import { Sun, Moon } from "lucide-react";

function SceneLabel() {
  const sceneName = useSceneName();
  return (
    <span className="text-label text-muted">
      {sceneName ?? "Untitled"}
    </span>
  );
}

type Theme = "dark" | "light";

function getInitialTheme(): Theme {
  const stored = localStorage.getItem("editor-theme");
  return stored === "light" ? "light" : "dark";
}

export function EditorApp() {
  const [session, setSession] = useState<EditorSession | null>(null);
  const [themePanelOpen, setThemePanelOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>(getInitialTheme);
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

  useEffect(() => {
    if (theme === "light") {
      document.documentElement.dataset.theme = "light";
    } else {
      delete document.documentElement.dataset.theme;
    }
    localStorage.setItem("editor-theme", theme);
  }, [theme]);

  if (!session) return null;

  const ctx: EditorContextValue = {
    store: session.store,
    world: session.world,
    hierarchy: session.hierarchy,
    binding: session.binding,
    gizmo: session.gizmo,
    controls: session.controls,
    projectFolder: session.projectFolder,
    thumbnailCache: session.thumbnailCache,
  };

  return (
    <EditorContext.Provider value={ctx}>
      <div className="w-screen h-screen flex flex-col bg-editor-bg">
        {/* Title bar */}
        <div className="h-titlebar shrink-0 flex items-center justify-between bg-panel-alt border-b border-subtle px-3">
          <div className="flex items-center gap-2">
            <div className="w-[18px] h-[18px] rounded bg-accent/90 flex items-center justify-center">
              <span className="text-header font-semibold text-editor-bg tracking-tight">F</span>
            </div>
            <span className="text-body font-medium text-secondary tracking-wide">FNAYR</span>
            <SceneLabel />
            <div className="w-px h-4 bg-subtle mx-0.5" />
            <ThemeTweakerButton open={themePanelOpen} onToggle={() => setThemePanelOpen(!themePanelOpen)} />
            <button
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
              className="p-1.5 rounded cursor-pointer text-secondary hover:text-primary hover:bg-surface"
            >
              {theme === "dark" ? <Sun size={14} strokeWidth={1.75} /> : <Moon size={14} strokeWidth={1.75} />}
            </button>
          </div>
          <Toolbar />
        </div>

        {/* Main content */}
        <div className="flex-1 flex min-h-0">
          {/* Theme panel — docked left of viewport */}
          {themePanelOpen && (
            <ThemeTweakerPanel onClose={() => setThemePanelOpen(false)} activeTheme={theme} />
          )}

          <Viewport session={session} />

          {/* Sidebar resize handle visual */}
          <div className="w-px bg-subtle shrink-0" />

          {/* Right sidebar */}
          <div className="w-sidebar shrink-0 flex flex-col bg-panel min-h-0">
            <div className="shrink overflow-y-auto border-b border-subtle" style={{ maxHeight: "40%" }}>
              <EntityTree />
            </div>
            <div className="flex-1 overflow-y-auto min-h-0 border-b border-subtle">
              <Inspector />
            </div>
            <AssetBrowser />
          </div>
        </div>
      </div>
    </EditorContext.Provider>
  );
}
