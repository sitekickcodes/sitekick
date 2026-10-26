# Sitekick platform

Next.js 16 + Payload 4.0.0-beta.3 + Postgres. It is the system of record for accounts, organizations, memberships, invites and sites, and it serves the `/api/v1` API used by the desktop app (and later mobile). Staff manage everything in the Payload admin at `/admin`. Clients never use the admin.

## Local setup

```bash
bun install
cp .env.example .env
```

Fill in `.env`:

- `DATABASE_URL`: `postgres://postgres:postgres@127.0.0.1:54329/sitekick` for the local database below
- `PAYLOAD_SECRET`: any long random string (`openssl rand -hex 32`)
- `SEED_EMAIL` / `SEED_PASSWORD`: your first staff account

Then:

```bash
bun run db:local      # its own terminal; data persists in .local-db/
bun run migrate
bun run seed --demo   # staff account + Sitekick org; --demo adds Acme Co, 2 sites, a client user
bun run dev           # http://localhost:3100
bun test              # with dev running: end-to-end checks of /api/v1
```

`db:local` runs a real Postgres from the `embedded-postgres` package, with no Docker or Homebrew needed. A Neon dev branch works just as well: put its URL in `DATABASE_URL`.

## Scripts

| Script | What it does |
| --- | --- |
| `dev` / `build` / `start` | Next.js on port 3100 |
| `typecheck` | `tsc --noEmit` |
| `migrate`, `migrate:create <name>`, `migrate:status` | Payload migrations. The schema changes only through migrations (`push: false`). |
| `generate:types` | Regenerate `src/payload-types.ts` after changing collections |
| `generate:importmap` | Regenerate the admin import map after adding admin components |
| `seed [--demo]` | Bootstrap a database |
| `db:local` | Local Postgres on port 54329 |
| `test` | `bun test`, against a running dev server |

## API (v1)

Clients authenticate with `Authorization: Bearer <accessToken>`. Access tokens last 15 minutes. Refresh tokens last 30 days, rotate on every use, and are stored only as hashes. Replaying an old refresh token revokes that device's session.

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| POST | `/api/v1/auth/login` | `{ email, password, deviceName? }` | `{ accessToken, accessTokenExpiresAt, refreshToken, user }`. Returns 401 for wrong credentials and 423 after 5 failed attempts (15-minute lock). |
| POST | `/api/v1/auth/refresh` | `{ refreshToken }` | A new token pair |
| POST | `/api/v1/auth/logout` | `{ refreshToken }` | 204. The device's access token stops working immediately. |
| POST | `/api/v1/auth/device` | `{ deviceName? }` | Starts a browser sign-in: `{ deviceCode, userCode, verificationUri, verificationUriComplete, expiresIn, interval }`. The device code is valid for 10 minutes. |
| POST | `/api/v1/auth/device/token` | `{ deviceCode }` | Poll every `interval` seconds. Returns 400 `authorization_pending` / `slow_down` / `access_denied` / `expired_token`, or the same token response as login once approved (only once). |
| GET | `/api/v1/me` | | `{ user, memberships: [{ organization, role }] }` |
| GET | `/api/v1/me/sites` | | `{ sites: [{ id, name, slug, productionUrl, organization, role }] }`, sorted by organization then name |
| GET | `/api/v1/invites/:token` | | `{ email, organizationName, role, userExists }` |
| POST | `/api/v1/invites/accept` | `{ token, name?, password? }` | Creates the account if needed, then the membership |

Payload's own REST routes (`/api/sites`, `/api/organizations`, …) accept the same bearer tokens and enforce the same access rules. GraphQL is disabled. The desktop app signs in through `/activate` (a web page: Payload cookie sign-in, then approve or deny the code) and never sends a password itself.

## Access model

- `users.kind` is `staff` or `client`. Staff see and manage everything and are the only users allowed into `/admin`. The first account ever created is forced to `staff`.
- Clients see an organization, and its sites, only through a `memberships` row. Only staff can create organizations, sites, memberships and invites in v1.
- Invites: staff create one in the admin, and the invitee gets an email with `/invite/<token>` (7-day expiry, stored hashed). With no email adapter configured, Payload logs the email to the console.

