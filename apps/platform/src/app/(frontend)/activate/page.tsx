import { redirect } from 'next/navigation'
import { getPayload } from 'payload'

import { decideDeviceAuthorization, findPendingByUserCode, normalizeUserCode } from '@/lib/device'
import { getWebUser, signInWithPassword, signOutWeb } from '@/lib/web-session'
import config from '@payload-config'

const ERRORS: Record<string, string> = {
  invalid: 'That email and password don’t match.',
  locked: 'Too many attempts. Try again in 15 minutes.',
  code: 'That code isn’t valid or has expired. Check the code in the app and try again.',
}

type Props = { searchParams: Promise<{ code?: string; error?: string; done?: string }> }

const activateUrl = (code: string | undefined, error?: string) =>
  `/activate?${new URLSearchParams({ ...(code ? { code } : {}), ...(error ? { error } : {}) })}`

export default async function ActivatePage({ searchParams }: Props) {
  const { code: rawCode, error, done } = await searchParams
  const code = rawCode ? (normalizeUserCode(rawCode) ?? rawCode) : undefined

  if (done) {
    return (
      <div className="card">
        <h1>{done === 'approved' ? 'You’re signed in' : 'Sign-in denied'}</h1>
        <p className="muted">
          {done === 'approved' ? 'Head back to the Sitekick app. You can close this tab.' : 'The app was not signed in. You can close this tab.'}
        </p>
      </div>
    )
  }

  const user = await getWebUser()

  async function signIn(formData: FormData) {
    'use server'
    const result = await signInWithPassword(String(formData.get('email') ?? ''), String(formData.get('password') ?? ''))
    redirect(activateUrl(code, result === 'ok' ? undefined : result))
  }

  async function signOut() {
    'use server'
    await signOutWeb()
    redirect(activateUrl(code))
  }

  async function decide(formData: FormData) {
    'use server'
    const me = await getWebUser()
    if (!me || !code) redirect(activateUrl(code))
    const decision = formData.get('decision') === 'approve' ? 'approved' : 'denied'
    const ok = await decideDeviceAuthorization(await getPayload({ config }), code, me, decision)
    redirect(ok ? `/activate?done=${decision}` : activateUrl(code, 'code'))
  }

  if (!user) {
    return (
      <div className="card">
        <h1>Sign in to Sitekick</h1>
        {code && <p className="muted">To approve the app showing code <strong className="code">{code}</strong>.</p>}
        {error && ERRORS[error] && <p className="error">{ERRORS[error]}</p>}
        <form action={signIn}>
          <label>
            Email
            <input name="email" type="email" autoComplete="username" required />
          </label>
          <label>
            Password
            <input name="password" type="password" autoComplete="current-password" required />
          </label>
          <button type="submit">Sign in</button>
        </form>
      </div>
    )
  }

  const pending = code ? await findPendingByUserCode(await getPayload({ config }), code) : null

  return (
    <div className="card">
      {pending ? (
        <>
          <h1>Sign in the Sitekick app?</h1>
          <p className="muted">
            Check that this code matches the one shown in <strong>{pending.deviceName}</strong>:
          </p>
          <p className="code big">{pending.userCode}</p>
          <form action={decide} className="actions">
            <button type="submit" name="decision" value="approve">
              Approve
            </button>
            <button type="submit" name="decision" value="deny" className="secondary">
              Deny
            </button>
          </form>
        </>
      ) : (
        <>
          <h1>Enter the code from the app</h1>
          {(error === 'code' || code) && <p className="error">{ERRORS['code']}</p>}
          <form action="/activate" method="get">
            <label>
              Code
              <input name="code" placeholder="XXXX-XXXX" autoComplete="one-time-code" required />
            </label>
            <button type="submit">Continue</button>
          </form>
        </>
      )}
      <form action={signOut} className="signed-in">
        <span className="muted">Signed in as {user.email}.</span> <button type="submit" className="link">Not you?</button>
      </form>
    </div>
  )
}
