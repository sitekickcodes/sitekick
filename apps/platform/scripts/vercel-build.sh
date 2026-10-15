#!/usr/bin/env bash
# Vercel's build step. Production runs pending migrations before building,
# and a failed migration fails the deploy. Previews and development don't
# migrate, because they must never touch the production database.
set -euo pipefail

if [ "${VERCEL_ENV:-}" = "production" ]; then
  echo "Production build: running migrations"
  bun run migrate
else
  echo "Skipping migrations (VERCEL_ENV=${VERCEL_ENV:-unset})"
fi

bun run build
