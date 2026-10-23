# Sitekick: project rules

Sitekick's own product (not client work): an agentic workspace for editing client sites' code alongside AI agents, modelled on Source by Webflow. A monorepo:

- `apps/platform`: Next.js 16 + Payload 4 (beta) + Postgres. Accounts, organizations, sites and the `/api/v1` API.
- `apps/desktop`: the desktop client, built on [Native SDK](https://native-sdk.dev) (Vercel Labs, pre-1.0).

Architecture, domain model and milestones are in docs/architecture.md. Setup is in each app's README.

## Shared

- **Node 24.15+** (`.nvmrc`; Payload 4 requires it). Use **Bun** for all JS tooling, installs and scripts, never npm, yarn or pnpm. There's no root workspace: run commands inside each app.
- TypeScript is strict in both apps. Avoid `any` and non-null assertions outside tests.
- Clients (desktop, later mobile) talk to the platform only through `/api/v1`, never Payload's auth routes. That keeps a later move to Better Auth or Clerk cheap (docs/architecture.md, "Auth guardrails").

## Platform (`apps/platform`)

- The schema changes only through migrations (`push: false`). After changing a collection, run `bun run generate:types`, `bun run migrate:create <name>` and `bun run migrate`, and commit the migration and `src/payload-types.ts` together.
- Restart the dev server after changing collection hooks or config. Hot reload doesn't pick them up, and stale hooks fail silently with a generic 500.
- Access control lives in `src/access`. Staff (`users.kind = 'staff'`) see everything. Clients see organizations and sites only through `memberships`. New collections need explicit access rules, never Payload's defaults.
- Client tokens are ours (`src/auth`), not Payload's. Refresh tokens and invite tokens are stored only as SHA-256 hashes.
- Before committing platform changes, run `bun run typecheck`, then `bun test` against a running dev server on a seeded database (`bun run db:local`, `migrate`, `seed --demo`, `dev`).
- `.claude/launch.json` has `platform-dev` for the browser pane, which needs `bun run db:local` running.
- Production is https://sitekick-platform.vercel.app on Neon (apps/platform/README.md, "Production"). Deploy with `vercel deploy --prod --scope sitekick` from `apps/platform`, and migrations run in the build.
- **Never run `vercel env pull` or `neon env pull` in `apps/platform`**: Vercel's Development environment points at the production database. Local work uses `bun run db:local`.
- **Never send writes to production to test something**, such as creating users or calling `first-register`. Use read-only checks, and run the test suite against `db:local` only.
- Payload is pinned to yimby-website's version (4.0.0-beta.3, with Next 16.4.2 and TypeScript 6.0.3). Upgrades land in yimby first as the test bed, then here, so don't upgrade Payload on its own.
- Payload 4 changes we rely on:
  - Local API calls respect access control unless they pass `overrideAccess: true`. Pass it explicitly on every trusted server-side call (including `login`), as the code already does.
  - Collections get versions and authorship by default. `src/plugins/preserveV3Defaults.ts` turns both off; opt in on a collection by setting `versions` or `authorship` on it.
  - `defaultDepth` is set to 2 in `payload.config.ts` (v4's default is 1).

## Desktop (`apps/desktop`)

- Run everything from `apps/desktop` with the `native` CLI: `native check`, `native dev`, `native test`, `native build`. Run `native check` before every commit, plus `native build` when the core, services or `app.json` changed.
- The full SDK docs are at https://native-sdk.dev/llms.txt (one large file), with per-page `.md` versions under https://native-sdk.dev/docs/. Look things up there rather than guessing. The SDK is new and changes quickly.
- Don't `bun install` `@native-sdk/core`, because the CLI manages `node_modules`. npm packages in services go in via `native vendor . package@X.Y.Z`, never a bare install.
- SDK 0.11.0 workaround: `NATIVE_SDK_PATH` must point at the v0.11.0 source checkout (apps/desktop/README.md, "Workaround"), or every build fails ([vercel-labs/native#713](https://github.com/vercel-labs/native/issues/713)). Remove the workaround once a fixed release ships.
- `Msg` must be a kind-tagged union with at least two variants, and markup conditionals use `<if>`/`<else>`, not `!`. `native check` and `native build` catch both.
- Keep `tsconfig.json` mirroring the Native checker's options.
- Core subset gotchas we've hit (`native check` misses some; `native test` and `native build` catch them):
  - Every `Cmd` is built inline in `update`'s return. No helpers that return commands, and no `Cmd.batch`, so sequences chain through Msgs.
  - Use function declarations, not arrow-function constants.
  - No `JSON` in the core: decode in `src/services/`. `Uint8Array.indexOf`/`includes(bytes)` don't compile, so use loops or `containsIgnoreCase`.
  - A `<for>` key must be a proven integer or bytes field. A number from a service isn't proven, so key on bytes (for example `slug`).
  - Every fetch `ok` arm should read its `status`, or the shared dispatcher fails integer proofs (SC4022).
  - Record fields can't be Zig keywords (`error`, `type`, …), and a union can't widen a named union (`SessionStatus | "none"`): spell one flat literal union.
  - `Cmd.openExternalUrl` is always denied in SDK 0.11 TypeScript apps (the runner drops `external_links`). Use `systemOpenBrowser` from `src/services/system.ts`.
  - Manifest WebViews need a real `http(s)` URL (not `about:blank`) and a non-zero frame.
- Secrets (tokens, device codes) never go in the Model. They live in the Keychain via `Cmd.credentials` and are read just before the request that needs them.

### Desktop architecture

- The platform URL defaults to production; `SITEKICK_API_URL=http://localhost:3100 native dev` targets a local platform.

- `src/core.ts` is the deterministic core, in the checked TS subset: `Model`, `Msg`, a pure `update`, and binding helpers. No I/O, no npm packages, and no imports from `src/services/`. Effects are returned as `Cmd`s, and recurring ones are declared with `Sub`.
- `src/app.native` is the view. Markup only reads model fields or helpers and dispatches `Msg` kinds. It never mutates state.
- `src/services/` holds the imperative work: filesystem, git, spawning dev servers or agent CLIs, `fetch`. Services run in a supervised child process with the app's privileges and an allowlisted environment.
- Site previews and other web content go in WebView views declared in `app.json`. Keep `security.navigation` tight and add origins deliberately.
- Persistence uses the SDK's persistence, record store or SQLite effects, not files written by hand.

### Verifying desktop UI changes

- A native window has no web port for the browser pane. Use the automation server instead (`native automate snapshot`, `native automate screenshot main-canvas`). See https://native-sdk.dev/docs/automation.

## Git

- Commit as you go, in small logical commits.
- Push every commit to `origin` (github.com/sitekickcodes/sitekick, public). Never commit secrets.
