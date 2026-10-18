import type { CollectionConfig } from 'payload'

import { isStaff, staffOnly, staffOnlyField, staffOrSelf } from '../access'
import { sitekickBearerStrategy } from '../auth/strategy'

/**
 * Everyone who signs in: Sitekick staff and client team members. Staff reach
 * every organization and the admin panel. Clients reach only the
 * organizations they hold a membership in, and only through the apps.
 *
 * Identity stays here even if an external provider takes over login later;
 * `authProviderId` maps that provider's user to ours.
 */
export const Users: CollectionConfig = {
  slug: 'users',
  admin: { useAsTitle: 'email', defaultColumns: ['name', 'email', 'kind'], group: 'Accounts' },
  auth: {
    maxLoginAttempts: 5,
    lockTime: 15 * 60 * 1000,
    strategies: [sitekickBearerStrategy],
  },
  access: {
    admin: ({ req: { user } }) => isStaff(user),
    create: staffOnly,
    delete: staffOnly,
    read: staffOrSelf,
    update: staffOrSelf,
  },
  hooks: {
    // memberships.user and auth-sessions.user are required, so their foreign
    // keys can't null out: remove those rows first, in the same transaction.
    beforeDelete: [
      async ({ id, req }) => {
        for (const collection of ['auth-sessions', 'memberships'] as const) {
          await req.payload.delete({ collection, where: { user: { equals: id } }, overrideAccess: true, req })
        }
      },
    ],
    beforeChange: [
      // The first account (the admin's "create first user" screen) has to be
      // staff, or nobody could ever reach the admin panel.
      async ({ data, operation, req }) => {
        if (operation !== 'create') return data
        const { totalDocs } = await req.payload.count({ collection: 'users', overrideAccess: true, req })
        return totalDocs === 0 ? { ...data, kind: 'staff' } : data
      },
    ],
  },
  fields: [
    { name: 'name', type: 'text', required: true },
    {
      name: 'kind',
      type: 'select',
      required: true,
      defaultValue: 'client',
      saveToJWT: true,
      options: [
        { label: 'Sitekick staff', value: 'staff' },
        { label: 'Client', value: 'client' },
      ],
      access: { create: staffOnlyField, update: staffOnlyField },
    },
    {
      name: 'authProviderId',
      type: 'text',
      index: true,
      admin: {
        position: 'sidebar',
        readOnly: true,
        description: 'Set only if an external identity provider takes over sign-in.',
      },
      access: { create: staffOnlyField, update: staffOnlyField },
    },
  ],
}
