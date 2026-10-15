import { createHash, randomBytes } from 'node:crypto'
import { SignJWT, jwtVerify } from 'jose'

/**
 * Tokens for first-party clients (desktop now, mobile later). They are ours,
 * not Payload's: a later move to Better Auth or Clerk only changes how
 * /api/v1/auth issues them (docs/architecture.md, "Auth guardrails").
 *
 * - Access token: short-lived HS256 JWT, sent as `Authorization: Bearer`.
 * - Refresh token: opaque, stored only as a SHA-256 hash on an auth-session,
 *   and rotated on every refresh.
 */

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000

const ISSUER = 'sitekick-platform'
const AUDIENCE = 'sitekick-api'

// Derived from PAYLOAD_SECRET but distinct from Payload's own signing key, so
// Payload's JWT strategy never accepts our tokens and ours never accepts its.
function accessTokenKey(): Uint8Array {
  const secret = process.env.PAYLOAD_SECRET
  if (!secret) throw new Error('PAYLOAD_SECRET is not set')
  return createHash('sha256').update(`sitekick-api-access-token:${secret}`).digest()
}

export async function signAccessToken(userId: number, sessionId: number): Promise<{ token: string; expiresAt: Date }> {
  const expiresAt = new Date(Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000)
  const token = await new SignJWT({ sid: String(sessionId) })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(userId))
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(accessTokenKey())
  return { token, expiresAt }
}

export async function verifyAccessToken(token: string): Promise<{ userId: number; sessionId: number } | null> {
  try {
    const { payload } = await jwtVerify(token, accessTokenKey(), {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ['HS256'],
    })
    const userId = Number(payload.sub)
    const sessionId = Number(payload['sid'])
    if (!Number.isInteger(userId) || !Number.isInteger(sessionId)) return null
    return { userId, sessionId }
  } catch {
    return null
  }
}

export function newOpaqueToken(prefix: string): string {
  return `${prefix}_${randomBytes(32).toString('base64url')}`
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}
