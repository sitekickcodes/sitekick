import { randomInt } from 'node:crypto'

import type { Payload } from 'payload'

import { hashToken, newOpaqueToken } from '../auth/tokens'
import type { DeviceAuthorization, User } from '../payload-types'

export const DEVICE_CODE_TTL_MS = 10 * 60 * 1000
/** Seconds the app waits between polls. Faster polls get `slow_down`. */
export const POLL_INTERVAL_SECONDS = 3

// No vowels (no accidental words) and no look-alikes (0/O, 1/I/L).
const USER_CODE_ALPHABET = 'BCDFGHJKMNPQRSTVWXZ23456789'

function newUserCode(): string {
  let code = ''
  for (let i = 0; i < 8; i++) code += USER_CODE_ALPHABET[randomInt(USER_CODE_ALPHABET.length)]
  return `${code.slice(0, 4)}-${code.slice(4)}`
}

/** Accepts what people type: any case, with or without the dash or spaces. */
export function normalizeUserCode(input: string): string | null {
  const raw = input.toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (raw.length !== 8 || [...raw].some((c) => !USER_CODE_ALPHABET.includes(c))) return null
  return `${raw.slice(0, 4)}-${raw.slice(4)}`
}

export async function startDeviceAuthorization(payload: Payload, deviceName: string | undefined) {
  const deviceCode = newOpaqueToken('skd')
  const auth = await payload.create({
    collection: 'device-authorizations',
    data: {
      deviceCodeHash: hashToken(deviceCode),
      userCode: newUserCode(),
      deviceName: deviceName?.slice(0, 120) || 'Unknown device',
      status: 'pending',
      expiresAt: new Date(Date.now() + DEVICE_CODE_TTL_MS).toISOString(),
    },
    overrideAccess: true,
  })
  return { deviceCode, userCode: auth.userCode }
}

const isLive = (auth: DeviceAuthorization) => new Date(auth.expiresAt) > new Date()

/** A pending, unexpired authorization by the code the person typed. */
export async function findPendingByUserCode(payload: Payload, input: string): Promise<DeviceAuthorization | null> {
  const userCode = normalizeUserCode(input)
  if (!userCode) return null
  const { docs } = await payload.find({
    collection: 'device-authorizations',
    where: { userCode: { equals: userCode }, status: { equals: 'pending' } },
    depth: 0,
    limit: 1,
    overrideAccess: true,
  })
  const auth = docs[0]
  return auth && isLive(auth) ? auth : null
}

export async function decideDeviceAuthorization(
  payload: Payload,
  input: string,
  user: User,
  decision: 'approved' | 'denied',
): Promise<boolean> {
  const auth = await findPendingByUserCode(payload, input)
  if (!auth) return false
  await payload.update({
    collection: 'device-authorizations',
    id: auth.id,
    data: { status: decision, user: user.id },
    overrideAccess: true,
  })
  return true
}

export type PollResult =
  | { state: 'approved'; user: User; deviceName: string | undefined }
  | { state: 'pending' | 'slow_down' | 'denied' | 'expired' }

/**
 * One poll from the app. An approved authorization is consumed by the poll
 * that sees it, so a device code yields tokens at most once.
 */
export async function pollDeviceAuthorization(payload: Payload, deviceCode: string): Promise<PollResult> {
  const { docs } = await payload.find({
    collection: 'device-authorizations',
    where: { deviceCodeHash: { equals: hashToken(deviceCode) } },
    depth: 1,
    limit: 1,
    overrideAccess: true,
  })
  const auth = docs[0]
  if (!auth || auth.status === 'consumed' || !isLive(auth)) return { state: 'expired' }

  const now = new Date()
  const tooSoon =
    auth.lastPolledAt !== null &&
    auth.lastPolledAt !== undefined &&
    now.getTime() - new Date(auth.lastPolledAt).getTime() < (POLL_INTERVAL_SECONDS - 1) * 1000
  const finished = auth.status === 'approved' || auth.status === 'denied'
  await payload.update({
    collection: 'device-authorizations',
    id: auth.id,
    data: { lastPolledAt: now.toISOString(), ...(finished ? { status: 'consumed' as const } : {}) },
    overrideAccess: true,
  })

  if (auth.status === 'denied') return { state: 'denied' }
  if (auth.status === 'approved' && typeof auth.user === 'object' && auth.user) {
    return { state: 'approved', user: auth.user, deviceName: auth.deviceName ?? undefined }
  }
  return { state: tooSoon ? 'slow_down' : 'pending' }
}
