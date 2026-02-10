import { useCallback, useEffect, useRef, useState } from "react";
import type { NumberSchema } from "../../engine/schema";

const DRAG_THRESHOLD = 3;
const DRAG_SPEED = 0.05;

type Props = {
  label?: string;
  value: number;
  schema: NumberSchema;
  onChange: (value: number) => void;
};

function clampToSchema(v: number, schema: NumberSchema): number {
  if (schema.min !== undefined) v = Math.max(schema.min, v);
  if (schema.max !== undefined) v = Math.min(schema.max, v);
  return v;
}

function format(v: number) {
  return Number.isInteger(v) ? v.toString() : parseFloat(v.toFixed(3)).toString();
}

export function NumberField({ label, value, schema, onChange }: Props) {
  const hasRange = schema.min !== undefined && schema.max !== undefined;
  const step = schema.integer ? 1 : hasRange ? 0.01 : 0.1;

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
    if (!isNaN(v)) onChange(clampToSchema(v, schema));
    setEditing(false);
  }, [editText, onChange, schema]);

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
    const dy = -(e.clientY - ds.startY);
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (!ds.dragging && dist >= DRAG_THRESHOLD) ds.dragging = true;
    if (ds.dragging) {
      const delta = (dx + dy) * DRAG_SPEED;
      const s = schema.integer ? 1 : DRAG_SPEED;
      const rawVal = ds.startValue + delta;
      const snapped = schema.integer ? Math.round(rawVal) : Math.round(rawVal / s) * s;
      onChange(clampToSchema(snapped, schema));
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    const ds = dragState.current;
    dragState.current = null;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    if (ds && !ds.dragging) {
      setEditText(format(value));
      setEditing(true);
    }
  };

  return (
    <label className="flex items-center gap-2">
      {label && <span className="text-muted w-8 text-right shrink-0 text-label">{label}</span>}
      {hasRange && (
        <input
          type="range"
          value={value}
          min={schema.min}
          max={schema.max}
          step={step}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            if (!isNaN(v)) onChange(v);
          }}
          className="flex-1 min-w-0"
        />
      )}
      {editing ? (
        <input
          ref={inputRef}
          type="number"
          value={editText}
          min={schema.min}
          max={schema.max}
          step={step}
          onChange={(e) => setEditText(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitEdit();
            if (e.key === "Escape") setEditing(false);
          }}
          className={`bg-input border border-accent/40 rounded px-1.5 py-0.5 text-primary outline-none font-mono text-body ${hasRange ? "w-16 shrink-0" : "w-full"}`}
        />
      ) : (
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
          className={`bg-input border border-subtle rounded px-1.5 py-0.5 text-primary cursor-ew-resize select-none truncate font-mono text-body hover:border-border focus:border-focus outline-none ${hasRange ? "w-16 shrink-0" : "w-full"}`}
        >
          {format(value)}
        </span>
      )}
    </label>
  );
}
