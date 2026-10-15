/**
 * Bootstraps a database: the first staff account and the Sitekick agency
 * organization. With --demo, also adds a client organization, a client user
 * and two sites, for local testing of the desktop sign-in and site picker.
 *
 *   SEED_EMAIL=… SEED_PASSWORD=… bun run seed [--demo]
 */
import { getPayload } from 'payload'

import config from '../src/payload.config'

const payload = await getPayload({ config })
const demo = process.argv.includes('--demo')

async function upsert<T extends 'organizations' | 'sites'>(collection: T, slug: string, data: Record<string, unknown>) {
  const { docs } = await payload.find({ collection, where: { slug: { equals: slug } }, limit: 1, overrideAccess: true })
  if (docs[0]) return docs[0]
  return payload.create({ collection, data: { slug, ...data } as never, overrideAccess: true })
}

async function ensureUser(email: string, password: string, name: string, kind: 'staff' | 'client') {
  const { docs } = await payload.find({ collection: 'users', where: { email: { equals: email } }, limit: 1, overrideAccess: true })
  if (docs[0]) return docs[0]
  return payload.create({ collection: 'users', data: { email, password, name, kind }, overrideAccess: true })
}

async function ensureMembership(user: number, organization: number, role: 'owner' | 'editor' | 'viewer') {
  const { totalDocs } = await payload.count({
    collection: 'memberships',
    where: { user: { equals: user }, organization: { equals: organization } },
    overrideAccess: true,
  })
  if (totalDocs === 0) await payload.create({ collection: 'memberships', data: { user, organization, role }, overrideAccess: true })
}

const email = process.env.SEED_EMAIL
const password = process.env.SEED_PASSWORD
if (!email || !password) throw new Error('Set SEED_EMAIL and SEED_PASSWORD')

const staff = await ensureUser(email, password, 'Sitekick Admin', 'staff')
const agency = await upsert('organizations', 'sitekick', { name: 'Sitekick', kind: 'agency' })
await ensureMembership(staff.id, agency.id, 'owner')
payload.logger.info(`Staff account ready: ${email}`)

if (demo) {
  const client = await upsert('organizations', 'acme', { name: 'Acme Co', kind: 'client' })
  await upsert('sites', 'acme-marketing', {
    organization: client.id,
    name: 'Acme marketing site',
    productionUrl: 'https://acme.example.com',
    githubRepo: 'sitekickcodes/acme-website',
  })
  await upsert('sites', 'acme-careers', {
    organization: client.id,
    name: 'Acme careers',
    productionUrl: 'https://careers.acme.example.com',
    githubRepo: 'sitekickcodes/acme-careers',
  })
  const marketer = await ensureUser('marketer@acme.example.com', password, 'Avery Marketer', 'client')
  await ensureMembership(marketer.id, client.id, 'editor')
  payload.logger.info('Demo data ready: Acme Co, 2 sites, marketer@acme.example.com (same password)')
}

process.exit(0)
