import type { AuthStrategy } from 'payload'

import { verifyAccessToken } from './tokens'

/**
 * Accepts our /api/v1 access tokens on every Payload route (REST and custom
 * endpoints). Runs after Payload's own JWT strategy, which rejects these
 * tokens because they're signed with a different key.
 */
export const sitekickBearerStrategy: AuthStrategy = {
  name: 'sitekick-bearer',
  authenticate: async ({ headers, payload }) => {
    const header = headers.get('authorization')
    if (!header?.startsWith('Bearer ')) return { user: null }

    const claims = await verifyAccessToken(header.slice('Bearer '.length))
    if (!claims) return { user: null }

    // Revocation is immediate: a signed-out or revoked device stops working
    // even while its access token is unexpired.
    const session = await payload
      .findByID({ collection: 'auth-sessions', id: claims.sessionId, depth: 0, overrideAccess: true, disableErrors: true })
    const sessionUser = session && (typeof session.user === 'object' ? session.user.id : session.user)
    if (!session || session.revokedAt || sessionUser !== claims.userId) return { user: null }

    const user = await payload.findByID({
      collection: 'users',
      id: claims.userId,
      depth: 0,
      overrideAccess: true,
      disableErrors: true,
    })
    if (!user) return { user: null }

    return { user: { ...user, collection: 'users', _strategy: 'sitekick-bearer' } }
  },
}
