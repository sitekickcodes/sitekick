# Sitekick: project rules

Sitekick's own desktop app (not client work): an agentic workspace for editing client sites' code alongside AI agents, modelled on Source by Webflow. Built on [Native SDK](https://native-sdk.dev) (Vercel Labs, pre-1.0). See README.md for setup and docs/architecture.md for the platform architecture, domain model and milestones.

## Tooling

- Use the `native` CLI for everything: `native check`, `native dev`, `native test`, `native build`. Run `native check` before every commit, plus `native build` when the core, services or `app.json` changed.
- The full SDK docs are at https://native-sdk.dev/llms.txt (one large file), with per-page `.md` versions under https://native-sdk.dev/docs/. Look things up there rather than guessing. The SDK is new and changes quickly.
- **Node 24** (`.nvmrc`) is required at build time. Use **Bun** for any JS tooling and global installs, never npm, yarn or pnpm.
- Don't `bun install` `@native-sdk/core`, because the CLI manages `node_modules`. npm packages in services go in via `native vendor . package@X.Y.Z`, never a bare install.
- SDK 0.11.0 workaround: `NATIVE_SDK_PATH` must point at the v0.11.0 source checkout (README, "Workaround"), or every build fails ([vercel-labs/native#713](https://github.com/vercel-labs/native/issues/713)). Remove the workaround once a fixed release ships.
- `Msg` must be a kind-tagged union with at least two variants, and markup conditionals use `<if>`/`<else>`, not `!`. `native check` and `native build` catch both.
- TypeScript is strict. Keep `tsconfig.json` mirroring the checker's options, and avoid `any` and non-null assertions.

## Architecture

- `src/core.ts` is the deterministic core, in the checked TS subset: `Model`, `Msg`, a pure `update`, and binding helpers. No I/O, no npm packages, and no imports from `src/services/`. Effects are returned as `Cmd`s, and recurring ones are declared with `Sub`.
- `src/app.native` is the view. Markup only reads model fields or helpers and dispatches `Msg` kinds. It never mutates state.
- `src/services/` holds the imperative work: filesystem, git, spawning dev servers or agent CLIs, `fetch`. Services run in a supervised child process with the app's privileges and an allowlisted environment.
- Site previews and other web content go in WebView views declared in `app.json`. Keep `security.navigation` tight and add origins deliberately.
- Persistence uses the SDK's persistence, record store or SQLite effects, not files written by hand.

## Verifying UI changes

- A native window has no web port for the browser pane. Use the automation server instead (`native automate snapshot`, `native automate screenshot main-canvas`). See https://native-sdk.dev/docs/automation.

## Git

- Commit as you go, in small logical commits.
- Push every commit to `origin` (github.com/sitekickcodes/sitekick, public). Never commit secrets.
