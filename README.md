# Sitekick

Sitekick's own desktop app: an agentic workspace where people and AI agents work directly on a client site's code, in the spirit of [Source by Webflow](https://webflow.com/updates/introducing-source-by-webflow). It is separate from any client project.

## Stack

- **[Native SDK](https://native-sdk.dev)** (Vercel Labs, v0.11). App logic is TypeScript compiled to a native binary, and the UI is Native markup rendered in OS windows. No browser or JS engine ships in the app.
- **Node 24** (`.nvmrc`) runs the TypeScript checker and compiler at build time.
- **Bun** installs the global CLI. The project itself has no npm dependencies to install (see below).
- **Zig 0.16** is the SDK's toolchain. The CLI downloads it into `~/.native/toolchains/` on first build.

## Getting started

```bash
bun add -g @native-sdk/cli
bun pm -g trust @native-sdk/cli
native dev
```

`bun pm -g trust` runs the CLI's postinstall, which installs its pinned TypeScript compiler. Bun blocks it by default. The first `native dev` or `native build` asks to download Zig. Pass `--yes` to skip the prompt.

### Workaround: SDK 0.11.0 npm package can't build

The published `@native-sdk/cli@0.11.0` is missing a file its `build.zig` embeds, so every build fails with `unable to open 'tests/ts-core/gpu-dashboard-reference/main.zig'` ([vercel-labs/native#713](https://github.com/vercel-labs/native/issues/713)). Until a fixed release ships, build against a source checkout of the same tag:

```bash
git clone --depth 1 --branch v0.11.0 https://github.com/vercel-labs/native.git ~/.native/sdk/native-v0.11.0
(cd ~/.native/sdk/native-v0.11.0/packages/core && npm ci --include=dev)
export NATIVE_SDK_PATH=~/.native/sdk/native-v0.11.0
```

Put the `export` in your shell profile. Once a fixed CLI is released, upgrade it, drop the variable, and delete this section.

| Command | What it does |
| --- | --- |
| `native dev` | Build and run the app, with markup hot reload |
| `native dev --core` | Run `src/core.ts` under Node without a window and feed it JSON messages |
| `native check` | Check the core (TS subset), markup and `app.json` |
| `native test` | Run the app's tests |
| `native build` | ReleaseFast binary in `zig-out/bin/` |
| `native package` | Distributable `.app` / `.dmg` |
| `native doctor` | Check the toolchain |

## Layout

```
app.json          Manifest: identity, windows, views, permissions, security policy
src/core.ts       Model, Msg, update: deterministic app logic (checked TS subset)
src/app.native    The UI: Native markup bound to the model
src/services/     Imperative work (fs, git, child processes, fetch), called from update via commands
assets/icon.png   Icon source for every platform
```

`package.json` and `tsconfig.json` exist only for editor IntelliSense. The CLI writes `node_modules/@native-sdk/core` itself, so don't run an install.
