import { useRef, useEffect, useCallback, useState } from "react";
import type { EditorSession } from "./setup";
import { pickEntity } from "./viewportRaycast";
import { inferAssetType } from "./assetTypeDetection";

type Props = {
  session: EditorSession;
};

export function Viewport({ session }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(
    session.renderer.domElement
  );
  const [dragOver, setDragOver] = useState(false);

  const resize = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const w = container.clientWidth;
    const h = container.clientHeight;
    session.renderer.setSize(w, h, false);
    session.camera.aspect = w / h;
    session.camera.updateProjectionMatrix();
    session.renderer.render(session.binding.scene, session.camera);
  }, [session]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const canvas = canvasRef.current;
    canvas.style.display = "block";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    container.appendChild(canvas);
    resize();

    const ro = new ResizeObserver(resize);
    ro.observe(container);

    const { gizmo, controls } = session;
    let gizmoActive = false;

    gizmo.onDraggingChanged = (dragging: boolean) => {
      gizmoActive = dragging;
      controls.enabled = !dragging;
    };

    // Track pointer start position for click-to-select
    let pointerDownPos: { x: number; y: number } | null = null;

    const onPointerDown = (e: PointerEvent) => {
      if (e.button === 0) {
        pointerDownPos = { x: e.clientX, y: e.clientY };
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      // Click-to-select on left button release, if pointer hasn't moved much
      if (e.button === 0 && pointerDownPos && !gizmoActive) {
        const dx = e.clientX - pointerDownPos.x;
        const dy = e.clientY - pointerDownPos.y;
        if (dx * dx + dy * dy < 25) {
          const entity = pickEntity(e, canvas, session.camera, session.binding);
          session.store.selectEntity(entity);
        }
      }
      pointerDownPos = null;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }
      switch (e.key.toLowerCase()) {
        case "w":
          gizmo.setMode("translate");
          break;
        case "e":
          gizmo.setMode("rotate");
          break;
        case "r":
          gizmo.setMode("scale");
          break;
        case "f": {
          const sel = session.store.getSelectedEntity();
          if (sel != null) {
            const obj = session.binding.get(sel);
            if (obj) session.controls.focusOnObject(obj);
          }
          break;
        }
      }
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointerup", onPointerUp);
    window.addEventListener("keydown", onKeyDown);

    return () => {
      ro.disconnect();
      gizmo.onDraggingChanged = null;
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("keydown", onKeyDown);
      if (container.contains(canvas)) {
        container.removeChild(canvas);
      }
    };
  }, [session, resize]);

  const handleViewportDragOver = (e: React.DragEvent) => {
    if (
      e.dataTransfer.types.includes("application/x-fnayr-asset") ||
      e.dataTransfer.types.includes("Files")
    ) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      setDragOver(true);
    }
  };

  const handleViewportDragLeave = () => setDragOver(false);

  const handleViewportDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);

    let uri: string | null = null;
    let type: string | null = null;
    let name = "Imported Asset";

    // Internal asset browser drop
    const assetData = e.dataTransfer.getData("application/x-fnayr-asset");
    if (assetData) {
      try {
        const parsed = JSON.parse(assetData) as { path: string; type: string | null };
        uri = parsed.path;
        type = parsed.type;
        const parts = parsed.path.split("/");
        name = parts[parts.length - 1];
      } catch {}
    }

    // External file drop from OS
    if (!uri) {
      const file = e.dataTransfer.files?.[0];
      if (!file) return;
      type = inferAssetType(file.name);
      name = file.name;

      if (session.projectFolder.isOpen) {
        try {
          uri = await session.projectFolder.importFile(file);
        } catch (err) {
          console.warn("Failed to import dropped file:", err);
        }
      }
      if (!uri) {
        uri = URL.createObjectURL(file);
      }
    }

    if (!uri) return;

    const { world, store } = session;
    const entity = world.createEntity();
    world.setComponent(entity, "Meta", { name });
    world.setComponent(entity, "Transform3D", {
      position: [0, 0, 0],
      rotation: [0, 0, 0, 1],
      scale: [1, 1, 1],
    });

    if (type === "glb") {
      world.setComponent(entity, "ModelVisual", {
        asset: { kind: "asset", type: "glb", uri, sub: "", options: {} },
      });
    } else if (type === "texture") {
      world.setComponent(entity, "MeshVisual", {
        geometry: { kind: "plane", width: 2, height: 2 },
        color: [1, 1, 1, 1],
        texture: { kind: "asset", type: "texture", uri, sub: "", options: {} },
      });
    }

    store.selectEntity(entity);
  };

  return (
    <div
      ref={containerRef}
      className="flex-1 min-w-0 min-h-0 relative bg-editor-bg"
      onDragOver={handleViewportDragOver}
      onDragLeave={handleViewportDragLeave}
      onDrop={handleViewportDrop}
    >
      {dragOver && (
        <div className="absolute inset-2 border-2 border-accent/50 border-dashed rounded-lg pointer-events-none z-10 flex items-center justify-center">
          <div className="bg-panel/90 backdrop-blur-sm px-4 py-2 rounded-md border border-accent/30">
            <span className="text-accent text-xs font-medium">Drop asset here</span>
          </div>
        </div>
      )}
    </div>
  );
}
