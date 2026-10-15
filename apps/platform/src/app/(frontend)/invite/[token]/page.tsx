import { redirect } from 'next/navigation'
import { getPayload } from 'payload'

import { acceptInvite, MIN_PASSWORD_LENGTH, previewInvite } from '@/lib/invites'
import config from '@payload-config'

const ERRORS: Record<string, string> = {
  name_required: 'Please enter your name.',
  password_too_short: `Use a password of at least ${MIN_PASSWORD_LENGTH} characters.`,
}

type Props = {
  params: Promise<{ token: string }>
  searchParams: Promise<{ error?: string; done?: string }>
}

export default async function InvitePage({ params, searchParams }: Props) {
  const { token } = await params
  const { error, done } = await searchParams
  const payload = await getPayload({ config })

  if (done) {
    return (
      <div className="card">
        <h1>You're in</h1>
        <p className="muted">Open the Sitekick app and sign in with your email to get started.</p>
      </div>
    )
  }

  const invite = await previewInvite(payload, token)
  if (!invite) {
    return (
      <div className="card">
        <h1>Invite not found</h1>
        <p className="muted">This invite has expired or was already used. Ask your Sitekick contact for a new one.</p>
      </div>
    )
  }

  async function accept(formData: FormData) {
    'use server'
    const name = formData.get('name')
    const password = formData.get('password')
    const result = await acceptInvite(await getPayload({ config }), {
      token,
      ...(typeof name === 'string' ? { name } : {}),
      ...(typeof password === 'string' ? { password } : {}),
    })
    redirect(result.ok ? `/invite/${token}?done=1` : `/invite/${token}?error=${result.error}`)
  }

  return (
    <div className="card">
      <h1>Join {invite.organizationName}</h1>
      <p className="muted">
        Invited as <strong>{invite.email}</strong> ({invite.role})
      </p>
      {error && <p className="error">{ERRORS[error] ?? 'Something went wrong. Try again.'}</p>}
      <form action={accept}>
        {!invite.userExists && (
          <>
            <label>
              Your name
              <input name="name" autoComplete="name" required />
            </label>
            <label>
              Choose a password
              <input name="password" type="password" autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} required />
            </label>
          </>
        )}
        <button type="submit">{invite.userExists ? 'Accept invite' : 'Create account'}</button>
      </form>
    </div>
  )
}
