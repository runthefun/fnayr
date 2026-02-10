# Forge — FNAYR Editor Design System

## Philosophy

**Industrial precision.** The editor UI exists to stay out of the way while giving total control. Every pixel serves the workflow. Cool dark slate grounds the eye; warm amber draws it where action is needed. Typography is functional — geometric sans for labels, monospace for values. No decoration without purpose.

## Color Palette

All color tokens are defined via `@theme` in `src/index.css` and available as Tailwind utility classes (e.g., `bg-panel`, `text-primary`, `border-subtle`).

### Backgrounds (darkest → lightest)

| Token             | CSS Variable             | Hex         | Usage                                    |
|-------------------|--------------------------|-------------|------------------------------------------|
| `editor-bg`       | `--color-editor-bg`      | `#1a1b1e`   | Canvas area, app-level background        |
| `input`           | `--color-input`          | `#16171a`   | Sunken input fields, text areas          |
| `panel-alt`       | `--color-panel-alt`      | `#1e1f23`   | Title bar, secondary panel backgrounds   |
| `panel`           | `--color-panel`          | `#212226`   | Primary panel/sidebar background         |
| `surface`         | `--color-surface`        | `#2a2b30`   | Interactive surfaces, component headers  |
| `surface-hover`   | `--color-surface-hover`  | `#313238`   | Hovered interactive surfaces             |

### Borders

| Token      | CSS Variable       | Hex         | Usage                                         |
|------------|--------------------|-------------|-----------------------------------------------|
| `subtle`   | `--color-subtle`   | `#2e2f35`   | Panel dividers, input borders (resting)       |
| `border`   | `--color-border`   | `#363740`   | Input borders (hover), stronger separators    |

### Text

| Token       | CSS Variable         | Hex         | Usage                                        |
|-------------|----------------------|-------------|----------------------------------------------|
| `primary`   | `--color-primary`    | `#cdced3`   | Body text, active labels, input values       |
| `secondary` | `--color-secondary`  | `#a0a1a8`   | Toolbar icons, list items, less emphasis     |
| `muted`     | `--color-muted`      | `#6b6d76`   | Labels, placeholders, disabled text          |

### Accent

| Token          | CSS Variable           | Hex           | Usage                                       |
|----------------|------------------------|---------------|---------------------------------------------|
| `accent`       | `--color-accent`       | `#e8a84c`     | Primary accent — focus rings, active states, slider thumbs, checkboxes |
| `accent-hover` | `--color-accent-hover` | `#f0b865`     | Hovered accent elements                     |
| `accent-dim`   | `--color-accent-dim`   | `#e8a84c20`   | Active button backgrounds (12% opacity)     |
| `selected`     | `--color-selected`     | `#e8a84c16`   | Selected row backgrounds (9% opacity)       |
| `focus`        | `--color-focus`        | `#e8a84c`     | Focus-visible outlines (same as accent)     |

### Semantic

| Token         | CSS Variable          | Hex           | Usage                                      |
|---------------|-----------------------|---------------|--------------------------------------------|
| `danger`      | `--color-danger`      | `#e85454`     | Delete hover, destructive action text      |
| `danger-dim`  | `--color-danger-dim`  | `#e8545418`   | Danger button hover backgrounds            |

### Axis Colors (used in vector fields)

| Axis | Tailwind Class       | Purpose       |
|------|----------------------|---------------|
| X    | `text-red-400/80`    | X-axis label  |
| Y    | `text-green-400/80`  | Y-axis label  |
| Z    | `text-blue-400/80`   | Z-axis label  |
| W    | `text-purple-400/80` | W-axis label  |

## Typography

### Font Families

| Token    | CSS Variable    | Stack                                                     | Usage                          |
|----------|-----------------|-----------------------------------------------------------|--------------------------------|
| `editor` | `--font-editor` | `"DM Sans", ui-sans-serif, system-ui, -apple-system, sans-serif` | All UI text                   |
| `mono`   | `--font-mono`   | `"JetBrains Mono", ui-monospace, monospace`               | Numeric values, entity IDs, hex codes |

