import { supabase } from './supabaseClient'

const EXPIRED_MSG = 'This reset link is invalid or has expired. Please request a new one from the login page.'

let establishPromise = null

export function isPasswordRecoveryFromUrl() {
  if (typeof window === 'undefined') return false
  const tokens = parseRecoveryTokensFromUrl()
  return Boolean(tokens.code || tokens.accessToken || tokens.type === 'recovery')
}

export function isResetPasswordRoute() {
  if (typeof window === 'undefined') return false
  return window.location.pathname === '/reset-password' || window.location.pathname.endsWith('/reset-password')
}

export function parseRecoveryTokensFromUrl() {
  if (typeof window === 'undefined') {
    return { code: null, accessToken: null, refreshToken: null, type: null }
  }
  const searchParams = new URLSearchParams(window.location.search)
  const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash
  const hashParams = new URLSearchParams(hash)
  return {
    code: searchParams.get('code'),
    accessToken: hashParams.get('access_token'),
    refreshToken: hashParams.get('refresh_token'),
    type: hashParams.get('type') || searchParams.get('type'),
  }
}

function cleanRecoveryUrl() {
  if (typeof window === 'undefined') return
  window.history.replaceState(null, '', window.location.pathname || '/reset-password')
}

export async function verifyRecoverySession() {
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) {
    await supabase.auth.signOut({ scope: 'local' })
    return { ok: false, message: EXPIRED_MSG }
  }
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) {
    return { ok: false, message: EXPIRED_MSG }
  }
  return { ok: true, session }
}

function waitForRecoverySession(timeoutMs = 12000) {
  return new Promise((resolve) => {
    let settled = false

    const finish = async (ok) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      subscription.unsubscribe()
      if (ok) {
        const verified = await verifyRecoverySession()
        resolve(verified)
      } else {
        resolve({ ok: false, message: EXPIRED_MSG })
      }
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (session && (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN' || event === 'INITIAL_SESSION')) {
        void finish(true)
      }
    })

    const timer = setTimeout(() => { void finish(false) }, timeoutMs)

    void (async () => {
      await new Promise((r) => setTimeout(r, 100))
      const verified = await verifyRecoverySession()
      if (verified.ok) void finish(true)
    })()
  })
}

async function establishRecoverySessionOnce() {
  const tokens = parseRecoveryTokensFromUrl()
  const hasUrlCredentials = Boolean(tokens.code || tokens.accessToken)

  if (tokens.accessToken && tokens.refreshToken) {
    const { error } = await supabase.auth.setSession({
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
    })
    if (error) {
      await supabase.auth.signOut({ scope: 'local' })
      return { ok: false, message: EXPIRED_MSG }
    }
    cleanRecoveryUrl()
    return verifyRecoverySession()
  }

  if (tokens.code) {
    const { error } = await supabase.auth.exchangeCodeForSession(tokens.code)
    if (error) {
      await supabase.auth.signOut({ scope: 'local' })
      return { ok: false, message: EXPIRED_MSG }
    }
    cleanRecoveryUrl()
    return verifyRecoverySession()
  }

  if (hasUrlCredentials || tokens.type === 'recovery') {
    const waited = await waitForRecoverySession()
    if (waited.ok) cleanRecoveryUrl()
    return waited
  }

  const verified = await verifyRecoverySession()
  if (verified.ok) {
    return verified
  }

  await supabase.auth.signOut({ scope: 'local' })
  return { ok: false, message: EXPIRED_MSG }
}

/** Single-flight: avoids StrictMode double-mount clearing the hash before session is stored. */
export function establishRecoverySession() {
  if (!establishPromise) {
    establishPromise = establishRecoverySessionOnce().finally(() => {
      establishPromise = null
    })
  }
  return establishPromise
}
