import type { Access, FieldAccess, PayloadRequest } from 'payload'

type MaybeUser = { id: number; kind?: string | null } | null | undefined

/** Sitekick staff see and manage every organization and site. */
export const isStaff = (user: MaybeUser): boolean => user?.kind === 'staff'

export const staffOnly: Access = ({ req: { user } }) => isStaff(user)

export const staffOnlyField: FieldAccess = ({ req: { user } }) => isStaff(user)

/** Staff see every record. Anyone else sees only their own user record. */
export const staffOrSelf: Access = ({ req: { user } }) => {
  if (!user) return false
  if (isStaff(user)) return true
  return { id: { equals: user.id } }
}

const ORG_IDS_KEY = 'sitekick:orgIds'

/**
 * IDs of the organizations the request's user is a member of. Cached on
 * req.context, so several access checks in one request share a single query.
 */
export async function memberOrgIds(req: PayloadRequest): Promise<number[]> {
  if (!req.user) return []
  const cached = req.context[ORG_IDS_KEY]
  if (Array.isArray(cached)) return cached as number[]

  const { docs } = await req.payload.find({
    collection: 'memberships',
    where: { user: { equals: req.user.id } },
    depth: 0,
    pagination: false,
    overrideAccess: true,
    req,
  })
  const ids = docs.map((m) => (typeof m.organization === 'object' ? m.organization.id : m.organization))
  req.context[ORG_IDS_KEY] = ids
  return ids
}
