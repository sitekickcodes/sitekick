# Sitekick: project rules

Sitekick's own product (not client work): an agentic workspace for editing client sites' code alongside AI agents, modelled on Source by Webflow. A monorepo:

- `apps/platform`: Next.js 16 + Payload 3 + Postgres. Accounts, organizations, sites and the `/api/v1` API.
- `apps/desktop`: the desktop client, built on [Native SDK](https://native-sdk.dev) (Vercel Labs, pre-1.0).

Architecture, domain model and milestones are in docs/architecture.md. Setup is in each app's README.

## Shared

- **Node 24** (`.nvmrc`). Use **Bun** for all JS tooling, installs and scripts, never npm, yarn or pnpm. There's no root workspace: run commands inside each app.
- TypeScript is strict in both apps. Avoid `any` and non-null assertions outside tests.
- Clients (desktop, later mobile) talk to the platform only through `/api/v1`, never Payload's auth routes. That keeps a later move to Better Auth or Clerk cheap (docs/architecture.md, "Auth guardrails").

## Platform (`apps/platform`)

- The schema changes only through migrations (`push: false`). After changing a collection, run `bun run generate:types`, `bun run migrate:create <name>` and `bun run migrate`, and commit the migration and `src/payload-types.ts` together.
- Access control lives in `src/access`. Staff (`users.kind = 'staff'`) see everything. Clients see organizations and sites only through `memberships`. New collections need explicit access rules, never Payload's defaults.
- Client tokens are ours (`src/auth`), not Payload's. Refresh tokens and invite tokens are stored only as SHA-256 hashes.
- Before committing platform changes, run `bun run typecheck`, then `bun test` against a running dev server on a seeded database (`bun run db:local`, `migrate`, `seed --demo`, `dev`).
- `.claude/launch.json` has `platform-dev` for the browser pane, which needs `bun run db:local` running.
- Production is https://sitekick-platform.vercel.app on Neon (apps/platform/README.md, "Production"). Deploy with `vercel deploy --prod --scope sitekick` from `apps/platform`, and migrations run in the build.
- **Never run `vercel env pull` or `neon env pull` in `apps/platform`**: Vercel's Development environment points at the production database. Local work uses `bun run db:local`.
- **Never send writes to production to test something**, such as creating users or calling `first-register`. Use read-only checks, and run the test suite against `db:local` only.
- Payload stays on 3.x until Payload 4 is stable.

## Desktop (`apps/desktop`)

- Run everything from `apps/desktop` with the `native` CLI: `native check`, `native dev`, `native test`, `native build`. Run `native check` before every commit, plus `native build` when the core, services or `app.json` changed.
- The full SDK docs are at https://native-sdk.dev/llms.txt (one large file), with per-page `.md` versions under https://native-sdk.dev/docs/. Look things up there rather than guessing. The SDK is new and changes quickly.
- Don't `bun install` `@native-sdk/core`, because the CLI manages `node_modules`. npm packages in services go in via `native vendor . package@X.Y.Z`, never a bare install.
- SDK 0.11.0 workaround: `NATIVE_SDK_PATH` must point at the v0.11.0 source checkout (apps/desktop/README.md, "Workaround"), or every build fails ([vercel-labs/native#713](https://github.com/vercel-labs/native/issues/713)). Remove the workaround once a fixed release ships.
- `Msg` must be a kind-tagged union with at least two variants, and markup conditionals use `<if>`/`<else>`, not `!`. `native check` and `native build` catch both.
- Keep `tsconfig.json` mirroring the Native checker's options.

### Desktop architecture

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
