import type { FetchLike } from '../connections/github'

/**
 * Neon API v2: a copy-on-write branch per editing session, deleted when the
 * session ends. NEON_API_KEY is an org key for the Sitekick Neon org.
 */
const API = 'https://console.neon.tech/api/v2'

export function neonApiKey(env: NodeJS.ProcessEnv = process.env): string | null {
  return env['NEON_API_KEY'] || null
}

async function neon(fetchImpl: FetchLike, apiKey: string, path: string, init: RequestInit = {}) {
  const res = await fetchImpl(`${API}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${apiKey}`, accept: 'application/json', 'content-type': 'application/json' },
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Neon answered ${res.status} for ${init.method ?? 'GET'} ${path.split('?')[0]}${detail ? `: ${detail.slice(0, 200)}` : ''}`)
  }
  return res.status === 204 ? null : res.json()
}

export type SessionBranch = { branchId: string; branchName: string; connectionUri: string }

export async function createSessionBranch(
  apiKey: string,
  opts: { projectId: string; parentBranch: string; branchName: string; database: string; role: string },
  fetchImpl: FetchLike = fetch,
): Promise<SessionBranch> {
  const { branches } = (await neon(fetchImpl, apiKey, `/projects/${opts.projectId}/branches`)) as { branches: { id: string; name: string }[] }
  const parent = branches.find((b) => b.name === opts.parentBranch)
  if (!parent) throw new Error(`Neon project ${opts.projectId} has no branch named "${opts.parentBranch}".`)

  const created = (await neon(fetchImpl, apiKey, `/projects/${opts.projectId}/branches`, {
    method: 'POST',
    body: JSON.stringify({ branch: { name: opts.branchName, parent_id: parent.id }, endpoints: [{ type: 'read_write' }] }),
  })) as { branch: { id: string; name: string } }

  const query = new URLSearchParams({ branch_id: created.branch.id, database_name: opts.database, role_name: opts.role, pooled: 'false' })
  const { uri } = (await neon(fetchImpl, apiKey, `/projects/${opts.projectId}/connection_uri?${query}`)) as { uri: string }
  return { branchId: created.branch.id, branchName: created.branch.name, connectionUri: uri }
}

export async function deleteSessionBranch(apiKey: string, projectId: string, branchId: string, fetchImpl: FetchLike = fetch): Promise<void> {
  try {
    await neon(fetchImpl, apiKey, `/projects/${projectId}/branches/${branchId}`, { method: 'DELETE' })
  } catch (err) {
    // Already gone is fine.
    if (err instanceof Error && err.message.includes('Neon answered 404')) return
    throw err
  }
}
