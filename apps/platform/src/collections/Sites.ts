import type { CollectionConfig } from 'payload'

import { isStaff, memberOrgIds, staffOnly } from '../access'

/** A client website: a GitHub repo deployed as a Vercel project. */
export const Sites: CollectionConfig = {
  slug: 'sites',
  admin: { useAsTitle: 'name', defaultColumns: ['name', 'organization', 'productionUrl'], group: 'Sites' },
  access: {
    read: async ({ req }) => {
      if (!req.user) return false
      if (isStaff(req.user)) return true
      return { organization: { in: await memberOrgIds(req) } }
    },
    create: staffOnly,
    update: staffOnly,
    delete: staffOnly,
  },
  fields: [
    { name: 'organization', type: 'relationship', relationTo: 'organizations', required: true, index: true },
    { name: 'name', type: 'text', required: true },
    { name: 'slug', type: 'text', required: true, unique: true, index: true },
    { name: 'productionUrl', type: 'text' },
    {
      name: 'githubRepo',
      type: 'text',
      admin: { description: 'owner/repo, for example sitekickcodes/yimby-website' },
      validate: (value: string | null | undefined) =>
        !value || /^[\w.-]+\/[\w.-]+$/.test(value) ? true : 'Use the form owner/repo',
    },
    { name: 'defaultBranch', type: 'text', defaultValue: 'main' },
    { name: 'vercelProjectId', type: 'text' },
    {
      name: 'publishPolicy',
      type: 'select',
      required: true,
      defaultValue: 'staff-approval',
      options: [
        { label: 'Staff approval required', value: 'staff-approval' },
        { label: 'Publish directly', value: 'direct' },
      ],
    },
  ],
}
