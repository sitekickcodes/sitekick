import { checkRepo, githubAppConfig, type FetchLike, type GitHubAppConfig } from './github'
import { checkProject, vercelConfig, type VercelConfig } from './vercel'

export type ConnectionStatus = 'ok' | 'problem' | 'not_configured' | 'unchecked'

/** What a check learned, written onto the site's `connection` group. */
export type ConnectionResult = {
  status: ConnectionStatus
  message: string | null
  githubInstallationId: number | null
  githubRepoId: number | null
  githubCanPush: boolean
  vercelProjectId: string | null
  vercelProjectName: string | null
  /** Suggestions for the site's editable fields when they're empty. */
  defaultBranch: string | null
  productionUrl: string | null
}

export type CheckDeps = {
  github: GitHubAppConfig | null
  vercel: VercelConfig | null
  fetch: FetchLike
}

export const liveDeps = (): CheckDeps => ({ github: githubAppConfig(), vercel: vercelConfig(), fetch })

/**
 * Checks a site's GitHub repo and Vercel project and that they belong
 * together. Never throws for an expected failure: problems come back as
 * `status: 'problem'` with every reason in `message`.
 */
export async function checkSiteConnection(
  site: { githubRepo?: string | null; vercelProjectId?: string | null },
  deps: CheckDeps = liveDeps(),
): Promise<ConnectionResult> {
  const result: ConnectionResult = {
    status: 'unchecked',
    message: null,
    githubInstallationId: null,
    githubRepoId: null,
    githubCanPush: false,
    vercelProjectId: null,
    vercelProjectName: null,
    defaultBranch: null,
    productionUrl: null,
  }
  const repo = site.githubRepo?.trim()
  const project = site.vercelProjectId?.trim()
  if (!repo && !project) return result

  const missing = [
    repo && !deps.github ? 'GitHub App credentials (GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY)' : null,
    project && !deps.vercel ? 'a Vercel token (VERCEL_API_TOKEN, VERCEL_TEAM_ID)' : null,
  ].filter((m): m is string => m !== null)
  if (missing.length) {
    return { ...result, status: 'not_configured', message: `The platform is missing ${missing.join(' and ')}.` }
  }

  const problems: string[] = []

  if (repo && deps.github) {
    try {
      const gh = await checkRepo(deps.github, repo, deps.fetch)
      if (gh.ok) {
        result.githubInstallationId = gh.installationId
        result.githubRepoId = gh.repoId
        result.githubCanPush = gh.canPush
        result.defaultBranch = gh.defaultBranch
        if (!gh.canPush) problems.push('The Sitekick GitHub App can read this repo but not push to it. Give it Contents: read and write.')
      } else {
        problems.push(gh.message)
      }
    } catch (err) {
      problems.push(`Couldn't reach GitHub (${err instanceof Error ? err.message : 'unknown error'}).`)
    }
  } else if (!repo) {
    problems.push('Add the GitHub repo (owner/repo).')
  }

  if (project && deps.vercel) {
    try {
      const vc = await checkProject(deps.vercel, project, deps.fetch)
      if (vc.ok) {
        result.vercelProjectId = vc.projectId
        result.vercelProjectName = vc.projectName
        result.productionUrl = vc.productionUrl
        if (!vc.linkedRepo) {
          problems.push(`Vercel project ${vc.projectName} isn't connected to a GitHub repo.`)
        } else if (repo && vc.linkedRepo.toLowerCase() !== repo.toLowerCase()) {
          problems.push(`Vercel project ${vc.projectName} deploys ${vc.linkedRepo}, not ${repo}.`)
        }
      } else {
        problems.push(vc.message)
      }
    } catch (err) {
      problems.push(`Couldn't reach Vercel (${err instanceof Error ? err.message : 'unknown error'}).`)
    }
  } else if (!project) {
    problems.push('Add the Vercel project (name or ID).')
  }

  return { ...result, status: problems.length ? 'problem' : 'ok', message: problems.length ? problems.join(' ') : null }
}
