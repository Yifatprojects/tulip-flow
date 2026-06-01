import { supabase } from './supabaseClient'

const EXPIRED_MSG = 'This reset link is invalid or has expired. Please request a new one from the login page.'

let establishPromise = null
let recoverySessionActive = false

export function isRecoverySessionActive() {
  return recoverySessionActive
}

export function clearRecoverySessionFlag() {
  recoverySessionActive = false
}

export function acknowledgePasswordRecovery() {
  recoverySessionActive = true
}

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

function markRecoveryReady() {
  recoverySessionActive = true
  return { ok: true }
}

export async function verifyRecoverySession() {
  if (!recoverySessionActive) {
    return { ok: false, message: EXPIRED_MSG }
  }
  const { data: { session }, error } = await supabase.auth.getSession()
  if (error || !session) {
    recoverySessionActive = false
    return { ok: false, message: EXPIRED_MSG }
  }
  return { ok: true, session }
}

function waitForPasswordRecoveryEvent(timeoutMs = 15000) {
  return new Promise((resolve) => {
    let settled = false

    const done = (ok) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      subscription.unsubscribe()
      if (ok) resolve(markRecoveryReady())
      else resolve({ ok: false, message: EXPIRED_MSG })
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' && session) {
        done(true)
      }
    })

    const timer = setTimeout(() => done(false), timeoutMs)
  })
}

async function applyTokensFromUrl(tokens) {
  if (tokens.accessToken && tokens.refreshToken) {
    await supabase.auth.signOut({ scope: 'local' })
    const { error } = await supabase.auth.setSession({
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
    })
    if (error) return { ok: false, message: EXPIRED_MSG }
    markRecoveryReady()
    cleanRecoveryUrl()
    return { ok: true }
  }

  if (tokens.code) {
    await supabase.auth.signOut({ scope: 'local' })
    const { error } = await supabase.auth.exchangeCodeForSession(tokens.code)
    if (error) return { ok: false, message: EXPIRED_MSG }
    markRecoveryReady()
    cleanRecoveryUrl()
    return { ok: true }
  }

  return null
}

async function establishRecoverySessionOnce() {
  recoverySessionActive = false
  const tokens = parseRecoveryTokensFromUrl()
  const hasUrlCredentials = Boolean(tokens.code || tokens.accessToken)

  const fromUrl = await applyTokensFromUrl(tokens)
  if (fromUrl) return fromUrl

  if (hasUrlCredentials || tokens.type === 'recovery') {
    const waited = await waitForPasswordRecoveryEvent()
    if (waited.ok) cleanRecoveryUrl()
    return waited
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
