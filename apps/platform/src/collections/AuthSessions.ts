import type { CollectionConfig } from 'payload'

import { isStaff, staffOnly } from '../access'

/**
 * One signed-in device (desktop app, later mobile). Holds the hash of its
 * current refresh token and the previous one, so a replayed old token is
 * detected and revokes the session. Created only by /api/v1/auth/login.
 */
export const AuthSessions: CollectionConfig = {
  slug: 'auth-sessions',
  labels: { singular: 'Device session', plural: 'Device sessions' },
  admin: {
    useAsTitle: 'deviceName',
    defaultColumns: ['deviceName', 'user', 'lastUsedAt', 'revokedAt'],
    group: 'Accounts',
  },
  access: {
    read: ({ req: { user } }) => {
      if (!user) return false
      if (isStaff(user)) return true
      return { user: { equals: user.id } }
    },
    create: () => false,
    update: staffOnly,
    delete: staffOnly,
  },
  fields: [
    { name: 'user', type: 'relationship', relationTo: 'users', required: true, index: true },
    { name: 'deviceName', type: 'text' },
    {
      name: 'tokenHash',
      type: 'text',
      required: true,
      index: true,
      admin: { hidden: true },
      access: { read: () => false, update: () => false },
    },
    {
      name: 'previousTokenHash',
      type: 'text',
      index: true,
      admin: { hidden: true },
      access: { read: () => false, update: () => false },
    },
    { name: 'expiresAt', type: 'date', required: true },
    { name: 'lastUsedAt', type: 'date' },
    { name: 'revokedAt', type: 'date', admin: { description: 'Set this to sign the device out.' } },
  ],
}
