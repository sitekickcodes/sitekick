import { waitUntil } from '@vercel/functions'
import type { Endpoint, PayloadRequest } from 'payload'

import { isStaff } from '../../access'
import { runAgentTurn, undoLastCheckpoint } from '../../lib/sessions/agent'
import { findOrCreateSession, heartbeat, isActive, provisionSession, reapSessions, stopSession } from '../../lib/sessions/orchestrate'
import type { Session } from '../../payload-types'
import { error, json, readJson, str } from './http'

function summary(session: Session) {
  return {
    id: session.id,
    siteId: typeof session.site === 'object' ? session.site.id : session.site,
    status: session.status,
    // The URL only goes out once something is listening there.
    previewUrl: session.status === 'ready' ? (session.previewUrl ?? null) : null,
    gitBranch: session.gitBranch ?? null,
    agentStatus: session.agentStatus ?? 'idle',
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

const MAX_PROMPT_CHARS = 8000

/** POST /api/v1/sessions/:id/messages { text }: sends the agent a request. */
const send: Endpoint = {
  path: '/v1/sessions/:id/messages',
  method: 'post',
  handler: async (req) => {
    const session = await ownSession(req)
    if (session instanceof Response) return session
    if (session.status !== 'ready') return error(409, 'not_ready', 'The workspace is still starting.')
    if (session.agentStatus === 'working') return error(409, 'busy', 'The agent is still working on your last request.')
    const text = str((await readJson(req))['text'])?.trim()
    if (!text) return error(400, 'empty')
    if (text.length > MAX_PROMPT_CHARS) return error(400, 'too_long')

    await req.payload.create({
      collection: 'messages',
      data: { session: session.id, role: 'user', text, turn: session.turns ?? 0 },
      overrideAccess: true,
    })
    const working = await req.payload.update({
      collection: 'sessions',
      id: session.id,
      data: { agentStatus: 'working', lastActiveAt: new Date().toISOString() },
      depth: 0,
      overrideAccess: true,
    })
    // A turn can take minutes; it streams into `messages` after the response.
    waitUntil(runAgentTurn(req.payload, session.id, text))
    return json(summary(working), 202)
  },
}

/** GET /api/v1/sessions/:id/messages?after=<id>: the chat, oldest first. */
const list: Endpoint = {
  path: '/v1/sessions/:id/messages',
  method: 'get',
  handler: async (req) => {
    const session = await ownSession(req)
    if (session instanceof Response) return session
    const after = Number(req.searchParams.get('after') ?? '0')
    const { docs } = await req.payload.find({
      collection: 'messages',
      where: { session: { equals: session.id }, ...(after > 0 ? { id: { greater_than: after } } : {}) },
      sort: 'id',
      limit: 200,
      depth: 0,
      overrideAccess: true,
    })
    return json({
      session: summary(session),
      messages: docs.map((m) => ({ id: m.id, role: m.role, text: m.text, turn: m.turn })),
      // Poll again with ?after=nextAfter.
      nextAfter: docs.length ? docs[docs.length - 1]!.id : Math.max(0, after),
    })
  },
}

/** POST /api/v1/sessions/:id/undo: reverts the agent's last checkpoint. */
const undo: Endpoint = {
  path: '/v1/sessions/:id/undo',
  method: 'post',
  handler: async (req) => {
    const session = await ownSession(req)
    if (session instanceof Response) return session
    if (session.status !== 'ready') return error(409, 'not_ready')
    if (session.agentStatus === 'working') return error(409, 'busy', 'Wait for the agent to finish first.')
    const undone = await undoLastCheckpoint(req.payload, session)
    return undone === null ? error(409, 'nothing_to_undo', 'There are no agent changes to undo.') : json({ undone })
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

export const sessionEndpoints: Endpoint[] = [start, read, beat, stop, send, list, undo, reap]
