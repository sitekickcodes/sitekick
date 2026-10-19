import { describe, expect, test } from 'bun:test'

import { createSessionBranch, deleteSessionBranch } from '../src/lib/sessions/neon'

const API = 'https://console.neon.tech/api/v2/projects/proj-1'

describe('neon session branches', () => {
  test('branches from the named parent and returns a direct connection URI', async () => {
    const calls: { url: string; method: string; body: string | null; auth: string | null }[] = []
    const fetchImpl = async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET', body: (init?.body as string) ?? null, auth: new Headers(init?.headers).get('authorization') })
      if (url === `${API}/branches` && (init?.method ?? 'GET') === 'GET') {
        return Response.json({ branches: [{ id: 'br-main', name: 'main' }, { id: 'br-staging', name: 'staging' }] })
      }
      if (url === `${API}/branches`) return Response.json({ branch: { id: 'br-new', name: 'sitekick/s-7' } }, { status: 201 })
      if (url.startsWith(`${API}/connection_uri?`)) return Response.json({ uri: 'postgresql://neondb_owner:pw@ep-x.us-west-2.aws.neon.tech/neondb' })
      return new Response('nope', { status: 404 })
    }
    const branch = await createSessionBranch(
      'neon_key',
      { projectId: 'proj-1', parentBranch: 'staging', branchName: 'sitekick/s-7', database: 'neondb', role: 'neondb_owner' },
      fetchImpl,
    )
    expect(branch).toEqual({ branchId: 'br-new', branchName: 'sitekick/s-7', connectionUri: 'postgresql://neondb_owner:pw@ep-x.us-west-2.aws.neon.tech/neondb' })
    expect(JSON.parse(calls[1]!.body!)).toEqual({ branch: { name: 'sitekick/s-7', parent_id: 'br-staging' }, endpoints: [{ type: 'read_write' }] })
    expect(calls[2]!.url).toContain('branch_id=br-new')
    expect(calls[2]!.url).toContain('pooled=false')
    expect(calls.every((c) => c.auth === 'Bearer neon_key')).toBe(true)
  })

  test('a missing parent branch is a clear error; deleting a gone branch is fine', async () => {
    const fetchImpl = async () => Response.json({ branches: [{ id: 'br-main', name: 'main' }] })
    await expect(
      createSessionBranch('k', { projectId: 'proj-1', parentBranch: 'staging', branchName: 'x', database: 'neondb', role: 'neondb_owner' }, fetchImpl),
    ).rejects.toThrow('no branch named "staging"')
    await deleteSessionBranch('k', 'proj-1', 'br-gone', async () => new Response('not found', { status: 404 }))
  })
})
