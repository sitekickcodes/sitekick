import path from 'path'
import { fileURLToPath } from 'url'

import { postgresAdapter } from '@payloadcms/db-postgres'
import { attachDatabasePool } from '@vercel/functions'
import { buildConfig } from 'payload'

import { AuthSessions } from './collections/AuthSessions'
import { DeviceAuthorizations } from './collections/DeviceAuthorizations'
import { Invites } from './collections/Invites'
import { Memberships } from './collections/Memberships'
import { Organizations } from './collections/Organizations'
import { Sites } from './collections/Sites'
import { Users } from './collections/Users'
import { authEndpoints } from './endpoints/v1/auth'
import { deviceEndpoints } from './endpoints/v1/device'
import { inviteEndpoints } from './endpoints/v1/invites'
import { meEndpoints } from './endpoints/v1/me'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

// Unset locally and on previews, so the admin uses relative URLs on whatever
// origin it's opened at. Production sets it.
const PLATFORM_URL = process.env.PLATFORM_URL

/**
 * Sitekick platform: accounts, organizations, sites and (later) editing
 * sessions. Clients (desktop, later mobile) use the /api/v1 endpoints only;
 * staff use the admin panel. See docs/architecture.md.
 */
export default buildConfig({
  admin: {
    user: Users.slug,
    importMap: { baseDir: path.resolve(dirname) },
    meta: { titleSuffix: ' · Sitekick' },
  },
  collections: [Users, Organizations, Memberships, Invites, Sites, AuthSessions, DeviceAuthorizations],
  endpoints: [...authEndpoints, ...deviceEndpoints, ...meEndpoints, ...inviteEndpoints],
  // Clients use REST; no GraphQL surface to secure.
  graphQL: { disable: true },
  secret: process.env.PAYLOAD_SECRET || '',
  ...(PLATFORM_URL ? { serverURL: PLATFORM_URL, cors: [PLATFORM_URL], csrf: [PLATFORM_URL] } : {}),
  typescript: { outputFile: path.resolve(dirname, 'payload-types.ts') },
  db: postgresAdapter({
    pool: {
      connectionString: (process.env.DATABASE_URL || '').replace('sslmode=require', 'sslmode=verify-full'),
      connectionTimeoutMillis: 25_000,
    },
    // Migrations only, no dev auto-push (same workflow as yimby-website).
    push: false,
  }),
  // On Vercel, close idle pg clients before the instance suspends.
  onInit: async (payload) => {
    if (!process.env.VERCEL) return
    const pool = (payload.db as unknown as { pool?: Parameters<typeof attachDatabasePool>[0] }).pool
    if (pool) attachDatabasePool(pool)
  },
})
