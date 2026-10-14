# Sitekick: project rules

Sitekick's own desktop app (not client work): an agentic workspace for editing client sites' code alongside AI agents, modelled on Source by Webflow. See README.md for setup.

## Tooling

- Package manager is **Bun**: `bun install`, `bun add`, `bun run <script>`. Never use npm, yarn or pnpm, and never commit other lockfiles.
- **Node 24** (`.nvmrc`, `engines`). Electron ships its own Node; keep `@types/node` on 24.x.
- TypeScript is **strict** (see `tsconfig.base.json`, including `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`). Don't loosen it, and avoid `any` and non-null assertions.
- Before committing, run `bun run typecheck` and `bun run build`.

## Architecture

- `src/main`: Electron main process. All filesystem, git, child-process, network-secret and agent work lives here.
- `src/preload`: the only bridge. Expose narrow, typed functions through `contextBridge` as `window.sitekick`, never raw `ipcRenderer` or Node modules.
- `src/shared`: types shared across processes. `SitekickApi` in `src/shared/api.ts` is the contract between preload and renderer.
- `src/renderer`: React UI. Treat it as untrusted web content: no Node access, and `contextIsolation` stays on. `window.sitekick` is optional because the renderer also runs in a plain browser for previewing.
- External links open in the system browser (`setWindowOpenHandler` in main). Keep the CSP in `src/renderer/index.html` tight.

## Previewing

- `.claude/launch.json` has a `sitekick-dev` config that runs `bun run dev`. It opens the Electron window and serves the renderer on http://localhost:5173 for the browser pane, though the pane has no preload API.

## Git

- Commit as you go, in small logical commits.
- Once a remote exists, push every commit. There is no remote yet; ask before creating one.