Both loaded from Google Fonts with subsets for weight 300–600 (DM Sans) and 400–500 (JetBrains Mono).

### Font Sizes

All font sizes are CSS variables in `@theme`, so changing one value updates every component that uses it.

| Token      | CSS Variable    | Value   | Tailwind Class | Usage                                          |
|------------|-----------------|---------|----------------|-------------------------------------------------|
| `header`   | `--text-header` | `9px`   | `text-header`  | Panel section headers (uppercase + tracking)    |
| `label`    | `--text-label`  | `10px`  | `text-label`   | Field labels, browse buttons, axis labels       |
| `body`     | `--text-body`   | `11px`  | `text-body`    | Body text, input values, list items             |

### Text Treatments

- **Panel headers**: `text-header font-medium uppercase tracking-widest text-muted`
- **Field labels**: `text-label text-muted font-medium`
- **Component names**: `text-body font-medium text-primary`
- **Numeric values**: `font-mono text-body text-primary`
- **Entity ID badge**: `text-header font-mono text-muted/60 normal-case tracking-normal`

## Spacing

The system uses Tailwind's default 4px grid. Common patterns:

| Context                | Padding          | Gap     |
|------------------------|------------------|---------|
| Panel header           | `px-3 py-2`     | —       |
| Component header       | `px-3 py-1.5`   | —       |
| Component body         | `px-3 py-2`     | —       |
| Entity row             | `px-2 py-[3px]` | `gap-1.5` |
| Toolbar buttons        | `p-1.5`         | `gap-0.5` |
| Field stacks           | —                | `gap-2` |
| Vector field row       | —                | `gap-1` |
| Draggable number       | `px-1.5 py-0.5` | `gap-0.5` |

Tree indentation: `14px` per depth level, starting at `8px` base padding.

## Components

### Panel Header

Consistent treatment across Scene, Inspector, and Assets panels:

```
px-3 py-2 text-muted font-medium uppercase tracking-widest text-[9px] border-b border-subtle
```

Often includes a flex row with action buttons (Plus, Refresh) on the right side.

### Toolbar Button

```tsx
p-1.5 rounded text-secondary hover:text-primary hover:bg-surface
disabled:opacity-30 disabled:cursor-default
// Active state:
bg-accent-dim text-accent ring-1 ring-accent/40
```

Always uses `cursor-pointer`. Icons are 14px with `strokeWidth={1.75}`.

### Input Field (text, number)

```
bg-input border border-subtle rounded px-1.5 py-1 text-primary
outline-none focus:border-focus hover:border-border text-[11px]
```

- Resting: `border-subtle`
- Hover: `border-border`
- Focus: `border-focus` (amber)
- Edit mode (active number): `border-accent/40`

### Select / Dropdown

```
bg-input border border-subtle rounded px-1.5 py-1 text-primary
outline-none focus:border-focus hover:border-border cursor-pointer text-[11px]
```

Custom SVG chevron arrow replaces native appearance. `padding-right: 22px` to accommodate.

### Draggable Number

Dual-mode field (display → edit on click, drag to scrub):

- **Display**: `bg-input border-subtle rounded cursor-ew-resize select-none font-mono`
- **Edit**: `bg-input border-accent/40 rounded font-mono` (text input)
- Label: colored per axis (X=red, Y=green, Z=blue, W=purple), `font-mono font-medium w-3 text-center`

### Popup Menu

```
bg-panel border border-border rounded-md shadow-xl shadow-black/40 py-1 min-w-[130px]
```

Menu items:
```
flex items-center gap-2 px-3 py-1.5 text-[11px] text-secondary
hover:text-primary hover:bg-surface cursor-pointer
```

### Entity Row

