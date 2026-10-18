import { cookies, headers } from 'next/headers'
import { AuthenticationError, generatePayloadCookie, getPayload, LockedAuth } from 'payload'

import config from '@payload-config'

import type { User } from '../payload-types'

/**
 * Browser sessions for the platform's own pages (/activate). They use
 * Payload's cookie, separate from the /api/v1 tokens apps hold.
 */
export async function getWebUser(): Promise<User | null> {
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: await headers() })
  return user && user.collection === 'users' ? user : null
}

export type SignInResult = 'ok' | 'invalid' | 'locked'

export async function signInWithPassword(email: string, password: string): Promise<SignInResult> {
  const payload = await getPayload({ config })
  try {
    const { token } = await payload.login({
      collection: 'users',
      data: { email: email.trim().toLowerCase(), password },
      depth: 0,
    })
    if (!token) return 'invalid'
    const cookie = generatePayloadCookie({
      collectionAuthConfig: payload.collections.users.config.auth,
      cookiePrefix: payload.config.cookiePrefix,
      token,
      returnCookieAsObject: true,
    })
    ;(await cookies()).set({
      name: cookie.name,
      value: cookie.value ?? '',
      path: cookie.path ?? '/',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      ...(cookie.expires ? { expires: new Date(cookie.expires) } : {}),
    })
    return 'ok'
  } catch (err) {
    if (err instanceof LockedAuth) return 'locked'
    if (err instanceof AuthenticationError) return 'invalid'
    throw err
  }
}

export async function signOutWeb(): Promise<void> {
  const payload = await getPayload({ config })
  ;(await cookies()).delete(`${payload.config.cookiePrefix}-token`)
}
