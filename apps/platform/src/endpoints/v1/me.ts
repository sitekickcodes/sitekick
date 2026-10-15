import type { Endpoint } from 'payload'

import { isStaff } from '../../access'
import type { Organization, Site } from '../../payload-types'
import { publicUser } from './auth'
import { error, json } from './http'

const orgSummary = (org: Organization) => ({ id: org.id, name: org.name, slug: org.slug, kind: org.kind })

/** GET /api/v1/me: the signed-in user and their organizations. */
const me: Endpoint = {
  path: '/v1/me',
  method: 'get',
  handler: async (req) => {
    if (!req.user) return error(401, 'unauthenticated')
    const { docs } = await req.payload.find({
      collection: 'memberships',
      where: { user: { equals: req.user.id } },
      depth: 1,
      pagination: false,
      overrideAccess: true,
    })
    return json({
      user: publicUser(req.user),
      memberships: docs.flatMap((m) =>
        typeof m.organization === 'object' ? [{ organization: orgSummary(m.organization), role: m.role }] : [],
      ),
    })
  },
}

/**
 * GET /api/v1/me/sites: every site the user can open, with their role. The
 * desktop app opens the only site directly, or shows a picker for several.
 */
const mySites: Endpoint = {
  path: '/v1/me/sites',
  method: 'get',
  handler: async (req) => {
    if (!req.user) return error(401, 'unauthenticated')
    const staff = isStaff(req.user)

    const { docs: memberships } = await req.payload.find({
      collection: 'memberships',
      where: { user: { equals: req.user.id } },
      depth: 0,
      pagination: false,
      overrideAccess: true,
    })
    const roleByOrg = new Map(
      memberships.map((m) => [typeof m.organization === 'object' ? m.organization.id : m.organization, m.role]),
    )

    // Access control on `sites` already limits clients to their organizations.
    const { docs: sites } = await req.payload.find({
      collection: 'sites',
      depth: 1,
      pagination: false,
      sort: 'name',
      overrideAccess: false,
      user: req.user,
      req,
    })

    const result = sites
      .filter((site): site is Site & { organization: Organization } => typeof site.organization === 'object')
      .map((site) => ({
        id: site.id,
        name: site.name,
        slug: site.slug,
        productionUrl: site.productionUrl ?? null,
        organization: orgSummary(site.organization),
        role: roleByOrg.get(site.organization.id) ?? (staff ? 'staff' : null),
      }))
      .sort((a, b) => a.organization.name.localeCompare(b.organization.name) || a.name.localeCompare(b.name))

    return json({ sites: result })
  },
}

export const meEndpoints: Endpoint[] = [me, mySites]
