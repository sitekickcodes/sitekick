/**
 * End-to-end checks for the /api/v1 surface the desktop app uses. Run against
 * a dev server on a seeded database:
 *
 *   bun run seed --demo && bun run dev   (in another terminal)
 *   bun test
 *
 * Uses SEED_EMAIL / SEED_PASSWORD from .env. Creates throwaway users and
 * invites with unique emails, so it can be re-run on the same database.
 */
import { beforeAll, describe, expect, test } from 'bun:test'
import { getPayload, type Payload } from 'payload'

import config from '../src/payload.config'

const BASE = process.env.PLATFORM_TEST_URL ?? 'http://localhost:3100'
const STAFF_EMAIL = process.env.SEED_EMAIL ?? ''
const PASSWORD = process.env.SEED_PASSWORD ?? ''
const CLIENT_EMAIL = 'marketer@acme.example.com'

type Tokens = { accessToken: string; refreshToken: string; user: { kind: string } }

async function api(path: string, init: { method?: string; body?: unknown; token?: string } = {}) {
  const res = await fetch(`${BASE}/api${path}`, {
    method: init.method ?? (init.body ? 'POST' : 'GET'),
    headers: {
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
    },
    ...(init.body ? { body: JSON.stringify(init.body) } : {}),
  })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null }
}

const login = async (email: string, password = PASSWORD) =>
  api('/v1/auth/login', { body: { email, password, deviceName: 'bun test' } })

let payload: Payload
const unique = `${Date.now()}`

beforeAll(async () => {
  if (!STAFF_EMAIL || !PASSWORD) throw new Error('Set SEED_EMAIL and SEED_PASSWORD (see .env.example)')
  payload = await getPayload({ config })
})

describe('auth', () => {
  test('rejects a wrong password', async () => {
    const res = await login(CLIENT_EMAIL, 'wrong-password')
    expect(res.status).toBe(401)
    expect(res.body.error).toBe('invalid_credentials')
  })

  test('login, refresh rotation, reuse detection', async () => {
    const first = await login(CLIENT_EMAIL)
    expect(first.status).toBe(200)
    const tokens = first.body as Tokens
    expect(tokens.user.kind).toBe('client')

    const rotated = await api('/v1/auth/refresh', { body: { refreshToken: tokens.refreshToken } })
    expect(rotated.status).toBe(200)
    expect(rotated.body.refreshToken).not.toBe(tokens.refreshToken)

    // Replaying the old refresh token revokes the whole device session.
    const replay = await api('/v1/auth/refresh', { body: { refreshToken: tokens.refreshToken } })
    expect(replay.status).toBe(401)
    const afterReplay = await api('/v1/auth/refresh', { body: { refreshToken: rotated.body.refreshToken } })
    expect(afterReplay.status).toBe(401)
    expect((await api('/v1/me', { token: rotated.body.accessToken })).status).toBe(401)
  })

  test('logout revokes the access token immediately', async () => {
    const { body } = await login(CLIENT_EMAIL)
    expect((await api('/v1/me', { token: body.accessToken })).status).toBe(200)
    expect((await api('/v1/auth/logout', { body: { refreshToken: body.refreshToken } })).status).toBe(204)
    expect((await api('/v1/me', { token: body.accessToken })).status).toBe(401)
  })

  test('locks an account after 5 failed attempts', async () => {
    const email = `lockout-${unique}@example.com`
    await payload.create({
      collection: 'users',
      data: { email, password: PASSWORD, name: 'Lockout test', kind: 'client' },
      overrideAccess: true,
    })
    for (let i = 0; i < 5; i++) await login(email, 'wrong-password')
    const res = await login(email)
    expect(res.status).toBe(423)
  })
})

describe('sites and access', () => {
  test('a client sees only their organization and sites', async () => {
    const { body } = await login(CLIENT_EMAIL)
    const me = await api('/v1/me', { token: body.accessToken })
    expect(me.body.memberships.map((m: { organization: { slug: string } }) => m.organization.slug)).toEqual(['acme'])

    const sites = await api('/v1/me/sites', { token: body.accessToken })
    expect(sites.status).toBe(200)
    for (const site of sites.body.sites) {
      expect(site.organization.slug).toBe('acme')
      expect(site.role).toBe('editor')
    }
    expect(sites.body.sites.length).toBeGreaterThanOrEqual(2)

    // Payload's own REST routes enforce the same rules for bearer tokens.
    const orgs = await api('/organizations', { token: body.accessToken })
    expect(orgs.body.docs.map((o: { slug: string }) => o.slug)).toEqual(['acme'])
    const users = await api('/users', { token: body.accessToken })
    expect(users.body.docs.map((u: { email: string }) => u.email)).toEqual([CLIENT_EMAIL])
    expect((await api('/sites', { method: 'POST', token: body.accessToken, body: { name: 'x' } })).status).toBe(403)
  })

  test('staff see every site', async () => {
    const { body } = await login(STAFF_EMAIL)
    expect(body.user.kind).toBe('staff')
    const sites = await api('/v1/me/sites', { token: body.accessToken })
    const total = await payload.count({ collection: 'sites', overrideAccess: true })
    expect(sites.body.sites.length).toBe(total.totalDocs)
  })

  test('a client cannot make themselves staff', async () => {
    const { body } = await login(CLIENT_EMAIL)
    const me = await api('/v1/me', { token: body.accessToken })
    const res = await api(`/users/${me.body.user.id}`, { method: 'PATCH', token: body.accessToken, body: { kind: 'staff' } })
    expect(res.status).toBe(200)
    const after = await api('/v1/me', { token: body.accessToken })
    expect(after.body.user.kind).toBe('client')
  })
})

