import { randomBytes } from 'node:crypto'

import { Sandbox } from '@vercel/sandbox'
import type { Payload } from 'payload'

import { ACTIVE_STATUSES } from '../../collections/Sessions'
import type { Session, Site } from '../../payload-types'
import { githubAppConfig, repoAccessToken } from '../connections/github'
import { createSessionBranch, deleteSessionBranch, neonApiKey } from './neon'

/**
 * Editing sessions: a Vercel Sandbox (Firecracker VM) running the site's
 * repo on its own git branch against its own Neon branch, exposing the dev
 * server as the preview URL. See docs/architecture.md, "Editing session
 * lifecycle".
 */

const PORT = 3000
const REGION = 'pdx1' // next to yimby's Neon (aws-us-west-2)
const VCPUS = 4
const SANDBOX_TIMEOUT_MS = 45 * 60_000
const EXTEND_BY_MS = 30 * 60_000
const EXTEND_WHEN_LEFT_MS = 20 * 60_000
const READY_TIMEOUT_MS = 8 * 60_000
export const IDLE_STOP_MS = 30 * 60_000
export const STUCK_PHASE_MS = 20 * 60_000
const LOG_TAIL = 6000
const SANDBOX_HOME = '/vercel/sandbox'
const REPO_DIR = '/vercel/sandbox/site'

type Status = Session['status']

export const sandboxNameFor = (sessionId: number) => `sitekick-session-${sessionId}`
export const gitBranchFor = (sessionId: number) => `sitekick/session-${sessionId}`

function tail(log: string | null | undefined, more: string): string {
  const next = `${log ?? ''}${more}`
  return next.length > LOG_TAIL ? next.slice(next.length - LOG_TAIL) : next
}

async function update(payload: Payload, id: number, data: Partial<Session>) {
  return payload.update({ collection: 'sessions', id, data, depth: 0, overrideAccess: true })
}

async function setPhase(payload: Payload, session: Session, status: Status, extra: Partial<Session> = {}): Promise<Session> {
  const updated = await update(payload, session.id, {
    status,
    phaseStartedAt: new Date().toISOString(),
    log: tail(session.log, `\n» ${status}\n`),
    ...extra,
  })
  return updated
}

/** Runs a shell line in the repo with bun on PATH; returns its output, throws on a non-zero exit. */
async function sh(sandbox: Sandbox, line: string, env: Record<string, string>): Promise<string> {
  const result = await sandbox.runCommand({
    cmd: 'bash',
    args: ['-lc', `export PATH="$HOME/.bun/bin:$PATH"; ${line}`],
    cwd: REPO_DIR,
    env,
  })
  const out = `${await result.stdout()}${await result.stderr()}`
  if (result.exitCode !== 0) throw new Error(`\`${line.slice(0, 120)}\` exited ${result.exitCode}:\n${out.slice(-1500)}`)
  return out
}

function dotenv(vars: Record<string, string>): string {
  return Object.entries(vars)
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join('\n')
}