```
group flex items-center gap-1.5 hover:bg-surface/60
// Selected:
bg-selected text-primary font-medium
// Default:
text-secondary
```

Delete button: `opacity-0 group-hover:opacity-100 text-muted hover:text-danger`

### Component Section (Inspector)

- **Header**: `bg-surface/50 hover:bg-surface cursor-pointer select-none` with chevron + name + remove button
- **Body**: `px-3 py-2` containing SchemaField
- **Separator**: `border-b border-subtle` between sections
- Remove button: `hover:text-danger hover:bg-danger-dim rounded p-0.5`

### Drag-and-Drop Overlay

**Viewport**:
```
absolute inset-2 border-2 border-accent/50 border-dashed rounded-lg
// Center label:
bg-panel/90 backdrop-blur-sm px-4 py-2 rounded-md border border-accent/30
text-accent text-xs font-medium
```

**Asset browser / fields**: `ring-1 ring-inset ring-accent/50`

## Form Controls (CSS-level)

All native form controls are fully restyled in `index.css` to eliminate browser chrome:

- **Range sliders**: 3px track (`subtle`), 12px circular thumb (`accent`) with panel-colored border, scale on hover
- **Checkboxes**: 14px square, `input` bg + `border` border, checked fills `accent` with CSS checkmark pseudo-element
- **Color inputs**: No wrapper padding, swatch has 3px border-radius
- **Number inputs**: Spinner buttons removed (both webkit and moz)
- **Selects**: Native appearance removed, custom SVG chevron arrow

## Motion

Global transition on all interactive elements:
```css
transition: background-color 0.12s ease, border-color 0.12s ease,
            color 0.12s ease, opacity 0.12s ease, box-shadow 0.12s ease;
```

Range slider thumb: `transition: transform 0.1s ease` for hover scale.

Checkbox: `transition: all 0.15s ease` for color fill.

No spring animations or keyframe sequences — motion is subtle and utilitarian.

## Scrollbars

```css
width: 5px / height: 5px
track: transparent
thumb: subtle (resting) → muted (hover)
border-radius: 4px
```

## Icons

All icons from `lucide-react`. Standard sizes:

| Context         | Size | strokeWidth |
|-----------------|------|-------------|
| Toolbar         | 14   | 1.75        |
| Panel actions   | 11–13| 2           |
| List items      | 12   | 2           |
| Asset browser   | 14   | 1.75        |
| Delete (inline) | 10–11| 1.75–2      |

## Layout Structure

Layout dimensions are CSS variables — tweak the sidebar width or title bar height in one place.

| Token       | CSS Variable       | Value    | Tailwind Class | Usage               |
|-------------|--------------------|----------|----------------|---------------------|
| `sidebar`   | `--width-sidebar`  | `290px`  | `w-sidebar`    | Right sidebar width |
| `titlebar`  | `--height-titlebar`| `2rem`   | `h-titlebar`   | Top title bar height|

```
┌─────────────────────────────────────────────────────────┐
│ Title Bar (h-titlebar, bg-panel-alt)                    │
│  [Logo] FNAYR Editor          [Save][SaveAs][Open]...   │
├──────────────────────────────────┬──┬────────────────────┤
│                                  │  │ Scene Panel        │
│                                  │  │  (max 40% height)  │
│         Viewport                 │  ├────────────────────┤
│         (flex-1, bg-editor-bg)   │1px│ Inspector          │
│                                  │  │  (flex-1, scroll)  │
│                                  │  ├────────────────────┤
│                                  │  │ Assets             │
│                                  │  │  (min 120px)       │
└──────────────────────────────────┴──┴────────────────────┘
                                   ↑
                              Sidebar: w-sidebar, bg-panel
```

- Title bar: `h-titlebar` (default 2rem / 32px)
- Sidebar: `w-sidebar` (default 290px), flex column with scroll regions
- Viewport: fills remaining space
- 1px `bg-subtle` divider between viewport and sidebar
