import { APIError, type CollectionConfig } from 'payload'

import { isStaff, memberOrgIds, staffOnly } from '../access'

/** The tenant: Sitekick itself (agency) or a client. */
export const Organizations: CollectionConfig = {
  slug: 'organizations',
  admin: { useAsTitle: 'name', defaultColumns: ['name', 'slug', 'kind'], group: 'Accounts' },
  hooks: {
    beforeDelete: [
      async ({ id, req }) => {
        // Never delete sites as a side effect: they point at real repos.
        const { totalDocs } = await req.payload.count({
          collection: 'sites',
          where: { organization: { equals: id } },
          overrideAccess: true,
          req,
        })
        if (totalDocs > 0) {
          throw new APIError('Move or delete this organization\'s sites before deleting it.', 400, undefined, true)
        }
        // Their organization foreign keys are required, so remove them first.
        for (const collection of ['memberships', 'invites'] as const) {
          await req.payload.delete({ collection, where: { organization: { equals: id } }, overrideAccess: true, req })
        }
      },
    ],
  },
  access: {
    read: async ({ req }) => {
      if (!req.user) return false
      if (isStaff(req.user)) return true
      return { id: { in: await memberOrgIds(req) } }
    },
    create: staffOnly,
    update: staffOnly,
    delete: staffOnly,
  },
  fields: [
    { name: 'name', type: 'text', required: true },
    { name: 'slug', type: 'text', required: true, unique: true, index: true },
    {
      name: 'kind',
      type: 'select',
      required: true,
      defaultValue: 'client',
      options: [
        { label: 'Agency', value: 'agency' },
        { label: 'Client', value: 'client' },
      ],
    },
  ],
}
