/**
 * A real Postgres for local development, from npm: no Docker or Homebrew.
 * Data persists in .local-db/ (gitignored). Stop with Ctrl-C.
 *
 *   bun run db:local
 *   DATABASE_URL=postgres://postgres:postgres@127.0.0.1:54329/sitekick
 */
import { existsSync } from 'node:fs'
import path from 'node:path'

import EmbeddedPostgres from 'embedded-postgres'

const PORT = 54329
const dataDir = path.resolve(import.meta.dir, '../.local-db')
// Keyed on PG_VERSION, not the folder: a failed first start leaves the folder.
const initialised = existsSync(path.join(dataDir, 'PG_VERSION'))

const pg = new EmbeddedPostgres({ databaseDir: dataDir, user: 'postgres', password: 'postgres', port: PORT, persistent: true })

if (!initialised) await pg.initialise()
await pg.start()

const client = pg.getPgClient()
await client.connect()
const { rowCount } = await client.query("SELECT 1 FROM pg_database WHERE datname = 'sitekick'")
await client.end()
if (!rowCount) {
  await pg.createDatabase('sitekick')
  console.log('Created database "sitekick": run `bun run migrate` and `bun run seed --demo` next.')
}

console.log(`Postgres ready: postgres://postgres:postgres@127.0.0.1:${PORT}/sitekick`)

const stop = async () => {
  await pg.stop()
  process.exit(0)
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
setInterval(() => {}, 1 << 30)
