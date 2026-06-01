import { supabase } from './supabaseClient'

export function isPasswordRecoveryFromUrl() {
  if (typeof window === 'undefined') return false
  const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash
  const hashParams = new URLSearchParams(hash)
  const searchParams = new URLSearchParams(window.location.search)
  return (
    hashParams.get('type') === 'recovery' ||
    searchParams.get('type') === 'recovery' ||
    Boolean(searchParams.get('code')) ||
    Boolean(hashParams.get('access_token'))
  )
}

export function isResetPasswordRoute() {
  if (typeof window === 'undefined') return false
  return window.location.pathname === '/reset-password' || window.location.pathname.endsWith('/reset-password')
}

/**
 * Exchange PKCE code or parse hash tokens so updateUser has a valid recovery session.
 */
export async function establishRecoverySession() {
  const searchParams = new URLSearchParams(window.location.search)
  const code = searchParams.get('code')

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (error) {
      return { ok: false, message: 'This reset link is invalid or has expired. Please request a new one.' }
    }
    window.history.replaceState(null, '', window.location.pathname || '/reset-password')
  }

  const { data: { session }, error } = await supabase.auth.getSession()
  if (error) {
    return { ok: false, message: error.message }
  }
  if (!session) {
    return { ok: false, message: 'This reset link is invalid or has expired. Please request a new one.' }
  }

  return { ok: true, session }
}