/** The person's live session for a site, or a fresh one (provisioned by the caller via provisionSession). */
export async function findOrCreateSession(payload: Payload, siteId: number, userId: number): Promise<{ session: Session; created: boolean }> {
  const { docs } = await payload.find({
    collection: 'sessions',
    where: { site: { equals: siteId }, user: { equals: userId }, status: { in: ACTIVE_STATUSES } },
    sort: '-createdAt',
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  const existing = docs[0]
  if (existing) return { session: existing, created: false }

  const session = await payload.create({
    collection: 'sessions',
    data: { site: siteId, user: userId, status: 'starting', phaseStartedAt: new Date().toISOString(), lastActiveAt: new Date().toISOString() },
    depth: 0,
    overrideAccess: true,
  })
  const named = await update(payload, session.id, { gitBranch: gitBranchFor(session.id), sandboxName: sandboxNameFor(session.id) })
  return { session: named, created: true }
}

/**
 * Brings a new session from `starting` to `ready` (or `failed`). Long-running:
 * call it without awaiting (waitUntil on Vercel). Every failure is recorded on
 * the session and its resources are cleaned up.
 */
export async function provisionSession(payload: Payload, sessionId: number): Promise<void> {
  let session = await payload.findByID({ collection: 'sessions', id: sessionId, depth: 0, overrideAccess: true })
  let sandbox: Sandbox | null = null
  try {
    const siteId = typeof session.site === 'object' ? session.site.id : session.site
    const site: Site = await payload.findByID({ collection: 'sites', id: siteId, depth: 0, overrideAccess: true })
    const config = site.sandbox ?? {}
    const github = githubAppConfig()
    const neonKey = neonApiKey()
    const missing = [
      !site.githubRepo && 'the site has no GitHub repo',
      !github && 'the platform has no GitHub App credentials',
      !config.neonProjectId && 'the site has no Neon project in its Sandbox settings',
      !neonKey && 'the platform has no NEON_API_KEY',
    ].filter(Boolean)
    if (missing.length || !site.githubRepo || !github || !config.neonProjectId || !neonKey) {
      throw new Error(`Can't start a session: ${missing.join(', ')}.`)
    }

    // 1. Database: a copy of the parent branch, just for this session.
    session = await setPhase(payload, session, 'branching')
    const branch = await createSessionBranch(neonKey, {
      projectId: config.neonProjectId,
      parentBranch: config.neonParentBranch || 'staging',
      branchName: `sitekick/s-${session.id}`,
      database: config.neonDatabase || 'neondb',
      role: config.neonRole || 'neondb_owner',
    })
    session = await update(payload, session.id, { neonProjectId: config.neonProjectId, neonBranchId: branch.branchId })

    // 2. VM with the repo checked out on the session's own git branch.
    session = await setPhase(payload, session, 'booting')
    const token = await repoAccessToken(github, site.githubRepo)
    sandbox = await Sandbox.create({
      name: sandboxNameFor(session.id),
      ports: [PORT],
      timeout: SANDBOX_TIMEOUT_MS,
      resources: { vcpus: VCPUS },
      region: REGION,
      persistent: false,
      tags: { sitekick: 'session', session: String(session.id) },
    })
    // Without a source the working root doesn't exist yet: create it as root
    // and hand it to the sandbox's default (non-root) user.
    const whoami = await sandbox.runCommand({ cmd: 'id', args: ['-un'] })
    const user = (await whoami.stdout()).trim() || 'vercel-sandbox'
    for (const [cmd, args] of [
      ['mkdir', ['-p', SANDBOX_HOME]],
      ['chown', [`${user}:`, SANDBOX_HOME]],
    ] as const) {
      const r = await sandbox.runCommand({ cmd, args: [...args], sudo: true })
      if (r.exitCode !== 0) throw new Error(`Preparing ${SANDBOX_HOME} failed: ${await r.stderr()}`)
    }
    // Clone ourselves: the SDK's git source leaves no .git directory, and
    // later milestones commit and push from here. The token goes only into
    // this one command (never logged), and the remote is reset without it.
    const clone = await sandbox.runCommand({
      cmd: 'git',
      args: [
        'clone',
        '--depth',
        '1',
        ...(site.defaultBranch ? ['--branch', site.defaultBranch] : []),
        `https://x-access-token:${token}@github.com/${site.githubRepo}.git`,
        REPO_DIR,
      ],
      cwd: SANDBOX_HOME,
    })
    if (clone.exitCode !== 0) {
      const out = `${await clone.stdout()}${await clone.stderr()}`.replaceAll(token, '***')
      throw new Error(`Cloning ${site.githubRepo} failed (exit ${clone.exitCode}):\n${out.slice(-1500)}`)
    }
    const previewUrl = sandbox.domain(PORT)
    session = await update(payload, session.id, {
      previewUrl,
      sandboxExpiresAt: new Date(Date.now() + SANDBOX_TIMEOUT_MS).toISOString(),
    })

    const env: Record<string, string> = {
      DATABASE_URL: branch.connectionUri,
      DATABASE_URL_UNPOOLED: branch.connectionUri,
      PAYLOAD_SECRET: randomBytes(32).toString('hex'),
      NEXT_TELEMETRY_DISABLED: '1',
    }
    for (const { name, value } of config.env ?? []) {
      if (name) env[name] = (value ?? '').replaceAll('{{previewUrl}}', previewUrl)
    }
    await sandbox.writeFiles([{ path: `${REPO_DIR}/.env.local`, content: Buffer.from(`${dotenv(env)}\n`) }])
    await sh(sandbox, `git remote set-url origin https://github.com/${site.githubRepo}.git && git checkout -b ${gitBranchFor(session.id)}`, env)

    // 3. Dependencies.
    session = await setPhase(payload, session, 'installing')
    const lockfiles = await sh(sandbox, 'ls -1 bun.lock bun.lockb pnpm-lock.yaml package-lock.json 2>/dev/null || true', env)
    const usesBun = /bun\.lockb?/.test(lockfiles)
    if (usesBun) await sh(sandbox, 'command -v bun >/dev/null || curl -fsSL https://bun.sh/install | bash', env)
    const install =
      config.installCommand ||
      (usesBun ? 'bun install --frozen-lockfile' : lockfiles.includes('pnpm-lock.yaml') ? 'npx pnpm install --frozen-lockfile' : 'npm ci')
    const installOut = await sh(sandbox, install, env)
    session = await update(payload, session.id, { log: tail(session.log, installOut.slice(-1500)) })

    // 4. Migrations on the session's branch.
    if (config.migrateCommand) {
      session = await setPhase(payload, session, 'migrating')
      const migrateOut = await sh(sandbox, config.migrateCommand, env)
      session = await update(payload, session.id, { log: tail(session.log, migrateOut.slice(-1500)) })
    }

    // 5. Dev server, then wait until it answers.
    session = await setPhase(payload, session, 'starting_server')
    const dev = config.devCommand || 'npx next dev --hostname 0.0.0.0 --port 3000'
    await sandbox.runCommand({
      cmd: 'bash',
      args: ['-lc', `export PATH="$HOME/.bun/bin:$PATH"; ${dev} > /tmp/dev.log 2>&1`],
      cwd: REPO_DIR,
      env,
      detached: true,
    })
    const deadline = Date.now() + READY_TIMEOUT_MS
    let up = false
    while (Date.now() < deadline) {
      const probe = await sandbox.runCommand({
        cmd: 'bash',
        args: ['-lc', `curl -s -o /dev/null -w '%{http_code}' --max-time 30 http://localhost:${PORT}/ || true`],
      })
      const code = Number((await probe.stdout()).trim())
      if (code >= 200 && code < 500) {
        up = true
        break
      }
      await new Promise((r) => setTimeout(r, 3000))
    }
    const devLog = await sh(sandbox, 'tail -c 1500 /tmp/dev.log || true', env)
    if (!up) throw new Error(`The dev server didn't answer within ${READY_TIMEOUT_MS / 60_000} minutes.\n${devLog}`)

    await setPhase(payload, session, 'ready', {
      readyAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
      log: tail(session.log, `\n» ready\n${devLog}`),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    payload.logger.error({ err, sessionId }, 'Session setup failed')
    const latest = await payload.findByID({ collection: 'sessions', id: sessionId, depth: 0, overrideAccess: true })
    await releaseResources(payload, latest, sandbox)
    await update(payload, sessionId, { status: 'failed', error: message.slice(0, 4000), endedAt: new Date().toISOString() })
  }
}

/** Stops the VM and deletes the Neon branch. Safe to repeat. */
async function releaseResources(payload: Payload, session: Session, running: Sandbox | null = null): Promise<void> {
  try {
    const sandbox = running ?? (session.sandboxName ? await Sandbox.get({ name: session.sandboxName, resume: false }).catch(() => null) : null)
    await sandbox?.stop().catch(() => undefined)
  } catch (err) {
    payload.logger.warn({ err, sessionId: session.id }, 'Could not stop sandbox')
  }
  const neonKey = neonApiKey()
  if (session.neonBranchId && session.neonProjectId && neonKey) {
    try {
      await deleteSessionBranch(neonKey, session.neonProjectId, session.neonBranchId)
      await update(payload, session.id, { neonBranchId: null })
    } catch (err) {
      payload.logger.warn({ err, sessionId: session.id }, 'Could not delete Neon branch; the reaper will retry')
    }
  }
}

export async function stopSession(payload: Payload, session: Session): Promise<Session> {
  await releaseResources(payload, session)
  return update(payload, session.id, { status: 'stopped', endedAt: new Date().toISOString() })
}

/** Marks the person active and keeps the VM alive while they're working. */
export async function heartbeat(payload: Payload, session: Session): Promise<Session> {
  const now = Date.now()
  const data: Partial<Session> = { lastActiveAt: new Date(now).toISOString() }
  const expires = session.sandboxExpiresAt ? new Date(session.sandboxExpiresAt).getTime() : 0
  if (session.status === 'ready' && session.sandboxName && expires - now < EXTEND_WHEN_LEFT_MS) {
    const sandbox = await Sandbox.get({ name: session.sandboxName, resume: false })
    await sandbox.extendTimeout(EXTEND_BY_MS)
    data.sandboxExpiresAt = new Date(expires + EXTEND_BY_MS).toISOString()
  }
  return update(payload, session.id, data)
}

/** Cron: stop idle sessions, fail stuck ones, and retry leftover branch deletions. */
export async function reapSessions(payload: Payload): Promise<{ stopped: number; failed: number; cleaned: number }> {
  const now = Date.now()
  const counts = { stopped: 0, failed: 0, cleaned: 0 }

  const idle = await payload.find({
    collection: 'sessions',
    where: { status: { equals: 'ready' }, lastActiveAt: { less_than: new Date(now - IDLE_STOP_MS).toISOString() } },
    depth: 0,
    pagination: false,
    overrideAccess: true,
  })
  for (const s of idle.docs) {
    await stopSession(payload, s)
    counts.stopped++
  }

  const stuck = await payload.find({
    collection: 'sessions',
    where: {
      status: { in: ACTIVE_STATUSES.filter((st) => st !== 'ready') },
      phaseStartedAt: { less_than: new Date(now - STUCK_PHASE_MS).toISOString() },
    },
    depth: 0,
    pagination: false,
    overrideAccess: true,
  })
  for (const s of stuck.docs) {
    await releaseResources(payload, s)
    await update(payload, s.id, { status: 'failed', error: 'Setup stopped making progress.', endedAt: new Date().toISOString() })
    counts.failed++
  }

  const leftovers = await payload.find({
    collection: 'sessions',
    where: { status: { in: ['stopped', 'failed'] }, neonBranchId: { exists: true } },
    depth: 0,
    pagination: false,
    overrideAccess: true,
  })
  for (const s of leftovers.docs) {
    if (!s.neonBranchId) continue
    await releaseResources(payload, s)
    counts.cleaned++
  }
  return counts
}

export const isActive = (session: Pick<Session, 'status'>) => ACTIVE_STATUSES.includes(session.status)
