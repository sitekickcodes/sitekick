import { Writable } from 'node:stream'

import { Sandbox } from '@vercel/sandbox'
import type { Payload } from 'payload'

import type { Message, Session } from '../../payload-types'
import { AGENT_SYSTEM_PROMPT, agentEnv, agentNetworkPolicy } from './agent-env'
import { REPO_DIR, sh } from './orchestrate'

const CHECKPOINT_PREFIX = 'sitekick: '
const MAX_AGENT_TURNS = '60'

type Role = Message['role']

async function addMessage(payload: Payload, session: Session, turn: number, role: Role, text: string) {
  const trimmed = text.trim()
  if (!trimmed) return
  await payload.create({
    collection: 'messages',
    data: { session: session.id, role, text: trimmed.slice(0, 20000), turn },
    overrideAccess: true,
  })
}

/** One line a non-developer can read for each tool the agent uses. */
export function describeToolUse(name: string, input: Record<string, unknown>): string | null {
  const file = typeof input['file_path'] === 'string' ? input['file_path'].replace(`${REPO_DIR}/`, '') : null
  switch (name) {
    case 'Edit':
    case 'MultiEdit':
      return file ? `Edited ${file}` : 'Edited a file'
    case 'Write':
      return file ? `Wrote ${file}` : 'Wrote a file'
    case 'Bash': {
      const command = typeof input['command'] === 'string' ? input['command'] : ''
      return command ? `Ran \`${command.split('\n')[0]!.slice(0, 120)}\`` : 'Ran a command'
    }
    case 'Read':
    case 'Glob':
    case 'Grep':
    case 'LS':
    case 'TodoWrite':
      return null // reading around is noise in the chat
    default:
      return `Used ${name}`
  }
}

/** Splits a byte stream into lines and hands each to `onLine`, in order. */
function lineWriter(onLine: (line: string) => Promise<void>): Writable {
  let buffer = ''
  return new Writable({
    write(chunk: Buffer, _enc, done) {
      buffer += chunk.toString('utf8')
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      lines
        .reduce((p, line) => p.then(() => (line.trim() ? onLine(line) : undefined)), Promise.resolve())
        .then(() => done(), done)
    },
    final(done) {
      const rest = buffer
      buffer = ''
      ;(rest.trim() ? onLine(rest) : Promise.resolve()).then(() => done(), done)
    },
  })
}

/**
 * Runs one agent turn for `prompt` (already stored as the person's message):
 * Claude Code in the session's repo, streamed into the chat, then a git
 * checkpoint of whatever changed. Long-running: call without awaiting.
 */
