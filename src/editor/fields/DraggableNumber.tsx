import { useCallback, useEffect, useRef, useState } from "react";
import type { NumberSchema } from "../../engine/schema";

const DRAG_THRESHOLD = 3; // px before a mousedown becomes a drag
const DRAG_SPEED = 0.05; // value change per pixel of mouse movement

export type DraggableNumberProps = {
  value: number;
  schema: NumberSchema;
  label: string;
  onChange: (v: number) => void;
  speed?: number;
};

function clampToSchema(v: number, schema: NumberSchema): number {
  if (schema.min !== undefined) v = Math.max(schema.min, v);
  if (schema.max !== undefined) v = Math.min(schema.max, v);
  return v;
}

function format(v: number) {
  return Number.isInteger(v) ? v.toString() : parseFloat(v.toFixed(3)).toString();
}

export function DraggableNumber({ value, schema, label, onChange, speed = DRAG_SPEED }: DraggableNumberProps) {
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const dragState = useRef<{
    startX: number;
    startY: number;
    startValue: number;
    dragging: boolean;
  } | null>(null);

  const commitEdit = useCallback(() => {
    const v = parseFloat(editText);
    if (!isNaN(v)) {
      onChange(clampToSchema(v, schema));
    }
    setEditing(false);
  }, [editText, onChange, schema]);

  // Focus input when entering edit mode
  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (editing) return;
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragState.current = {
      startX: e.clientX,
      startY: e.clientY,
      startValue: value,
      dragging: false,
    };
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const ds = dragState.current;
    if (!ds) return;
    const dx = e.clientX - ds.startX;
    const dy = -(e.clientY - ds.startY); // invert Y so up = positive
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (!ds.dragging && dist >= DRAG_THRESHOLD) {
      ds.dragging = true;
    }

    if (ds.dragging) {
      // Use dx + dy so right/up increases, left/down decreases
      const delta = (dx + dy) * speed;
      const step = schema.integer ? 1 : speed;
      const rawVal = ds.startValue + delta;
      const snapped = schema.integer ? Math.round(rawVal) : Math.round(rawVal / step) * step;
      onChange(clampToSchema(snapped, schema));
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    const ds = dragState.current;
    dragState.current = null;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);

    if (ds && !ds.dragging) {
      // It was a click — enter edit mode
      setEditText(format(value));
      setEditing(true);
    }
  };

  if (editing) {
    return (
      <label className="flex items-center gap-0.5 flex-1 min-w-0">
        <span className="text-muted text-[10px] shrink-0">{label}</span>
        <input
          ref={inputRef}
          type="number"
          value={editText}
          step={schema.integer ? 1 : 0.1}
          min={schema.min}
          max={schema.max}
          onChange={(e) => setEditText(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitEdit();
            if (e.key === "Escape") setEditing(false);
          }}
          className="bg-input border border-subtle rounded px-1 py-0.5 w-full text-primary outline-none focus:border-focus min-w-0"
        />
      </label>
    );
  }

  return (
    <label className="flex items-center gap-0.5 flex-1 min-w-0">
      <span className="text-muted text-[10px] shrink-0">{label}</span>
      <span
        tabIndex={0}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setEditText(format(value));
            setEditing(true);
          }
        }}
        className="bg-input border border-subtle rounded px-1 py-0.5 w-full text-primary min-w-0 cursor-ew-resize select-none truncate text-sm focus:border-focus outline-none"
      >
        {format(value)}
      </span>
    </label>
  );
}
