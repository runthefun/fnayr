import { useState, useCallback, useEffect } from "react";
import { Palette, RotateCcw, Copy, Check } from "lucide-react";

// ── Token definitions ─────────────────────────────────────────────

type TokenDef = {
  var: string;
  label: string;
  darkDefault: string;
  lightDefault: string;
  type: "color" | "px";
};

type TokenGroup = {
  label: string;
  tokens: TokenDef[];
};

const TOKEN_GROUPS: TokenGroup[] = [
  {
    label: "Backgrounds",
    tokens: [
      { var: "--color-editor-bg",    label: "Editor BG",     darkDefault: "#1a1b1e", lightDefault: "#c8c9ce", type: "color" },
      { var: "--color-panel",        label: "Panel",          darkDefault: "#212226", lightDefault: "#d0d1d6", type: "color" },
      { var: "--color-panel-alt",    label: "Panel Alt",      darkDefault: "#1e1f23", lightDefault: "#cbccd1", type: "color" },
      { var: "--color-surface",      label: "Surface",        darkDefault: "#2a2b30", lightDefault: "#c2c3c9", type: "color" },
      { var: "--color-surface-hover",label: "Surface Hover",  darkDefault: "#313238", lightDefault: "#b8b9c0", type: "color" },
      { var: "--color-input",        label: "Input",          darkDefault: "#16171a", lightDefault: "#d5d6db", type: "color" },
    ],
  },
  {
    label: "Text",
    tokens: [
      { var: "--color-primary",   label: "Primary",   darkDefault: "#cdced3", lightDefault: "#1a1b1e", type: "color" },
      { var: "--color-secondary", label: "Secondary",  darkDefault: "#a0a1a8", lightDefault: "#44454c", type: "color" },
      { var: "--color-muted",     label: "Muted",      darkDefault: "#6b6d76", lightDefault: "#70717a", type: "color" },
    ],
  },
  {
    label: "Accent",
    tokens: [
      { var: "--color-accent",       label: "Accent",       darkDefault: "#e8a84c", lightDefault: "#b87e22", type: "color" },
      { var: "--color-accent-hover",  label: "Accent Hover", darkDefault: "#f0b865", lightDefault: "#9c6a18", type: "color" },
      { var: "--color-danger",        label: "Danger",       darkDefault: "#e85454", lightDefault: "#c83030", type: "color" },
    ],
  },
  {
    label: "Borders",
    tokens: [
      { var: "--color-subtle", label: "Subtle", darkDefault: "#2e2f35", lightDefault: "#bcbdc4", type: "color" },
      { var: "--color-border", label: "Border", darkDefault: "#363740", lightDefault: "#aaabb4", type: "color" },
    ],
  },
  {
    label: "Typography",
    tokens: [
      { var: "--text-header", label: "Header", darkDefault: "11",  lightDefault: "11",  type: "px" },
      { var: "--text-label",  label: "Label",  darkDefault: "13", lightDefault: "13", type: "px" },
      { var: "--text-body",   label: "Body",   darkDefault: "14", lightDefault: "14", type: "px" },
    ],
  },
  {
    label: "Layout",
    tokens: [
      { var: "--width-sidebar",   label: "Sidebar W",    darkDefault: "290", lightDefault: "290", type: "px" },
      { var: "--height-titlebar", label: "Titlebar H",   darkDefault: "32",  lightDefault: "32",  type: "px" },
    ],
  },
];

// ── Helpers ────────────────────────────────────────────────────────

function getDefault(token: TokenDef, theme: "dark" | "light"): string {
  return theme === "light" ? token.lightDefault : token.darkDefault;
}

function getCurrentValue(token: TokenDef, theme: "dark" | "light"): string {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(token.var).trim();
  const fallback = getDefault(token, theme);
  if (token.type === "color") {
    return raw || fallback;
  }
  return parseFloat(raw) ? String(Math.round(parseFloat(raw))) : fallback;
}

function applyValue(token: TokenDef, value: string) {
  if (token.type === "px") {
    document.documentElement.style.setProperty(token.var, value + "px");
  } else {
    document.documentElement.style.setProperty(token.var, value);
  }
}

// ── Row components ────────────────────────────────────────────────

function ColorRow({ token, value, onChange }: { token: TokenDef; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center gap-2 group">
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-5 h-5 rounded border border-subtle cursor-pointer bg-transparent p-0 shrink-0"
      />
      <span className="text-label text-secondary flex-1">{token.label}</span>
      <span className="text-label font-mono text-muted group-hover:text-secondary uppercase">{value}</span>
    </label>
  );
}

