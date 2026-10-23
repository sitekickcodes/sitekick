import type { CollectionConfig } from 'payload'

import { isStaff } from '../access'

/**
 * The chat in an editing session: the person's prompts, the agent's replies,
 * short notes on what the agent did (edited a file, ran a command), and
 * Sitekick's own notices (saved a checkpoint, undid one). Written only by
 * src/lib/sessions/agent.ts.
 */
export const Messages: CollectionConfig = {
  slug: 'messages',
  admin: { useAsTitle: 'text', defaultColumns: ['session', 'role', 'text', 'createdAt'], group: 'Sites' },
  access: {
    read: ({ req: { user } }) => {
      if (!user) return false
      if (isStaff(user)) return true
      return { 'session.user': { equals: user.id } }
    },
    create: () => false,
    update: () => false,
    delete: ({ req: { user } }) => isStaff(user),
  },
  fields: [
    { name: 'session', type: 'relationship', relationTo: 'sessions', required: true, index: true },
    {
      name: 'role',
      type: 'select',
      required: true,
      options: [
        { label: 'Person', value: 'user' },
        { label: 'Agent', value: 'assistant' },
        { label: 'Agent action', value: 'tool' },
        { label: 'Sitekick', value: 'notice' },
      ],
    },
    { name: 'text', type: 'textarea', required: true },
    { name: 'turn', type: 'number', required: true },
  ],
}
