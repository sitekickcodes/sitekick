import type { CollectionConfig } from 'payload'

import { isStaff, memberOrgIds, staffOnly } from '../access'
import { checkSiteConnection } from '../lib/connections'

export const SKIP_CONNECTION_CHECK = 'sitekick:skipConnectionCheck'

/**
 * A client website: a GitHub repo deployed as a Vercel project. Every save
 * re-checks that the Sitekick GitHub App can push to the repo and that the
 * Vercel project deploys that same repo (src/lib/connections), recording the
 * outcome in `connection`. A failed check never blocks saving.
 */
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
  hooks: {
    beforeChange: [
      async ({ data, originalDoc, context }) => {
        if (context[SKIP_CONNECTION_CHECK]) return data
        const githubRepo = data.githubRepo ?? originalDoc?.githubRepo
        const vercelProjectId = data.vercelProjectId ?? originalDoc?.vercelProjectId
        const result = await checkSiteConnection({ githubRepo, vercelProjectId })
        const defaultBranch = data.defaultBranch ?? originalDoc?.defaultBranch
        const productionUrl = data.productionUrl ?? originalDoc?.productionUrl
        return {
          ...data,
          // Fill blanks from what GitHub and Vercel report; never overwrite.
          defaultBranch: defaultBranch || result.defaultBranch || undefined,
          productionUrl: productionUrl || result.productionUrl || undefined,
          connection: {
            status: result.status,
            message: result.message,
            checkedAt: result.status === 'unchecked' ? null : new Date().toISOString(),
            githubInstallationId: result.githubInstallationId,
            githubRepoId: result.githubRepoId,
            githubCanPush: result.githubCanPush,
            vercelProjectId: result.vercelProjectId,
            vercelProjectName: result.vercelProjectName,
          },
        }
      },
    ],
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
    {
      name: 'defaultBranch',
      type: 'text',
      admin: { description: 'Branch agents work from. Filled from GitHub when left blank.' },
    },
    {
      name: 'vercelProjectId',
      type: 'text',
      label: 'Vercel project',
      admin: { description: 'Project name or ID in the Sitekick Vercel team, for example yimby-website' },
    },
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
    {
      name: 'connection',
      type: 'group',
      admin: {
        position: 'sidebar',
        readOnly: true,
        description: 'Checked every time you save.',
      },
      fields: [
        {
          name: 'status',
          type: 'select',
          defaultValue: 'unchecked',
          options: [
            { label: 'Connected', value: 'ok' },
            { label: 'Needs attention', value: 'problem' },
            { label: 'Platform not configured', value: 'not_configured' },
            { label: 'Not checked', value: 'unchecked' },
          ],
        },
        { name: 'message', type: 'textarea' },
        { name: 'checkedAt', type: 'date', admin: { date: { pickerAppearance: 'dayAndTime' } } },
        { name: 'githubInstallationId', type: 'number' },
        { name: 'githubRepoId', type: 'number' },
        { name: 'githubCanPush', type: 'checkbox' },
        { name: 'vercelProjectId', type: 'text', label: 'Vercel project ID' },
        { name: 'vercelProjectName', type: 'text' },
      ],
    },
  ],
}
