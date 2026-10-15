import type { Endpoint } from 'payload'

import { acceptInvite, previewInvite } from '../../lib/invites'
import { error, json, readJson, str } from './http'

/** GET /api/v1/invites/:token: who the invite is for, before accepting. */
const preview: Endpoint = {
  path: '/v1/invites/:token',
  method: 'get',
  handler: async (req) => {
    const token = str(req.routeParams?.['token'])
    const invite = token ? await previewInvite(req.payload, token) : null
    return invite ? json(invite) : error(404, 'invalid_or_expired')
  },
}

/** POST /api/v1/invites/accept { token, name?, password? } */
const accept: Endpoint = {
  path: '/v1/invites/accept',
  method: 'post',
  handler: async (req) => {
    const body = await readJson(req)
    const token = str(body['token'])
    if (!token) return error(400, 'missing_token')
    const name = str(body['name'])
    const password = str(body['password'])
    const result = await acceptInvite(req.payload, {
      token,
      ...(name !== undefined ? { name } : {}),
      ...(password !== undefined ? { password } : {}),
    })
    return result.ok ? json(result) : error(result.error === 'invalid_or_expired' ? 404 : 400, result.error)
  },
}

export const inviteEndpoints: Endpoint[] = [preview, accept]
