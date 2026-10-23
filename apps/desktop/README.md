# Sitekick desktop

The Sitekick desktop client, built on Native SDK. It talks to the platform (`apps/platform`) only through `/api/v1`. See the [repo README](../../README.md) and [docs/architecture.md](../../docs/architecture.md).

## Stack

- **[Native SDK](https://native-sdk.dev)** (Vercel Labs, v0.11). App logic is TypeScript compiled to a native binary, and the UI is Native markup rendered in OS windows. No browser or JS engine ships in the app.
- **Node 24** (`.nvmrc`) runs the TypeScript checker and compiler at build time.
- **Bun** installs the global CLI. The project itself has no npm dependencies to install (see below).
- **Zig 0.16** is the SDK's toolchain. The CLI downloads it into `~/.native/toolchains/` on first build.

## Getting started

```bash
bun add -g @native-sdk/cli
bun pm -g trust @native-sdk/cli
cd apps/desktop
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

## Running against a platform

The app talks to `https://sitekick-platform.vercel.app` by default. Point it at a local platform (`apps/platform`, `bun run dev`) with:

```bash
SITEKICK_API_URL=http://localhost:3100 native dev
```

Logic checks without a window, with the network scripted and the real `api` service:

```bash
native dev --core --script dev-script.ndjson
```

## Sign-in

Native SDK has no secure text field, so the app never takes a password. **Sign in with your browser** starts a device sign-in (`POST /api/v1/auth/device`), shows a code, and opens `/activate` in the default browser. You sign in and approve there while the app polls `/api/v1/auth/device/token`. The tokens land in the macOS Keychain (service `co.sitekick.app`, item `session`, holding `<refresh>\n<access>`) and never in the Model. Every API call reads the item, refreshes on 401 and retries. Sign out revokes the session on the platform and deletes the item.

The app opens the browser through `src/services/system.ts` (macOS `open`) instead of `Cmd.openExternalUrl`: Native SDK 0.11's TypeScript-core runner drops `security.navigation.external_links`, so the SDK call is always denied. The sign-in screen also shows the `/activate` address, so you can open it by hand.

After sign-in the app loads `/api/v1/me/sites`. With exactly one site it opens straight into it. Otherwise it shows the picker, with the last site you opened highlighted (remembered via `Cmd.store`) and a search field once there are more than six.

## Editing sessions and preview

Opening a site starts (or resumes) your platform session for it (`POST /api/v1/sites/:id/sessions`) and shows its setup phases, polled every 2 seconds. Once it's ready, the manifest's `preview` WebView is pinned to the workspace's `preview-pane` panel by `webPanes()` in `core.ts` and shows the sandbox's dev server. A heartbeat every 5 minutes keeps the sandbox alive. Switching sites or signing out stops the session first.

The preview WebView allows every origin (`allowed_origins: ["*"]`): sandbox hosts are random `*.vercel.run` subdomains, and the SDK only matches exact origins or `*`. It has no bridge to native code.

## Layout

```
app.json              Manifest: identity, window, permissions (network, credentials), store, browser allowlist
src/core.ts           Model, Msg, update: screens, sign-in, keychain session, sites (checked TS subset)
src/app.native        The UI: one block per screen
src/shared.ts         Records shared by the core and the api service
src/services/api.ts   Decodes /api/v1 JSON responses (the core can't use JSON)
src/services/system.ts Opens URLs in the system browser (SDK workaround)
src/bytes.ts          Byte helpers for the core (join, compare, split on newline)
dev-script.ndjson     Scripted sign-in, restart and sign-out for `native dev --core`
assets/icon.png       Icon source for every platform
```

`package.json` and `tsconfig.json` exist only for editor IntelliSense. The CLI writes `node_modules/@native-sdk/core` itself, so don't run an install.
