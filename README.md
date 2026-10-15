# Sitekick

Sitekick's agentic workspace: Sitekick staff and our clients' marketing teams edit client websites by working with AI agents, in the spirit of [Source by Webflow](https://webflow.com/updates/introducing-source-by-webflow). The desktop app comes first and mobile follows later. This repo is the agency's own product, separate from any client project.

| App | What it is | Stack |
| --- | --- | --- |
| [`apps/platform`](apps/platform) | Accounts, organizations, sites and the `/api/v1` API every client uses, plus the staff admin | Next.js 16 + Payload 3 + Postgres, on Vercel |
| [`apps/desktop`](apps/desktop) | The desktop client | [Native SDK](https://native-sdk.dev) (TypeScript core + Native markup) |

Architecture, the domain model and milestones are in [docs/architecture.md](docs/architecture.md).

## Requirements

- Node 24 (`.nvmrc`) and Bun
- For the desktop app: the `native` CLI (see [apps/desktop/README.md](apps/desktop/README.md))

## Quick start (platform)

```bash
cd apps/platform
bun install
cp .env.example .env   # then fill in PAYLOAD_SECRET, SEED_EMAIL, SEED_PASSWORD
bun run db:local       # in its own terminal: a local Postgres on port 54329
bun run migrate
bun run seed --demo
bun run dev            # http://localhost:3100, admin at /admin
```

Details are in [apps/platform/README.md](apps/platform/README.md).