## Production

| | |
| --- | --- |
| URL | https://sitekick-platform.vercel.app (admin at `/admin`) |
| Vercel | Project `sitekick-platform`, Sitekick team. Functions run in `pdx1` (`vercel.json`). |
| Database | Neon project `sitekick-platform` (`wild-heart-85777886`) in the Sitekick org, AWS US West 2 (Oregon), branch `production`. Linked to this directory by `.neon` and declared in `neon.ts` (Postgres only). |
| Env | The Neon Vercel integration manages `DATABASE_URL` (pooled) and `DATABASE_URL_UNPOOLED`. We set `PAYLOAD_SECRET` (sensitive) and `PLATFORM_URL`. |

**Deploy** (CLI, from `apps/platform`, until GitHub is connected):

```bash
vercel deploy --prod --scope sitekick
```

The build runs `scripts/vercel-build.sh`. On production it first runs pending migrations over `DATABASE_URL_UNPOOLED` (Neon's direct connection; pooled pgBouncer connections can break DDL), and a failed migration fails the deploy. Previews never migrate. `.vercelignore` keeps `.env*`, `.neon` and `.local-db` out of CLI uploads.

**Rules:**

- **Never run `vercel env pull` or `neon env pull` here.** The integration also points Vercel's Development environment at the production branch, so a pull would put production credentials in `.env`/`.env.local`, and local dev, migrations and tests would hit production. Local work uses `bun run db:local`. (`neon init` pulls by default, so pass `--no-env-pull` to any Neon command that offers it.)
- **Sign in to the admin only at `https://sitekick-platform.vercel.app`.** `PLATFORM_URL` sets Payload's CSRF/CORS origin, so the admin rejects sign-ins and saves made from per-deployment URLs (`sitekick-platform-…-sitekick.vercel.app`).
- **Never write to production to test something.** Use read-only checks (`/api/users/init`, unauthenticated `/api/v1/*` returning 401). The full test suite runs only against `db:local`.

## Site connections (GitHub App + Vercel)

Each site's **Connection** panel in the admin is re-checked on every save, and by staff with `POST /api/v1/sites/:id/verify`. The check confirms the Sitekick GitHub App is installed on the repo and can push, and that the Vercel project deploys that same repo. Code: `src/lib/connections/`.

**Current setup (done 2026-10-18):** GitHub App **Sitekick Platform** (`sitekick-platform`, App ID 5374282), owned by `sitekickcodes` and installed there on all repositories, with Contents and Pull requests read/write and Metadata read. Production has `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_PRIVATE_KEY` (sensitive), `VERCEL_API_TOKEN` (sensitive, Sitekick team) and `VERCEL_TEAM_ID`.

**To redo it** (new environment, rotated key or token):

1. **App:** https://github.com/organizations/sitekickcodes/settings/apps. To create a new one, a pre-filled form is `.../settings/apps/new?name=...&url=https%3A%2F%2Fsitekick-platform.vercel.app&public=true&webhook_active=false&contents=write&pull_requests=write&metadata=read`. "Sitekick" itself is reserved by an existing account.
2. **Private key:** on the app's settings, left sidebar **Credentials → Key pairs → New key**, which downloads a `.pem`. Keys don't expire, so revoke old ones there after rotating.
3. **Vercel token:** vercel.com/account/settings/tokens, scope **Sitekick**, all projects. Read access is enough.
4. **Variables:** from `apps/platform`, since the repo root isn't linked:

   ```bash
   vercel env add GITHUB_APP_PRIVATE_KEY production --scope sitekick --sensitive < path/to/key.pem
   vercel env add VERCEL_API_TOKEN production --scope sitekick --sensitive
   ```

   Then `vercel deploy --prod --scope sitekick`, and delete the `.pem`.

**Production URL:** the check fills it in only when the Vercel project has a single custom domain (plus `www`). Multi-domain projects such as `yimby-website` (about 100 chapter domains) need it set by hand.

Without these, the panel shows **Platform not configured**. For local checks, put the same variables in `.env`; the test suite doesn't need them.

## Editing sessions (M3)

`POST /api/v1/sites/:id/sessions` (staff, or owners and editors of the site's organization) starts, or returns, the caller's session for a site. Setup runs after the response (`waitUntil`; the API route allows 800 s) through `src/lib/sessions/orchestrate.ts`:

1. **branching:** a Neon branch `sitekick/s-<id>` copied from the site's parent branch (never production). Needs `NEON_API_KEY`, an org key for the Sitekick Neon org.
2. **booting:** a Vercel Sandbox (pdx1, 4 vCPU, 45 min, extended by heartbeats) and a clone of the repo into `/vercel/sandbox/site` with a GitHub App token. The token goes only into the clone command; the remote is then reset without it. The branch is `sitekick/session-<id>`.
3. **installing / migrating / starting_server:** the site's install, optional migrate and dev commands (Sandbox settings on the site), with `.env.local` holding the session's `DATABASE_URL`, a fresh `PAYLOAD_SECRET`, and the site's sandbox-only variables (`{{previewUrl}}` is substituted). There's never a Blob token, so a sandbox can't touch production media.
4. **ready:** the dev server answers, and its public port is the preview URL.

`GET /api/v1/sessions/:id`, `POST …/heartbeat` and `POST …/stop` drive it from the app. Stopping (and deleting a site or user) stops the VM and deletes the Neon branch. A cron (`/api/v1/cron/sessions` every 10 minutes, `CRON_SECRET`) stops sessions idle for 30 minutes, fails ones stuck in a phase for 20 minutes, and retries leftover branch deletions.

Preview URLs are **public, unguessable links**, not signed in. Fine for now; revisit before clients use it.

First real run (2026-10-23, YIMBY on Payload 4 beta): ready in 49 s. Branch, Bun install of 1,257 packages in 3 s, one pending migration applied on the session's branch, homepage served from the sandbox. Stopping removed the VM and the branch.

## Agent chat (M4)

Each ready session runs **Claude Code** headless inside its sandbox (`src/lib/sessions/agent.ts`). Provisioning installs the CLI after the site's dependencies.

- **Model:** `anthropic/claude-opus-5.5`, with `anthropic/claude-haiku-5.5` as the small model. Both go through Vercel AI Gateway's Claude Code endpoint and are billed to the Sitekick team.
- **Credential brokering:** the model credential never enters the VM. The sandbox firewall injects `Authorization: Bearer <Vercel OIDC token>` on requests to `ai-gateway.vercel.sh`. The VM only sees a placeholder token. The policy is refreshed before every turn, since OIDC tokens expire.
- `POST /api/v1/sessions/:id/messages` with `{ text }` (up to 8,000 characters) stores the user message, marks the agent `working`, and runs the turn after the response (202). It returns 409 if the session isn't ready or the agent is busy.
- The turn streams Claude Code's JSON events into `messages`: assistant text, one short note per file edit or command, and notices.
- **Checkpoints:** when the turn changed files, it commits them to the session branch as `sitekick: <prompt>`. `--resume` keeps the conversation across turns.
- `GET /api/v1/sessions/:id/messages?after=<n>` returns `{ session, messages, nextAfter }`. Clients poll it while `session.agentStatus` is `working`.
- `POST /api/v1/sessions/:id/undo` resets the branch to before the last `sitekick:` checkpoint. It returns 409 `nothing_to_undo` when the last commit isn't one.
- **Read access:** messages are readable only by their session's user and by staff. Nobody writes them through Payload's REST.

First real turn (2026-10-26, YIMBY): asked for a banner on every page. The agent found the frontend layout, edited it, and replied in about 20 s. The preview served the banner, the checkpoint was committed, and Undo removed it. The brokered AI Gateway credential worked alongside the session's Neon and npm traffic.

## Not done yet

- **GitHub connection** for Git deploys, with root directory `apps/platform`. Then the Neon integration can create a database branch per preview, and previews can migrate their own branch.
- **An email adapter** for invites and password resets. Payload logs emails to the function logs until then.
- **Per-IP rate limiting** on `/api/v1/auth/login` (a Vercel Firewall rule). Per-account lockout is already on.
- **The Sitekick agency organization** in production. Create it in the admin (`seed` only runs against local databases).
