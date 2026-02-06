# AGENTS.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Minimal React + TypeScript web application built with Vite.

## Commands

```bash
pnpm install      # Install dependencies
pnpm dev          # Start dev server with HMR (default: http://localhost:5173)
pnpm build        # Production build to dist/
pnpm preview      # Preview production build locally
pnpm typecheck    # TypeScript type checking (tsc --noEmit)
pnpm test:run     # Run test suite (vitest run)
```

## Architecture

- **Engine architecture**: See [engine-architecture.md](engine-architecture.md) for detailed documentation of the schema system and ECS runtime.
- **Entry flow**: `index.html` → `src/main.tsx` (mounts React root with StrictMode) → `src/App.tsx`
- **Build**: Vite with `@vitejs/plugin-react` (automatic JSX transform)
- **TypeScript**: Strict mode, ES2020 target, bundler module resolution, no emit (type-check only)
- **Package manager**: pnpm

## Development Reminder
- Run tests (`pnpm test:run`) whenever you add or change code.