export async function runAgentTurn(payload: Payload, sessionId: number, prompt: string): Promise<void> {
  let session = await payload.findByID({ collection: 'sessions', id: sessionId, depth: 0, overrideAccess: true })
  const turn = session.turns ?? 0
  let agentSessionId = session.agentSessionId ?? null
  let cost = 0
  let resultText: string | null = null
  try {
    if (!session.sandboxName) throw new Error('The session has no sandbox.')
    const sandbox = await Sandbox.get({ name: session.sandboxName, resume: false })
    // A fresh gateway credential for this turn, applied at the firewall.
    await sandbox.update({ networkPolicy: await agentNetworkPolicy() })

    const args = [
      '-p',
      prompt,
      '--output-format',
      'stream-json',
      '--verbose',
      '--permission-mode',
      'bypassPermissions',
      '--max-turns',
      MAX_AGENT_TURNS,
      '--append-system-prompt',
      AGENT_SYSTEM_PROMPT,
      ...(agentSessionId ? ['--resume', agentSessionId] : []),
    ]

    const stderr: string[] = []
    const result = await sandbox.runCommand({
      cmd: 'bash',
      args: ['-lc', 'export PATH="$HOME/.bun/bin:$HOME/.local/bin:$PATH"; exec claude "$@"', 'claude', ...args],
      cwd: REPO_DIR,
      env: agentEnv,
      stdout: lineWriter(async (line) => {
        let event: Record<string, unknown>
        try {
          event = JSON.parse(line) as Record<string, unknown>
        } catch {
          return
        }
        if (typeof event['session_id'] === 'string') agentSessionId = event['session_id']
        if (event['type'] === 'assistant') {
          const content = (event['message'] as { content?: unknown[] } | undefined)?.content ?? []
          for (const block of content as Record<string, unknown>[]) {
            if (block['type'] === 'text' && typeof block['text'] === 'string') {
              await addMessage(payload, session, turn, 'assistant', block['text'])
            } else if (block['type'] === 'tool_use' && typeof block['name'] === 'string') {
              const note = describeToolUse(block['name'], (block['input'] as Record<string, unknown>) ?? {})
              if (note) await addMessage(payload, session, turn, 'tool', note)
            }
          }
        } else if (event['type'] === 'result') {
          if (typeof event['total_cost_usd'] === 'number') cost = event['total_cost_usd']
          if (event['is_error'] === true || (typeof event['subtype'] === 'string' && event['subtype'] !== 'success')) {
            resultText = typeof event['result'] === 'string' ? event['result'] : String(event['subtype'])
          }
        }
      }),
      stderr: new Writable({
        write(chunk: Buffer, _enc, done) {
          stderr.push(chunk.toString('utf8'))
          done()
        },
      }),
    })

    if (result.exitCode !== 0 || resultText) {
      const detail = (resultText ?? stderr.join('').slice(-800)).trim()
      const credits = /402|credit|budget/i.test(detail) ? ' The AI Gateway may be out of credits or over its budget.' : ''
      await addMessage(payload, session, turn, 'notice', `The agent stopped with an error.${credits}\n${detail}`)
    }

    // Checkpoint whatever changed, so it can be undone (and later published).
    const status = await sh(sandbox, 'git status --porcelain', {})
    if (status.trim()) {
      const subject = `${CHECKPOINT_PREFIX}${prompt.replace(/\s+/g, ' ').slice(0, 72)}`
      await sandbox.runCommand({ cmd: 'git', args: ['add', '-A'], cwd: REPO_DIR })
      await sandbox.runCommand({ cmd: 'git', args: ['commit', '-q', '-m', subject], cwd: REPO_DIR })
      const files = status.trim().split('\n').length
      await addMessage(payload, session, turn, 'notice', `Saved a checkpoint (${files} file${files === 1 ? '' : 's'} changed). You can undo it.`)
    }
  } catch (err) {
    payload.logger.error({ err, sessionId }, 'Agent turn failed')
    await addMessage(payload, session, turn, 'notice', `The agent couldn't run: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    session = await payload.findByID({ collection: 'sessions', id: sessionId, depth: 0, overrideAccess: true })
    await payload.update({
      collection: 'sessions',
      id: sessionId,
      data: {
        agentStatus: 'idle',
        agentSessionId,
        turns: turn + 1,
        agentCostUsd: Math.round(((session.agentCostUsd ?? 0) + cost) * 10000) / 10000,
        lastActiveAt: new Date().toISOString(),
      },
      overrideAccess: true,
    })
  }
}

/** Reverts the latest agent checkpoint. Returns what was undone, or null if there's nothing to undo. */
export async function undoLastCheckpoint(payload: Payload, session: Session): Promise<string | null> {
  if (!session.sandboxName) return null
  const sandbox = await Sandbox.get({ name: session.sandboxName, resume: false })
  const subject = (await sh(sandbox, 'git log -1 --format=%s', {})).trim()
  if (!subject.startsWith(CHECKPOINT_PREFIX)) return null
  await sh(sandbox, 'git reset -q --hard HEAD~1', {})
  const what = subject.slice(CHECKPOINT_PREFIX.length)
  await addMessage(payload, session, session.turns ?? 0, 'notice', `Undid: ${what}`)
  return what
}
