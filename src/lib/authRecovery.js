import { supabase } from './supabaseClient'

const EXPIRED_MSG =
  'This reset link is invalid or has expired. Request a new link from the login page — only the most recent email works.'

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
  if (parseAuthErrorFromUrl()) return false
  const tokens = parseRecoveryTokensFromUrl()
  return Boolean(tokens.code || tokens.accessToken || tokens.type === 'recovery')
}

export function isResetPasswordRoute() {
  if (typeof window === 'undefined') return false
  return window.location.pathname === '/reset-password' || window.location.pathname.endsWith('/reset-password')
}

export function parseRecoveryTokensFromUrl() {
  if (typeof window === 'undefined') {
    return { code: null, accessToken: null, refreshToken: null, type: null, error: null }
  }
  const searchParams = new URLSearchParams(window.location.search)
  const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash
  const hashParams = new URLSearchParams(hash)
  return {
    code: searchParams.get('code'),
    accessToken: hashParams.get('access_token'),
    refreshToken: hashParams.get('refresh_token'),
    type: hashParams.get('type') || searchParams.get('type'),
    error: hashParams.get('error'),
    errorCode: hashParams.get('error_code'),
    errorDescription: hashParams.get('error_description'),
  }
}

export function parseAuthErrorFromUrl() {
  if (typeof window === 'undefined') return null
  const { error, errorCode, errorDescription } = parseRecoveryTokensFromUrl()
  if (!error) return null

  if (errorCode === 'otp_expired') {
    return 'This password reset link has expired or was already used. Request a new link below — only the most recent email works.'
  }

  if (errorDescription) {
    try {
      return decodeURIComponent(errorDescription.replace(/\+/g, ' '))
    } catch {
      return errorDescription.replace(/\+/g, ' ')
    }
  }

  return 'Could not complete password reset. Please request a new link.'
}

export function clearAuthErrorFromUrl() {
  if (typeof window === 'undefined') return
  window.history.replaceState(null, '', window.location.pathname || '/')
}

export function cleanRecoveryUrl() {
  if (typeof window === 'undefined') return
  window.history.replaceState(null, '', window.location.pathname || '/reset-password')
}

function markRecoveryReady() {
  recoverySessionActive = true
  return { ok: true }
}

function authErrorMessage(error) {
  const msg = error?.message ?? ''
  if (/403|forbidden|not allowed/i.test(msg)) {
    return 'Password could not be updated (access denied). Request a fresh reset link and complete the form within a few minutes.'
  }
  if (/401|jwt|session|expired|invalid/i.test(msg)) {
    return EXPIRED_MSG
  }
  return msg || EXPIRED_MSG
}

function waitForPasswordRecoveryEvent(timeoutMs = 20000) {
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

    void supabase.auth.getSession()
  })
}

async function applyTokensFromUrl(tokens) {
  if (tokens.accessToken && tokens.refreshToken) {
    const { error } = await supabase.auth.setSession({
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
    })
    if (error) return { ok: false, message: authErrorMessage(error) }
    return markRecoveryReady()
  }

  if (tokens.code) {
    const { error } = await supabase.auth.exchangeCodeForSession(tokens.code)
    if (error) return { ok: false, message: authErrorMessage(error) }
    return markRecoveryReady()
  }

  return null
}

async function establishRecoverySessionOnce() {
  recoverySessionActive = false

  const linkError = parseAuthErrorFromUrl()
  if (linkError) {
    clearAuthErrorFromUrl()
    return { ok: false, message: linkError }
  }

  const tokens = parseRecoveryTokensFromUrl()
  const hasUrlCredentials = Boolean(tokens.code || tokens.accessToken)

  if (hasUrlCredentials) {
    const fromUrl = await applyTokensFromUrl(tokens)
    if (!fromUrl?.ok) return fromUrl

    const waited = await waitForPasswordRecoveryEvent(5000)
    if (waited.ok) return waited

    if (recoverySessionActive) return { ok: true }
    return { ok: false, message: EXPIRED_MSG }
  }

  if (tokens.type === 'recovery') {
    const waited = await waitForPasswordRecoveryEvent()
    if (waited.ok) return waited
    return { ok: false, message: EXPIRED_MSG }
  }

  return { ok: false, message: EXPIRED_MSG }
}

export function establishRecoverySession() {
  if (!establishPromise) {
    establishPromise = establishRecoverySessionOnce().finally(() => {
      establishPromise = null
    })
  }
  return establishPromise
}

export function mapPasswordUpdateError(error) {
  return authErrorMessage(error)
}
