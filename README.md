# Sitekick

Sitekick's own desktop app: an agentic workspace where people and AI agents work directly on a client site's code, in the spirit of [Source by Webflow](https://webflow.com/updates/introducing-source-by-webflow). It is separate from any client project.

## Stack

- **Electron** (main + preload) built with **electron-vite**
- **React 19** renderer in TypeScript (strict)
- **Bun** as the package manager, **Node 24** (`.nvmrc`)

## Getting started

```bash
bun install
bun run dev
```

`bun run dev` builds the main and preload scripts, serves the renderer on <http://localhost:5173> with HMR, and opens the Electron window.

| Script | What it does |
| --- | --- |
| `bun run dev` | Run the app in development with HMR |
| `bun run build` | Production build into `out/` |
| `bun run start` | Run the production build |
| `bun run typecheck` | Type-check main/preload and renderer |

If the Electron window fails with a missing binary, run `node node_modules/electron/install.js`. The `postinstall` script normally does this.

## Layout

```
src/
  main/       Electron main process (windows, filesystem, child processes)
  preload/    Context-isolated bridge, exposes window.sitekick
  shared/     Types shared by main, preload and renderer
  renderer/   React UI (index.html + src/)
```

The renderer also loads in a plain browser at <http://localhost:5173>. There `window.sitekick` is undefined, so UI code must handle that.