describe('invites', () => {
  test('a new person accepts an invite, then signs in and sees the sites', async () => {
    const acme = (await payload.find({ collection: 'organizations', where: { slug: { equals: 'acme' } }, overrideAccess: true })).docs[0]
    expect(acme).toBeDefined()
    const email = `invitee-${unique}@example.com`
    const context: Record<string, unknown> = {}
    await payload.create({
      collection: 'invites',
      data: { email, organization: acme!.id, role: 'viewer' },
      overrideAccess: true,
      context,
    })
    const token = context['sitekick:inviteToken']
    expect(typeof token).toBe('string')

    const preview = await api(`/v1/invites/${token}`)
    expect(preview.body).toMatchObject({ email, organizationName: 'Acme Co', role: 'viewer', userExists: false })

    const tooShort = await api('/v1/invites/accept', { body: { token, name: 'Invitee', password: 'short' } })
    expect(tooShort.body.error).toBe('password_too_short')

    const accepted = await api('/v1/invites/accept', { body: { token, name: 'Invitee', password: PASSWORD } })
    expect(accepted.status).toBe(200)
    expect((await api('/v1/invites/accept', { body: { token, name: 'Invitee', password: PASSWORD } })).status).toBe(404)

    const { body } = await login(email)
    const sites = await api('/v1/me/sites', { token: body.accessToken })
    expect(sites.body.sites.every((s: { role: string }) => s.role === 'viewer')).toBe(true)
    expect(sites.body.sites.length).toBeGreaterThanOrEqual(2)
  })
})

describe('deleting', () => {
  test('staff can delete a user who has memberships and device sessions', async () => {
    const acme = (await payload.find({ collection: 'organizations', where: { slug: { equals: 'acme' } }, overrideAccess: true })).docs[0]
    const email = `delete-me-${unique}@example.com`
    const user = await payload.create({
      collection: 'users',
      data: { email, password: PASSWORD, name: 'Delete me', kind: 'client' },
      overrideAccess: true,
    })
    await payload.create({ collection: 'memberships', data: { user: user.id, organization: acme!.id, role: 'viewer' }, overrideAccess: true })
    expect((await login(email)).status).toBe(200) // creates an auth-session

    const staff = (await login(STAFF_EMAIL)).body
    const res = await api(`/users/${user.id}`, { method: 'DELETE', token: staff.accessToken })
    expect(res.status).toBe(200)

    const left = await payload.count({ collection: 'memberships', where: { user: { equals: user.id } }, overrideAccess: true })
    expect(left.totalDocs).toBe(0)
    const sessions = await payload.count({ collection: 'auth-sessions', where: { user: { equals: user.id } }, overrideAccess: true })
    expect(sessions.totalDocs).toBe(0)
  })

  test('an organization with sites cannot be deleted; an empty one can', async () => {
    const staff = (await login(STAFF_EMAIL)).body
    const org = await payload.create({
      collection: 'organizations',
      data: { name: 'Temp Co', slug: `temp-${unique}`, kind: 'client' },
      overrideAccess: true,
    })
    const site = await payload.create({
      collection: 'sites',
      data: { organization: org.id, name: 'Temp site', slug: `temp-site-${unique}`, publishPolicy: 'staff-approval' },
      overrideAccess: true,
    })
    await payload.create({ collection: 'invites', data: { email: `x-${unique}@example.com`, organization: org.id, role: 'viewer' }, overrideAccess: true })

    const blocked = await api(`/organizations/${org.id}`, { method: 'DELETE', token: staff.accessToken })
    expect(blocked.status).toBe(400)

    await payload.delete({ collection: 'sites', id: site.id, overrideAccess: true })
    const ok = await api(`/organizations/${org.id}`, { method: 'DELETE', token: staff.accessToken })
    expect(ok.status).toBe(200)
    const invites = await payload.count({ collection: 'invites', where: { organization: { equals: org.id } }, overrideAccess: true })
    expect(invites.totalDocs).toBe(0)
  })
})
