import type { Payload } from 'payload'

import { hashToken } from '../auth/tokens'

export const MIN_PASSWORD_LENGTH = 12

export type InvitePreview = {
  email: string
  organizationName: string
  role: string
  userExists: boolean
}

export type AcceptInviteInput = { token: string; name?: string; password?: string }

export type AcceptInviteResult =
  | { ok: true; email: string; organizationName: string }
  | { ok: false; error: 'invalid_or_expired' | 'name_required' | 'password_too_short' }

async function findOpenInvite(payload: Payload, token: string) {
  const { docs } = await payload.find({
    collection: 'invites',
    where: { tokenHash: { equals: hashToken(token) }, acceptedAt: { exists: false } },
    depth: 1,
    limit: 1,
    overrideAccess: true,
  })
  const invite = docs[0]
  if (!invite || !invite.expiresAt || new Date(invite.expiresAt) < new Date()) return null
  if (typeof invite.organization !== 'object') return null
  return { ...invite, organization: invite.organization }
}

async function findUserByEmail(payload: Payload, email: string) {
  const { docs } = await payload.find({
    collection: 'users',
    where: { email: { equals: email } },
    depth: 0,
    limit: 1,
    overrideAccess: true,
  })
  return docs[0] ?? null
}

export async function previewInvite(payload: Payload, token: string): Promise<InvitePreview | null> {
  const invite = await findOpenInvite(payload, token)
  if (!invite) return null
  return {
    email: invite.email,
    organizationName: invite.organization.name,
    role: invite.role,
    userExists: (await findUserByEmail(payload, invite.email)) !== null,
  }
}

/**
 * Accepts an invite. A new person sets their name and password here. An
 * existing account just gains the membership: whoever holds the emailed
 * token controls that inbox, which is what the invite vouches for.
 */
export async function acceptInvite(payload: Payload, input: AcceptInviteInput): Promise<AcceptInviteResult> {
  const invite = await findOpenInvite(payload, input.token)
  if (!invite) return { ok: false, error: 'invalid_or_expired' }

  let user = await findUserByEmail(payload, invite.email)
  if (!user) {
    const name = input.name?.trim()
    if (!name) return { ok: false, error: 'name_required' }
    if (!input.password || input.password.length < MIN_PASSWORD_LENGTH) return { ok: false, error: 'password_too_short' }
    user = await payload.create({
      collection: 'users',
      data: { email: invite.email, name, password: input.password, kind: 'client' },
      overrideAccess: true,
    })
  }

  const { totalDocs } = await payload.count({
    collection: 'memberships',
    where: { user: { equals: user.id }, organization: { equals: invite.organization.id } },
    overrideAccess: true,
  })
  if (totalDocs === 0) {
    await payload.create({
      collection: 'memberships',
      data: { user: user.id, organization: invite.organization.id, role: invite.role },
      overrideAccess: true,
    })
  }

  await payload.update({
    collection: 'invites',
    id: invite.id,
    data: { acceptedAt: new Date().toISOString() },
    overrideAccess: true,
  })

  return { ok: true, email: invite.email, organizationName: invite.organization.name }
}
