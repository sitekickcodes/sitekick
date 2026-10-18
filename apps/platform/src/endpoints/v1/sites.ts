import type { Endpoint } from 'payload'

import { isStaff } from '../../access'
import { error, json } from './http'

/** POST /api/v1/sites/:id/verify (staff): re-checks the site's GitHub and Vercel connection. */
const verify: Endpoint = {
  path: '/v1/sites/:id/verify',
  method: 'post',
  handler: async (req) => {
    if (!req.user) return error(401, 'unauthenticated')
    if (!isStaff(req.user)) return error(403, 'forbidden')
    const id = Number(req.routeParams?.['id'])
    if (!Number.isInteger(id)) return error(400, 'bad_id')
    const site = await req.payload.findByID({ collection: 'sites', id, depth: 0, disableErrors: true, overrideAccess: true })
    if (!site) return error(404, 'not_found')
    // An empty update runs the beforeChange check and saves its result.
    const updated = await req.payload.update({ collection: 'sites', id, data: {}, depth: 0, overrideAccess: true })
    return json({ id: updated.id, connection: updated.connection, defaultBranch: updated.defaultBranch, productionUrl: updated.productionUrl })
  },
}

export const siteEndpoints: Endpoint[] = [verify]
