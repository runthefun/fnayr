import { useRef, useEffect, useCallback } from "react";
import type { EditorSession } from "./setup";
import { pickEntity } from "./viewportRaycast";

type Props = {
  session: EditorSession;
};

export function Viewport({ session }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(
    session.renderer.domElement
  );

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

  return (
    <div
      ref={containerRef}
      className="flex-1 min-w-0 min-h-0 relative"
    />
  );
}
