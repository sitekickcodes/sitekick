import type { CollectionConfig } from 'payload'

import { isStaff, staffOnly } from '../access'

/** A user's role in one organization. A user can belong to several. */
export const Memberships: CollectionConfig = {
  slug: 'memberships',
  admin: { defaultColumns: ['user', 'organization', 'role'], group: 'Accounts' },
  indexes: [{ fields: ['user', 'organization'], unique: true }],
  access: {
    read: ({ req: { user } }) => {
      if (!user) return false
      if (isStaff(user)) return true
      return { user: { equals: user.id } }
    },
    create: staffOnly,
    update: staffOnly,
    delete: staffOnly,
  },
  fields: [
    { name: 'user', type: 'relationship', relationTo: 'users', required: true, index: true },
    { name: 'organization', type: 'relationship', relationTo: 'organizations', required: true, index: true },
    {
      name: 'role',
      type: 'select',
      required: true,
      defaultValue: 'editor',
      options: [
        { label: 'Owner', value: 'owner' },
        { label: 'Editor', value: 'editor' },
        { label: 'Viewer', value: 'viewer' },
      ],
    },
  ],
}
