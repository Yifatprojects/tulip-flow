import { supabase } from './supabaseClient'

const EXPIRED_MSG =
  'This reset link is invalid or has expired. Request a new link from the login page — only the most recent email works.'

const RESET_PATH = '/reset-password'

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
  return Boolean(
    tokens.code ||
      tokens.accessToken ||
      (tokens.tokenHash && tokens.type === 'recovery') ||
      tokens.type === 'recovery',
  )
}

export function isResetPasswordRoute() {
  if (typeof window === 'undefined') return false
  const path = window.location.pathname
  return path === RESET_PATH || path.endsWith(RESET_PATH)
}

export function parseRecoveryTokensFromUrl() {
  if (typeof window === 'undefined') {
    return {
      code: null,
      accessToken: null,
      refreshToken: null,
      tokenHash: null,
      type: null,
      error: null,
    }
  }
  const searchParams = new URLSearchParams(window.location.search)
  const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash
  const hashParams = new URLSearchParams(hash)
  return {
    code: searchParams.get('code'),
    accessToken: hashParams.get('access_token'),
    refreshToken: hashParams.get('refresh_token'),
    tokenHash: searchParams.get('token_hash') || hashParams.get('token_hash'),
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
  window.history.replaceState(null, '', RESET_PATH)
}

export function cleanRecoveryUrl() {
  if (typeof window === 'undefined') return
  window.history.replaceState(null, '', RESET_PATH)
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

async function clearStaleLocalSession() {
  const { data: { session } } = await supabase.auth.getSession()
  if (session) {
    await supabase.auth.signOut({ scope: 'local' })
  }
}

async function verifyActiveSession() {
  const { data: { session }, error } = await supabase.auth.getSession()
  if (error || !session?.access_token) return false
  return true
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

  if (tokens.tokenHash && tokens.type === 'recovery') {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokens.tokenHash,
      type: 'recovery',
    })
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
  const hasUrlCredentials = Boolean(
    tokens.code || tokens.accessToken || (tokens.tokenHash && tokens.type === 'recovery'),
  )

  if (hasUrlCredentials) {
    await clearStaleLocalSession()
    const fromUrl = await applyTokensFromUrl(tokens)
    if (!fromUrl?.ok) return fromUrl

    cleanRecoveryUrl()

    const valid = await verifyActiveSession()
    if (!valid) return { ok: false, message: EXPIRED_MSG }
    return markRecoveryReady()
  }

  // Page refresh mid-flow: session may still be in storage from a valid link.
  if (isResetPasswordRoute()) {
    const valid = await verifyActiveSession()
    if (valid) return markRecoveryReady()
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
