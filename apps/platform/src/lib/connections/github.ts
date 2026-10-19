import { createPrivateKey } from 'node:crypto'

import { SignJWT } from 'jose'

/**
 * The Sitekick GitHub App (owned by the sitekickcodes org). The platform
 * authenticates as the app, finds the installation that covers a repo, and
 * acts through a short-lived installation token. No webhooks in M2.
 */
export type GitHubAppConfig = { appId: string; privateKey: string; slug: string | null }

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export function githubAppConfig(env: NodeJS.ProcessEnv = process.env): GitHubAppConfig | null {
  const appId = env['GITHUB_APP_ID']
  const raw = env['GITHUB_APP_PRIVATE_KEY']
  if (!appId || !raw) return null
  // Env UIs often store the PEM with literal "\n".
  const privateKey = raw.includes('\\n') ? raw.replaceAll('\\n', '\n') : raw
  return { appId, privateKey, slug: env['GITHUB_APP_SLUG'] || null }
}

export function installUrl(config: GitHubAppConfig | null): string | null {
  return config?.slug ? `https://github.com/apps/${config.slug}/installations/new` : null
}

const API = 'https://api.github.com'

async function appJwt(config: GitHubAppConfig): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  // GitHub's PEM is PKCS#1, which jose can't import itself; node can.
  const key = createPrivateKey(config.privateKey)
  return new SignJWT({})
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer(config.appId)
    .setIssuedAt(now - 60) // allow for clock drift
    .setExpirationTime(now + 9 * 60)
    .sign(key)
}

function gh(fetchImpl: FetchLike, path: string, token: string, init: RequestInit = {}) {
  return fetchImpl(`${API}${path}`, {
    ...init,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'x-github-api-version': '2022-11-28',
      'user-agent': 'sitekick-platform',
    },
  })
}

function mintInstallationToken(fetchImpl: FetchLike, jwt: string, installationId: number) {
  return gh(fetchImpl, `/app/installations/${installationId}/access_tokens`, jwt, { method: 'POST' })
}

/**
 * A short-lived (1 hour) token for one repo's installation, for git over
 * HTTPS as `x-access-token`. Throws if the app isn't installed there.
 */
export async function repoAccessToken(config: GitHubAppConfig, fullName: string, fetchImpl: FetchLike = fetch): Promise<string> {
  const jwt = await appJwt(config)
  const installRes = await gh(fetchImpl, `/repos/${fullName}/installation`, jwt)
  if (!installRes.ok) throw new Error(`The Sitekick GitHub App isn't installed on ${fullName} (GitHub ${installRes.status}).`)
  const installation = (await installRes.json()) as { id: number }
  const tokenRes = await mintInstallationToken(fetchImpl, jwt, installation.id)
  if (!tokenRes.ok) throw new Error(`GitHub answered ${tokenRes.status} when creating an installation token.`)
  return ((await tokenRes.json()) as { token: string }).token
}

export type RepoCheck =
  | {
      ok: true
      installationId: number
      repoId: number
      defaultBranch: string
      private: boolean
      canPush: boolean
    }
  | { ok: false; reason: 'not_installed' | 'error'; message: string }

/** Checks that the app is installed on `fullName` (owner/repo) and can push to it. */
export async function checkRepo(config: GitHubAppConfig, fullName: string, fetchImpl: FetchLike = fetch): Promise<RepoCheck> {
  const jwt = await appJwt(config)

  const installRes = await gh(fetchImpl, `/repos/${fullName}/installation`, jwt)
  if (installRes.status === 404) {
    const link = installUrl(config)
    return {
      ok: false,
      reason: 'not_installed',
      message: `The Sitekick GitHub App isn't installed on ${fullName}${link ? `. Install it: ${link}` : ''}.`,
    }
  }
  if (!installRes.ok) return { ok: false, reason: 'error', message: `GitHub answered ${installRes.status} when looking up the app installation.` }
  const installation = (await installRes.json()) as { id: number }

  const tokenRes = await mintInstallationToken(fetchImpl, jwt, installation.id)
  if (!tokenRes.ok) return { ok: false, reason: 'error', message: `GitHub answered ${tokenRes.status} when creating an installation token.` }
  const token = (await tokenRes.json()) as { token: string; permissions?: Record<string, string> }

  const repoRes = await gh(fetchImpl, `/repos/${fullName}`, token.token)
  if (!repoRes.ok) return { ok: false, reason: 'error', message: `GitHub answered ${repoRes.status} when reading ${fullName}.` }
  const repo = (await repoRes.json()) as { id: number; default_branch: string; private: boolean }

  return {
    ok: true,
    installationId: installation.id,
    repoId: repo.id,
    defaultBranch: repo.default_branch,
    private: repo.private,
    canPush: token.permissions?.['contents'] === 'write',
  }
}
