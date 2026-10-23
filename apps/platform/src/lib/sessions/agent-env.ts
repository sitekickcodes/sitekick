import { getVercelOidcToken } from '@vercel/functions/oidc'
import type { NetworkPolicy } from '@vercel/sandbox'

/**
 * How the editing agent (Claude Code, inside the session's sandbox) reaches
 * the model: Vercel AI Gateway's Claude Code endpoint, authenticated by the
 * platform's Vercel OIDC token. The token never enters the VM: the sandbox
 * firewall sets the Authorization header on requests to the gateway, and the
 * VM only holds a placeholder.
 */
export const AGENT_MODEL = 'anthropic/claude-opus-5.5'
export const AGENT_SMALL_MODEL = 'anthropic/claude-haiku-5.5'
const GATEWAY_HOST = 'ai-gateway.vercel.sh'

export const AGENT_INSTALL =
  'command -v claude >/dev/null || npm install -g --prefix "$HOME/.local" @anthropic-ai/claude-code >/dev/null 2>&1 && command -v claude'

export async function agentNetworkPolicy(): Promise<NetworkPolicy> {
  const token = await getVercelOidcToken()
  return {
    allow: {
      [GATEWAY_HOST]: [{ transform: [{ headers: { authorization: `Bearer ${token}` } }] }],
      '*': [],
    },
  }
}

export const agentEnv: Record<string, string> = {
  ANTHROPIC_BASE_URL: `https://${GATEWAY_HOST}/claude-code`,
  ANTHROPIC_API_KEY: '',
  // Replaced by the firewall; the real credential never reaches the VM.
  ANTHROPIC_AUTH_TOKEN: 'sitekick-brokered',
  ANTHROPIC_MODEL: AGENT_MODEL,
  ANTHROPIC_SMALL_FAST_MODEL: AGENT_SMALL_MODEL,
  DISABLE_AUTOUPDATER: '1',
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
}

export const AGENT_SYSTEM_PROMPT = `You are Sitekick's site-editing agent, working in a live copy of a client's website for a Sitekick staff member or the client's own marketing team. Their message is a request to change the site.

- The site's dev server is already running with hot reload; the person sees your edits in a preview as you save. Don't start, stop or restart servers, and don't run builds unless they ask.
- Make focused changes that do what was asked. Match the existing code, components and styles. If the request is ambiguous, make the most reasonable change and say what you assumed.
- Don't run git commands: Sitekick saves a checkpoint after your turn and handles undo and publishing.
- Never read, print or change .env or .env.local files, and never deploy or call production services.
- The people you're talking to may not be developers. End with two or three plain sentences on what changed and where to look in the preview, without code unless they asked for it.`
