import { waitUntil } from '@vercel/functions'
import type { Endpoint, PayloadRequest } from 'payload'

import { isStaff } from '../../access'
import { findOrCreateSession, heartbeat, isActive, provisionSession, reapSessions, stopSession } from '../../lib/sessions/orchestrate'
import type { Session } from '../../payload-types'
import { error, json } from './http'

function summary(session: Session) {
  return {
    id: session.id,
    siteId: typeof session.site === 'object' ? session.site.id : session.site,
    status: session.status,
    // The URL only goes out once something is listening there.
    previewUrl: session.status === 'ready' ? (session.previewUrl ?? null) : null,
    gitBranch: session.gitBranch ?? null,
    error: session.status === 'failed' ? (session.error ?? 'Setup failed.') : null,
  }
}

/** Staff, or a member with an editing role in the site's organization. */
async function canEdit(req: PayloadRequest, siteId: number): Promise<boolean> {
  if (!req.user) return false
  if (isStaff(req.user)) return true
  const site = await req.payload.findByID({ collection: 'sites', id: siteId, depth: 0, overrideAccess: true, disableErrors: true })
  if (!site) return false
  const orgId = typeof site.organization === 'object' ? site.organization.id : site.organization
  const { docs } = await req.payload.find({
    collection: 'memberships',
    where: { user: { equals: req.user.id }, organization: { equals: orgId }, role: { in: ['owner', 'editor'] } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  return docs.length > 0
}

async function ownSession(req: PayloadRequest): Promise<Session | Response> {
  if (!req.user) return error(401, 'unauthenticated')
  const id = Number(req.routeParams?.['id'])
  if (!Number.isInteger(id)) return error(400, 'bad_id')
  const session = await req.payload.findByID({ collection: 'sessions', id, depth: 0, overrideAccess: true, disableErrors: true })
  const owner = session && (typeof session.user === 'object' ? session.user.id : session.user)
  if (!session || (owner !== req.user.id && !isStaff(req.user))) return error(404, 'not_found')
  return session
}

/** POST /api/v1/sites/:id/sessions: start (or return) your editing session for a site. */
const start: Endpoint = {
  path: '/v1/sites/:id/sessions',
  method: 'post',
  handler: async (req) => {
    if (!req.user) return error(401, 'unauthenticated')
    const siteId = Number(req.routeParams?.['id'])
    if (!Number.isInteger(siteId)) return error(400, 'bad_id')
    if (!(await canEdit(req, siteId))) return error(403, 'forbidden')
    const { session, created } = await findOrCreateSession(req.payload, siteId, req.user.id)
    // Setup takes minutes; it runs after the response (the route allows 800s).
    if (created) waitUntil(provisionSession(req.payload, session.id))
    return json(summary(session), created ? 201 : 200)
  },
}

/** GET /api/v1/sessions/:id */
const read: Endpoint = {
  path: '/v1/sessions/:id',
  method: 'get',
  handler: async (req) => {
    const session = await ownSession(req)
    return session instanceof Response ? session : json(summary(session))
  },
}

/** POST /api/v1/sessions/:id/heartbeat: keeps the sandbox alive while you work. */
const beat: Endpoint = {
  path: '/v1/sessions/:id/heartbeat',
  method: 'post',
  handler: async (req) => {
    const session = await ownSession(req)
    if (session instanceof Response) return session
    if (!isActive(session)) return json(summary(session))
    return json(summary(await heartbeat(req.payload, session)))
  },
}

/** POST /api/v1/sessions/:id/stop */
const stop: Endpoint = {
  path: '/v1/sessions/:id/stop',
  method: 'post',
  handler: async (req) => {
    const session = await ownSession(req)
    if (session instanceof Response) return session
    if (!isActive(session)) return json(summary(session))
    return json(summary(await stopSession(req.payload, session)))
  },
}

/** GET /api/v1/cron/sessions: Vercel Cron, with `Authorization: Bearer $CRON_SECRET`. */
const reap: Endpoint = {
  path: '/v1/cron/sessions',
  method: 'get',
  handler: async (req) => {
    const secret = process.env.CRON_SECRET
    if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) return error(401, 'unauthorized')
    return json(await reapSessions(req.payload))
  },
}

export const sessionEndpoints: Endpoint[] = [start, read, beat, stop, reap]