function PxRow({ token, value, onChange }: { token: TokenDef; value: string; onChange: (v: string) => void }) {
  const numVal = parseFloat(value) || 0;
  return (
    <label className="flex items-center gap-2">
      <span className="text-label text-secondary flex-1">{token.label}</span>
      <div className="flex items-center gap-1">
        <button
          onClick={() => onChange(String(Math.max(1, numVal - 1)))}
          className="w-5 h-5 rounded bg-surface hover:bg-surface-hover text-muted hover:text-primary flex items-center justify-center text-body cursor-pointer"
        >
          -
        </button>
        <input
          type="text"
          value={value}
          onChange={(e) => {
            const v = e.target.value.replace(/[^0-9]/g, "");
            if (v) onChange(v);
          }}
          className="w-10 bg-input border border-subtle rounded px-1 py-0.5 text-primary text-center font-mono text-label outline-none focus:border-focus"
        />
        <button
          onClick={() => onChange(String(numVal + 1))}
          className="w-5 h-5 rounded bg-surface hover:bg-surface-hover text-muted hover:text-primary flex items-center justify-center text-body cursor-pointer"
        >
          +
        </button>
        <span className="text-label text-muted w-4">px</span>
      </div>
    </label>
  );
}

// ── Trigger button (rendered in title bar) ────────────────────────

export function ThemeTweakerButton({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      title="Theme Tweaker"
      className={`
        p-1.5 rounded cursor-pointer
        ${open
          ? "bg-accent-dim text-accent ring-1 ring-accent/40"
          : "text-secondary hover:text-primary hover:bg-surface"
        }
      `}
    >
      <Palette size={14} strokeWidth={1.75} />
    </button>
  );
}

// ── Docked panel (rendered inside the layout) ─────────────────────

export function ThemeTweakerPanel({ onClose, activeTheme }: { onClose: () => void; activeTheme: "dark" | "light" }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState(false);

  const initValues = useCallback(() => {
    const v: Record<string, string> = {};
    for (const group of TOKEN_GROUPS) {
      for (const token of group.tokens) {
        v[token.var] = getCurrentValue(token, activeTheme);
      }
    }
    setValues(v);
  }, [activeTheme]);

  useEffect(() => {
    initValues();
  }, [initValues]);

  function handleChange(token: TokenDef, value: string) {
    setValues((prev) => ({ ...prev, [token.var]: value }));
    applyValue(token, value);
  }

  function handleReset() {
    for (const group of TOKEN_GROUPS) {
      for (const token of group.tokens) {
        document.documentElement.style.removeProperty(token.var);
      }
    }
    initValues();
  }

  function handleCopyCSS() {
    const lines: string[] = [];
    for (const group of TOKEN_GROUPS) {
      lines.push(`  /* ${group.label} */`);
      for (const token of group.tokens) {
        const val = values[token.var] ?? getDefault(token, activeTheme);
        const cssVal = token.type === "px" ? val + "px" : val;
        lines.push(`  ${token.var}: ${cssVal};`);
      }
      lines.push("");
    }
    const css = `@theme {\n${lines.join("\n")}}`;
    navigator.clipboard.writeText(css).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  const hasOverrides = TOKEN_GROUPS.some((g) =>
    g.tokens.some((t) => {
      const cur = values[t.var];
      return cur !== undefined && cur !== getDefault(t, activeTheme);
    })
  );

  return (
    <div className="w-[240px] shrink-0 flex flex-col bg-panel border-l border-subtle min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-subtle shrink-0">
        <span className="text-body font-medium text-primary">Theme</span>
        <div className="flex items-center gap-1">
          <button
            onClick={handleCopyCSS}
            title="Copy as CSS"
            className="p-1 rounded text-muted hover:text-primary hover:bg-surface cursor-pointer"
          >
            {copied ? <Check size={12} strokeWidth={2} className="text-green-400" /> : <Copy size={12} strokeWidth={2} />}
          </button>
          <button
            onClick={handleReset}
            title="Reset to defaults"
            disabled={!hasOverrides}
            className="p-1 rounded text-muted hover:text-primary hover:bg-surface disabled:opacity-30 disabled:cursor-default cursor-pointer"
          >
            <RotateCcw size={12} strokeWidth={2} />
          </button>
          <button
            onClick={onClose}
            title="Close"
            className="p-1 rounded text-muted hover:text-primary hover:bg-surface cursor-pointer"
          >
            <Palette size={12} strokeWidth={2} />
          </button>
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {TOKEN_GROUPS.map((group) => (
          <div key={group.label} className="border-b border-subtle last:border-b-0">
            <div className="px-3 pt-2.5 pb-1">
              <span className="text-header font-medium text-muted uppercase tracking-widest">{group.label}</span>
            </div>
            <div className="px-3 pb-2.5 flex flex-col gap-1.5">
              {group.tokens.map((token) => {
                const val = values[token.var] ?? getDefault(token, activeTheme);
                const isModified = val !== getDefault(token, activeTheme);
                return (
                  <div key={token.var} className="relative">
                    {token.type === "color" ? (
                      <ColorRow token={token} value={val} onChange={(v) => handleChange(token, v)} />
                    ) : (
                      <PxRow token={token} value={val} onChange={(v) => handleChange(token, v)} />
                    )}
                    {isModified && (
                      <div className="absolute -left-1.5 top-1/2 -translate-y-1/2 w-1 h-1 rounded-full bg-accent" />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
