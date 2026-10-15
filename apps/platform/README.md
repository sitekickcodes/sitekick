# Sitekick platform

Next.js 16 + Payload 3.90 + Postgres. It is the system of record for accounts, organizations, memberships, invites and sites, and it serves the `/api/v1` API used by the desktop app (and later mobile). Staff manage everything in the Payload admin at `/admin`. Clients never use the admin.

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
| GET | `/api/v1/me` | | `{ user, memberships: [{ organization, role }] }` |
| GET | `/api/v1/me/sites` | | `{ sites: [{ id, name, slug, productionUrl, organization, role }] }`, sorted by organization then name |
| GET | `/api/v1/invites/:token` | | `{ email, organizationName, role, userExists }` |
| POST | `/api/v1/invites/accept` | `{ token, name?, password? }` | Creates the account if needed, then the membership |

Payload's own REST routes (`/api/sites`, `/api/organizations`, …) accept the same bearer tokens and enforce the same access rules. GraphQL is disabled.

## Access model

- `users.kind` is `staff` or `client`. Staff see and manage everything and are the only users allowed into `/admin`. The first account ever created is forced to `staff`.
- Clients see an organization, and its sites, only through a `memberships` row. Only staff can create organizations, sites, memberships and invites in v1.
- Invites: staff create one in the admin, and the invitee gets an email with `/invite/<token>` (7-day expiry, stored hashed). With no email adapter configured, Payload logs the email to the console.

## Not done yet (before production)

- A Vercel project and a production Postgres (Neon through the Vercel Marketplace)
- Running migrations on deploy (yimby uses a `deploy-migrate.sh` build step)
- An email adapter for invites and password resets
- Per-IP rate limiting on `/api/v1/auth/login` (a Vercel Firewall rule). Per-account lockout is already on.
