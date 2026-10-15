import type { CollectionConfig } from 'payload'

import { isStaff, memberOrgIds, staffOnly } from '../access'

/** The tenant: Sitekick itself (agency) or a client. */
export const Organizations: CollectionConfig = {
  slug: 'organizations',
  admin: { useAsTitle: 'name', defaultColumns: ['name', 'slug', 'kind'], group: 'Accounts' },
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
