import type { CollectionConfig } from 'payload'

import { isStaff, staffOnly } from '../access'

export const SESSION_PHASES = ['starting', 'branching', 'booting', 'installing', 'migrating', 'starting_server', 'ready'] as const
export const ACTIVE_STATUSES = [...SESSION_PHASES] as string[]

/**
 * One editing session: a Vercel Sandbox running the site's repo (on its own
 * git branch) against its own Neon branch, with the dev server's preview
 * URL. Created and advanced only by src/lib/sessions/orchestrate.ts.
 */
export const Sessions: CollectionConfig = {
  slug: 'sessions',
  admin: {
    useAsTitle: 'gitBranch',
    defaultColumns: ['site', 'user', 'status', 'previewUrl', 'lastActiveAt'],
    group: 'Sites',
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
    { name: 'site', type: 'relationship', relationTo: 'sites', required: true, index: true },
    { name: 'user', type: 'relationship', relationTo: 'users', required: true, index: true },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'starting',
      index: true,
      options: [
        { label: 'Starting', value: 'starting' },
        { label: 'Creating database branch', value: 'branching' },
        { label: 'Booting sandbox', value: 'booting' },
        { label: 'Installing dependencies', value: 'installing' },
        { label: 'Running migrations', value: 'migrating' },
        { label: 'Starting dev server', value: 'starting_server' },
        { label: 'Ready', value: 'ready' },
        { label: 'Failed', value: 'failed' },
        { label: 'Stopped', value: 'stopped' },
      ],
    },
    { name: 'previewUrl', type: 'text' },
    { name: 'gitBranch', type: 'text' },
    { name: 'sandboxName', type: 'text', admin: { readOnly: true } },
    { name: 'neonProjectId', type: 'text', admin: { readOnly: true } },
    { name: 'neonBranchId', type: 'text', admin: { readOnly: true } },
    { name: 'error', type: 'textarea' },
    { name: 'log', type: 'textarea', admin: { description: 'Setup output (tail).' } },
    { name: 'phaseStartedAt', type: 'date' },
    { name: 'sandboxExpiresAt', type: 'date', admin: { description: 'When the sandbox stops unless extended by a heartbeat.' } },
    { name: 'lastActiveAt', type: 'date' },
    { name: 'readyAt', type: 'date' },
    { name: 'endedAt', type: 'date' },
  ],
}
