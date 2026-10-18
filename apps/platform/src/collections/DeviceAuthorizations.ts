import type { CollectionConfig } from 'payload'

import { staffOnly } from '../access'

/**
 * A pending browser sign-in for an app (OAuth 2.0 device authorization,
 * RFC 8628). The app shows `userCode` and polls with the device code (stored
 * only as a hash). The person approves on /activate in their browser, and
 * the next poll issues the app its tokens. See src/lib/device.ts.
 */
export const DeviceAuthorizations: CollectionConfig = {
  slug: 'device-authorizations',
  labels: { singular: 'Device sign-in', plural: 'Device sign-ins' },
  admin: {
    useAsTitle: 'userCode',
    defaultColumns: ['userCode', 'deviceName', 'status', 'user', 'expiresAt'],
    group: 'Accounts',
  },
  access: { read: staffOnly, create: () => false, update: () => false, delete: staffOnly },
  fields: [
    {
      name: 'deviceCodeHash',
      type: 'text',
      required: true,
      index: true,
      admin: { hidden: true },
      access: { read: () => false, update: () => false },
    },
    { name: 'userCode', type: 'text', required: true, unique: true, index: true },
    { name: 'deviceName', type: 'text' },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'pending',
      options: [
        { label: 'Waiting for approval', value: 'pending' },
        { label: 'Approved', value: 'approved' },
        { label: 'Denied', value: 'denied' },
        { label: 'Used', value: 'consumed' },
      ],
    },
    { name: 'user', type: 'relationship', relationTo: 'users', admin: { description: 'Who approved it.' } },
    { name: 'expiresAt', type: 'date', required: true },
    { name: 'lastPolledAt', type: 'date' },
  ],
}
