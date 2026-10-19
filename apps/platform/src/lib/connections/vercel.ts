import type { FetchLike } from './github'

/**
 * Vercel REST API access for the Sitekick team. v1 covers projects in that
 * team only; client-owned Vercel teams come later.
 */
export type VercelConfig = { token: string; teamId: string }

export function vercelConfig(env: NodeJS.ProcessEnv = process.env): VercelConfig | null {
  const token = env['VERCEL_API_TOKEN']
  const teamId = env['VERCEL_TEAM_ID']
  return token && teamId ? { token, teamId } : null
}

const API = 'https://api.vercel.com'

export type ProjectCheck =
  | {
      ok: true
      projectId: string
      projectName: string
      linkedRepo: string | null
      productionBranch: string | null
      productionUrl: string | null
    }
  | { ok: false; reason: 'not_found' | 'unauthorized' | 'error'; message: string }

type ProjectBody = {
  id: string
  name: string
  link?: { type?: string; org?: string; repo?: string; productionBranch?: string }
}

type DomainsBody = { domains?: { name: string; verified?: boolean; redirect?: string | null; gitBranch?: string | null }[] }

/** Reads a project (by ID or name) and its production domain. */
export async function checkProject(config: VercelConfig, idOrName: string, fetchImpl: FetchLike = fetch): Promise<ProjectCheck> {
  const headers = { authorization: `Bearer ${config.token}` }
  const team = `teamId=${encodeURIComponent(config.teamId)}`

  const res = await fetchImpl(`${API}/v9/projects/${encodeURIComponent(idOrName)}?${team}`, { headers })
  if (res.status === 404) return { ok: false, reason: 'not_found', message: `No Vercel project "${idOrName}" in the Sitekick team.` }
  if (res.status === 401 || res.status === 403) return { ok: false, reason: 'unauthorized', message: 'The platform\'s Vercel token was rejected.' }
  if (!res.ok) return { ok: false, reason: 'error', message: `Vercel answered ${res.status} when reading the project.` }
  const project = (await res.json()) as ProjectBody

  const linkedRepo = project.link?.type === 'github' && project.link.org && project.link.repo ? `${project.link.org}/${project.link.repo}` : null

  // Only fill the URL when it's unambiguous: one custom domain (and its www
  // twin). Multi-domain projects (yimby-website serves ~100 chapter domains)
  // leave it for staff to set.
  let productionUrl: string | null = null
  const domainsRes = await fetchImpl(`${API}/v9/projects/${encodeURIComponent(project.id)}/domains?${team}&production=true&limit=50`, { headers })
  if (domainsRes.ok) {
    const { domains = [], pagination } = (await domainsRes.json()) as DomainsBody & { pagination?: { next?: number | null } }
    const custom = domains.filter((d) => d.verified !== false && !d.gitBranch && !d.name.endsWith('.vercel.app'))
    const sites = new Set(custom.map((d) => d.name.replace(/^www\./, '')))
    if (sites.size === 1 && !pagination?.next) {
      const serving = custom.filter((d) => !d.redirect)
      const pick = serving.find((d) => !d.name.startsWith('www.')) ?? serving[0]
      if (pick) productionUrl = `https://${pick.name}`
    }
  }

  return {
    ok: true,
    projectId: project.id,
    projectName: project.name,
    linkedRepo,
    productionBranch: project.link?.productionBranch ?? null,
    productionUrl,
  }
}
