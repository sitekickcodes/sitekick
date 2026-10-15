import type { CollectionConfig } from 'payload'

import { staffOnly, staffOnlyField } from '../access'
import { hashToken, newOpaqueToken } from '../auth/tokens'

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000

const RAW_TOKEN_KEY = 'sitekick:inviteToken'

/**
 * An invitation to join an organization. The token is emailed once and stored
 * only as a hash. Accepting creates the account if needed, then the
 * membership (src/lib/invites.ts).
 */
export const Invites: CollectionConfig = {
  slug: 'invites',
  admin: { useAsTitle: 'email', defaultColumns: ['email', 'organization', 'role', 'expiresAt', 'acceptedAt'], group: 'Accounts' },
  access: { read: staffOnly, create: staffOnly, update: staffOnly, delete: staffOnly },
  hooks: {
    beforeChange: [
      ({ data, operation, req }) => {
        if (operation !== 'create') return data
        const token = newOpaqueToken('ski')
        req.context[RAW_TOKEN_KEY] = token
        return {
          ...data,
          email: String(data.email).trim().toLowerCase(),
          tokenHash: hashToken(token),
          expiresAt: new Date(Date.now() + INVITE_TTL_MS).toISOString(),
          invitedBy: req.user?.id,
        }
      },
    ],
    afterChange: [
      async ({ doc, operation, req }) => {
        const token = req.context[RAW_TOKEN_KEY]
        if (operation !== 'create' || typeof token !== 'string') return
        const base = process.env.PLATFORM_URL ?? 'http://localhost:3100'
        const org = await req.payload.findByID({
          collection: 'organizations',
          id: typeof doc.organization === 'object' ? doc.organization.id : doc.organization,
          depth: 0,
          overrideAccess: true,
          req,
        })
        const link = `${base}/invite/${token}`
        // Without an email adapter configured, Payload logs this to the console.
        await req.payload.sendEmail({
          to: doc.email,
          subject: `You're invited to ${org.name} on Sitekick`,
          text: `You've been invited to join ${org.name} on Sitekick.\n\nAccept: ${link}\n\nThis link expires in 7 days.`,
        })
      },
    ],
  },
  fields: [
    { name: 'email', type: 'email', required: true, index: true },
    { name: 'organization', type: 'relationship', relationTo: 'organizations', required: true },
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
    {
      name: 'tokenHash',
      type: 'text',
      index: true,
      admin: { hidden: true },
      access: { read: () => false, update: () => false },
    },
    { name: 'expiresAt', type: 'date', admin: { readOnly: true, position: 'sidebar' } },
    { name: 'acceptedAt', type: 'date', admin: { readOnly: true, position: 'sidebar' } },
    {
      name: 'invitedBy',
      type: 'relationship',
      relationTo: 'users',
      admin: { readOnly: true, position: 'sidebar' },
      access: { update: staffOnlyField },
    },
  ],
}
