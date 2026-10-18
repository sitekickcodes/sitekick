import type { Endpoint, PayloadRequest } from 'payload'

import { DEVICE_CODE_TTL_MS, POLL_INTERVAL_SECONDS, pollDeviceAuthorization, startDeviceAuthorization } from '../../lib/device'
import { startSession } from './auth'
import { error, json, readJson, str } from './http'

function platformOrigin(req: PayloadRequest): string {
  if (process.env.PLATFORM_URL) return process.env.PLATFORM_URL
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? 'localhost:3100'
  const proto = req.headers.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https')
  return `${proto}://${host}`
}

/**
 * POST /api/v1/auth/device { deviceName? }: starts a browser sign-in. The app
 * shows `userCode`, opens `verificationUriComplete`, and polls /device/token.
 */
const start: Endpoint = {
  path: '/v1/auth/device',
  method: 'post',
  handler: async (req) => {
    const { deviceCode, userCode } = await startDeviceAuthorization(req.payload, str((await readJson(req))['deviceName']))
    const verificationUri = `${platformOrigin(req)}/activate`
    return json({
      deviceCode,
      userCode,
      verificationUri,
      verificationUriComplete: `${verificationUri}?code=${encodeURIComponent(userCode)}`,
      expiresIn: DEVICE_CODE_TTL_MS / 1000,
      interval: POLL_INTERVAL_SECONDS,
    })
  },
}

/**
 * POST /api/v1/auth/device/token { deviceCode }: one poll. Returns the token
 * response once the person approves, otherwise 400 with RFC 8628's codes:
 * authorization_pending, slow_down, access_denied or expired_token.
 */
const token: Endpoint = {
  path: '/v1/auth/device/token',
  method: 'post',
  handler: async (req) => {
    const deviceCode = str((await readJson(req))['deviceCode'])
    if (!deviceCode) return error(400, 'missing_device_code')
    const result = await pollDeviceAuthorization(req.payload, deviceCode)
    switch (result.state) {
      case 'approved':
        return json(await startSession(req.payload, result.user, result.deviceName))
      case 'pending':
        return error(400, 'authorization_pending')
      case 'slow_down':
        return error(400, 'slow_down')
      case 'denied':
        return error(400, 'access_denied')
      case 'expired':
        return error(400, 'expired_token')
    }
  },
}

export const deviceEndpoints: Endpoint[] = [start, token]
