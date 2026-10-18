/**
 * Unit tests for the GitHub/Vercel connection check, against fake APIs.
 * No server or real credentials needed.
 */
import { generateKeyPairSync } from 'node:crypto'

import { describe, expect, test } from 'bun:test'
import { decodeJwt, decodeProtectedHeader } from 'jose'

import { checkSiteConnection, type CheckDeps } from '../src/lib/connections'
import type { FetchLike } from '../src/lib/connections/github'

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
// GitHub hands out PKCS#1 PEMs; make sure we accept that form.
const pem = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString()

type Route = { status: number; body?: unknown }

function fakeApis(routes: Record<string, Route>) {
  const calls: { url: string; auth: string | null; method: string }[] = []
  const fetchImpl: FetchLike = async (url, init) => {
    const headers = new Headers(init?.headers)
    calls.push({ url, auth: headers.get('authorization'), method: init?.method ?? 'GET' })
    const key = Object.keys(routes).find((k) => url.startsWith(k))
    const route = key ? routes[key] : { status: 404, body: { message: 'Not Found' } }
    return new Response(route?.body === undefined ? null : JSON.stringify(route.body), { status: route?.status ?? 404 })
  }
  return { fetchImpl, calls }
}

const GH = 'https://api.github.com'
const VC = 'https://api.vercel.com'

const happyRoutes: Record<string, Route> = {
  [`${GH}/repos/sitekickcodes/acme/installation`]: { status: 200, body: { id: 77 } },
  [`${GH}/app/installations/77/access_tokens`]: { status: 201, body: { token: 'ghs_install', permissions: { contents: 'write' } } },
  [`${GH}/repos/sitekickcodes/acme`]: { status: 200, body: { id: 9001, default_branch: 'main', private: true } },
  [`${VC}/v9/projects/acme-site/domains`]: { status: 404 },
  [`${VC}/v9/projects/acme-site?`]: { status: 200, body: { id: 'prj_acme', name: 'acme-site', link: { type: 'github', org: 'sitekickcodes', repo: 'acme', productionBranch: 'main' } } },
  [`${VC}/v9/projects/prj_acme/domains`]: {
    status: 200,
    body: { domains: [{ name: 'acme-site.vercel.app', verified: true }, { name: 'www.acme.com', verified: true }, { name: 'acme.com', verified: true, redirect: 'www.acme.com' }] },
  },
}

const deps = (fetchImpl: FetchLike, overrides: Partial<CheckDeps> = {}): CheckDeps => ({
  github: { appId: '12345', privateKey: pem, slug: 'sitekick' },
  vercel: { token: 'vc_test', teamId: 'team_test' },
  fetch: fetchImpl,
  ...overrides,
})

describe('checkSiteConnection', () => {
  test('connected: app can push and the project deploys the same repo', async () => {
    const { fetchImpl, calls } = fakeApis(happyRoutes)
    const result = await checkSiteConnection({ githubRepo: 'sitekickcodes/acme', vercelProjectId: 'acme-site' }, deps(fetchImpl))
    expect(result).toMatchObject({
      status: 'ok',
      message: null,
      githubInstallationId: 77,
      githubRepoId: 9001,
      githubCanPush: true,
      vercelProjectId: 'prj_acme',
      vercelProjectName: 'acme-site',
      defaultBranch: 'main',
      productionUrl: 'https://www.acme.com',
    })

    // App calls carry an RS256 app JWT issued by the app id; repo reads use the installation token.
    const appCall = calls.find((c) => c.url.endsWith('/installation'))
    const jwt = appCall?.auth?.replace('Bearer ', '') ?? ''
    expect(decodeProtectedHeader(jwt).alg).toBe('RS256')
    expect(decodeJwt(jwt).iss).toBe('12345')
    expect(calls.find((c) => c.url === `${GH}/repos/sitekickcodes/acme`)?.auth).toBe('Bearer ghs_install')
    expect(calls.find((c) => c.url.includes('/access_tokens'))?.method).toBe('POST')
    expect(calls.filter((c) => c.url.startsWith(VC)).every((c) => c.auth === 'Bearer vc_test' && c.url.includes('teamId=team_test'))).toBe(true)
  })

  test('app not installed on the repo', async () => {
    const { fetchImpl } = fakeApis({ ...happyRoutes, [`${GH}/repos/sitekickcodes/acme/installation`]: { status: 404 } })
    const result = await checkSiteConnection({ githubRepo: 'sitekickcodes/acme', vercelProjectId: 'acme-site' }, deps(fetchImpl))
    expect(result.status).toBe('problem')
    expect(result.message).toContain("isn't installed on sitekickcodes/acme")
    expect(result.message).toContain('https://github.com/apps/sitekick/installations/new')
  })

  test('read-only installation and a project that deploys another repo', async () => {
    const { fetchImpl } = fakeApis({
      ...happyRoutes,
      [`${GH}/app/installations/77/access_tokens`]: { status: 201, body: { token: 'ghs_install', permissions: { contents: 'read' } } },
      [`${VC}/v9/projects/acme-site?`]: { status: 200, body: { id: 'prj_acme', name: 'acme-site', link: { type: 'github', org: 'sitekickcodes', repo: 'other' } } },
    })
    const result = await checkSiteConnection({ githubRepo: 'sitekickcodes/acme', vercelProjectId: 'acme-site' }, deps(fetchImpl))
    expect(result.status).toBe('problem')
    expect(result.githubCanPush).toBe(false)
    expect(result.message).toContain('not push')
    expect(result.message).toContain('deploys sitekickcodes/other, not sitekickcodes/acme')
  })

  test('unknown Vercel project and rejected token', async () => {
    const missing = fakeApis({ ...happyRoutes, [`${VC}/v9/projects/acme-site?`]: { status: 404 } })
    expect((await checkSiteConnection({ githubRepo: 'sitekickcodes/acme', vercelProjectId: 'acme-site' }, deps(missing.fetchImpl))).message).toContain(
      'No Vercel project "acme-site"',
    )
    const rejected = fakeApis({ ...happyRoutes, [`${VC}/v9/projects/acme-site?`]: { status: 403 } })
    expect((await checkSiteConnection({ githubRepo: 'sitekickcodes/acme', vercelProjectId: 'acme-site' }, deps(rejected.fetchImpl))).message).toContain(
      'Vercel token was rejected',
    )
  })

  test('not configured, unchecked, and network failures', async () => {
    const { fetchImpl } = fakeApis(happyRoutes)
    expect((await checkSiteConnection({}, deps(fetchImpl))).status).toBe('unchecked')
    const unconfigured = await checkSiteConnection({ githubRepo: 'sitekickcodes/acme', vercelProjectId: 'acme-site' }, deps(fetchImpl, { github: null, vercel: null }))
    expect(unconfigured.status).toBe('not_configured')
    expect(unconfigured.message).toContain('GITHUB_APP_ID')
    expect(unconfigured.message).toContain('VERCEL_API_TOKEN')

    const down: FetchLike = async () => {
      throw new Error('ECONNRESET')
    }
    const offline = await checkSiteConnection({ githubRepo: 'sitekickcodes/acme', vercelProjectId: 'acme-site' }, deps(down))
    expect(offline.status).toBe('problem')
    expect(offline.message).toContain("Couldn't reach GitHub (ECONNRESET)")
    expect(offline.message).toContain("Couldn't reach Vercel (ECONNRESET)")
  })
})
