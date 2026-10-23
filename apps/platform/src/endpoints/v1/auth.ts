import { AuthenticationError, LockedAuth, type Endpoint, type Payload } from 'payload'

import { hashToken, newOpaqueToken, REFRESH_TOKEN_TTL_MS, signAccessToken } from '../../auth/tokens'
import type { User } from '../../payload-types'
import { error, json, readJson, str } from './http'

export const publicUser = (user: Pick<User, 'id' | 'email' | 'name' | 'kind'>) => ({
  id: user.id,
  email: user.email,
  name: user.name,
  kind: user.kind,
})

async function issueTokens(payload: Payload, userId: number, sessionId: number, refreshToken: string) {
  const access = await signAccessToken(userId, sessionId)
  return {
    accessToken: access.token,
    accessTokenExpiresAt: access.expiresAt.toISOString(),
    refreshToken,
  }
}

/** Creates a device session for `user` and returns the token response body. */
export async function startSession(payload: Payload, user: User, deviceName: string | undefined) {
  const refreshToken = newOpaqueToken('skr')
  const session = await payload.create({
    collection: 'auth-sessions',
    data: {
      user: user.id,
      deviceName: deviceName?.slice(0, 120) || 'Unknown device',
      tokenHash: hashToken(refreshToken),
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS).toISOString(),
      lastUsedAt: new Date().toISOString(),
    },
    overrideAccess: true,
  })
  return { ...(await issueTokens(payload, user.id, session.id, refreshToken)), user: publicUser(user) }
}

/** POST /api/v1/auth/login { email, password, deviceName? } */
const login: Endpoint = {
  path: '/v1/auth/login',
  method: 'post',
  handler: async (req) => {
    const body = await readJson(req)
    const email = str(body['email'])?.trim().toLowerCase()
    const password = str(body['password'])
    if (!email || !password) return error(400, 'missing_credentials')

    let user: User
    try {
      // Payload's login enforces maxLoginAttempts and lockTime for us.
      const result = await req.payload.login({ collection: 'users', data: { email, password }, depth: 0, overrideAccess: true })
      if (!result.user) return error(401, 'invalid_credentials')
      user = result.user
    } catch (err) {
      if (err instanceof LockedAuth) return error(423, 'locked', 'Too many attempts. Try again in 15 minutes.')
      if (err instanceof AuthenticationError) return error(401, 'invalid_credentials')
      throw err
    }

    return json(await startSession(req.payload, user, str(body['deviceName'])))
  },
}

/** POST /api/v1/auth/refresh { refreshToken }: rotates the refresh token. */
const refresh: Endpoint = {
  path: '/v1/auth/refresh',
  method: 'post',
  handler: async (req) => {
    const presented = str((await readJson(req))['refreshToken'])
    if (!presented) return error(400, 'missing_refresh_token')
    const presentedHash = hashToken(presented)

    const { docs } = await req.payload.find({
      collection: 'auth-sessions',
      where: { tokenHash: { equals: presentedHash } },
      depth: 1,
      limit: 1,
      overrideAccess: true,
    })
    const session = docs[0]

    if (!session) {
      // A rotated-out token coming back means it leaked: revoke the session.
      const { docs: reused } = await req.payload.find({
        collection: 'auth-sessions',
        where: { previousTokenHash: { equals: presentedHash }, revokedAt: { exists: false } },
        depth: 0,
        limit: 1,
        overrideAccess: true,
      })
      if (reused[0]) {
        await req.payload.update({
          collection: 'auth-sessions',
          id: reused[0].id,
          data: { revokedAt: new Date().toISOString() },
          overrideAccess: true,
        })
      }
      return error(401, 'invalid_refresh_token')
    }

    if (session.revokedAt || new Date(session.expiresAt) < new Date() || typeof session.user !== 'object') {
      return error(401, 'invalid_refresh_token')
    }

    const nextToken = newOpaqueToken('skr')
    await req.payload.update({
      collection: 'auth-sessions',
      id: session.id,
      data: {
        tokenHash: hashToken(nextToken),
        previousTokenHash: presentedHash,
        lastUsedAt: new Date().toISOString(),
      },
      overrideAccess: true,
    })

    return json({ ...(await issueTokens(req.payload, session.user.id, session.id, nextToken)), user: publicUser(session.user) })
  },
}

/** POST /api/v1/auth/logout { refreshToken }: revokes this device's session. */
const logout: Endpoint = {
  path: '/v1/auth/logout',
  method: 'post',
  handler: async (req) => {
    const presented = str((await readJson(req))['refreshToken'])
    if (presented) {
      const { docs } = await req.payload.find({
        collection: 'auth-sessions',
        where: { tokenHash: { equals: hashToken(presented) }, revokedAt: { exists: false } },
        depth: 0,
        limit: 1,
        overrideAccess: true,
      })
      if (docs[0]) {
        await req.payload.update({
          collection: 'auth-sessions',
          id: docs[0].id,
          data: { revokedAt: new Date().toISOString() },
          overrideAccess: true,
        })
      }
    }
    return new Response(null, { status: 204 })
  },
}

export const authEndpoints: Endpoint[] = [login, refresh, logout]
