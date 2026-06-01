import { supabase } from './supabaseClient'

const EXPIRED_MSG =
  'This reset link is invalid or has expired. Request a new link from the login page — only the most recent email works.'

const RESET_PATH = '/reset-password'
const RECOVERY_FLAG_KEY = 'tulip_password_recovery_flow'
const SNAPSHOT_KEY = 'tulip_auth_recovery_snapshot'
const SNAPSHOT_TTL_MS = 15 * 60 * 1000

const NO_TOKEN_MSG =
  'This link opened without a reset token (the address bar should briefly show access_token or code in the URL). In Supabase, set Redirect URL to https://tulip-flow.vercel.app/reset-password and use a fresh reset email.'

let establishPromise = null
let cachedEstablishResult = null
let recoverySessionActive = false

export function isRecoverySessionActive() {
  return recoverySessionActive
}

export function clearRecoverySessionFlag() {
  recoverySessionActive = false
  try {
    sessionStorage.removeItem(RECOVERY_FLAG_KEY)
    sessionStorage.removeItem(SNAPSHOT_KEY)
  } catch {
    /* ignore */
  }
}

function urlHasAuthParams(search, hash) {
  const combined = `${search || ''}${hash || ''}`
  return (
    /(?:^|[?&#])code=/.test(combined) ||
    /access_token=/.test(combined) ||
    /token_hash=/.test(combined) ||
    /type=recovery/.test(combined) ||
    /(?:^|[?&#])error=/.test(combined)
  )
}

function readRecoverySnapshot() {
  try {
    const raw = sessionStorage.getItem(SNAPSHOT_KEY)
    if (!raw) return null
    const data = JSON.parse(raw)
    if (!data?.at || Date.now() - data.at > SNAPSHOT_TTL_MS) {
      sessionStorage.removeItem(SNAPSHOT_KEY)
      return null
    }
    return data
  } catch {
    return null
  }
}

function clearRecoverySnapshot() {
  try {
    sessionStorage.removeItem(SNAPSHOT_KEY)
  } catch {
    /* ignore */
  }
}

function getRecoveryUrlParts() {
  if (typeof window === 'undefined') {
    return { search: '', hash: '' }
  }
  let search = window.location.search
  let hash = window.location.hash
  const snap = readRecoverySnapshot()
  if (snap && !urlHasAuthParams(search, hash) && urlHasAuthParams(snap.search, snap.hash)) {
    search = snap.search
    hash = snap.hash
  }
  return { search, hash }
}

export function acknowledgePasswordRecovery() {
  recoverySessionActive = true
  markRecoveryFlowInTab()
}

function markRecoveryFlowInTab() {
  recoverySessionActive = true
  try {
    sessionStorage.setItem(RECOVERY_FLAG_KEY, String(Date.now()))
  } catch {
    /* ignore */
  }
}

function hasRecoveryFlowInTab() {
  try {
    return sessionStorage.getItem(RECOVERY_FLAG_KEY) != null
  } catch {
    return recoverySessionActive
  }
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
  const { search, hash: hashRaw } = getRecoveryUrlParts()
  const searchParams = new URLSearchParams(search)
  const hash = hashRaw.startsWith('#') ? hashRaw.slice(1) : hashRaw
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
  markRecoveryFlowInTab()
  return { ok: true }
}

function authErrorMessage(error) {
  const msg = error?.message ?? ''
  if (/weak|password|character|uppercase|lowercase|number|special/i.test(msg)) {
    return msg
  }
  if (/403|forbidden|not allowed/i.test(msg)) {
    return 'Password could not be updated (access denied). Request a fresh reset link and complete the form within a few minutes.'
  }
  if (/401|jwt|session|expired|invalid/i.test(msg)) {
    return EXPIRED_MSG
  }
  return msg || EXPIRED_MSG
}

async function clearStaleLocalSession() {
  await supabase.auth.signOut({ scope: 'local' })
}

async function verifyActiveSession() {
  const { data: { session }, error } = await supabase.auth.getSession()
  if (error || !session?.access_token) return false
  return true
}

function waitForPasswordRecoveryEvent(timeoutMs = 15000) {
  return new Promise((resolve) => {
    let settled = false

    const done = (ok) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      subscription.unsubscribe()
      resolve(ok ? markRecoveryReady() : { ok: false, message: EXPIRED_MSG })
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
  if (cachedEstablishResult) return cachedEstablishResult

  const linkError = parseAuthErrorFromUrl()
  if (linkError) {
    clearAuthErrorFromUrl()
    cachedEstablishResult = { ok: false, message: linkError }
    return cachedEstablishResult
  }

  const tokens = parseRecoveryTokensFromUrl()
  const hasUrlCredentials = Boolean(
    tokens.code || tokens.accessToken || (tokens.tokenHash && tokens.type === 'recovery'),
  )

  if (hasUrlCredentials) {
    await clearStaleLocalSession()

    const fromUrl = await applyTokensFromUrl(tokens)
    if (fromUrl && !fromUrl.ok) {
      cachedEstablishResult = fromUrl
      return cachedEstablishResult
    }
    if (!fromUrl?.ok) {
      const recovered = await waitForPasswordRecoveryEvent(8000)
      if (!recovered.ok) {
        cachedEstablishResult = recovered
        return cachedEstablishResult
      }
    }

    const valid = await verifyActiveSession()
    if (!valid) {
      cachedEstablishResult = { ok: false, message: EXPIRED_MSG }
      return cachedEstablishResult
    }

    markRecoveryFlowInTab()
    clearRecoverySnapshot()
    cleanRecoveryUrl()
    cachedEstablishResult = { ok: true }
    return cachedEstablishResult
  }

  if (isResetPasswordRoute() && readRecoverySnapshot()) {
    cachedEstablishResult = { ok: false, message: NO_TOKEN_MSG }
    return cachedEstablishResult
  }

  if (isResetPasswordRoute() && hasRecoveryFlowInTab()) {
    const valid = await verifyActiveSession()
    if (valid) {
      cachedEstablishResult = markRecoveryReady()
      return cachedEstablishResult
    }
    clearRecoverySessionFlag()
  }

  cachedEstablishResult = { ok: false, message: EXPIRED_MSG }
  return cachedEstablishResult
}

export function establishRecoverySession() {
  if (cachedEstablishResult) {
    return Promise.resolve(cachedEstablishResult)
  }
  if (!establishPromise) {
    establishPromise = establishRecoverySessionOnce().finally(() => {
      establishPromise = null
    })
  }
  return establishPromise
}

export async function ensureFreshRecoverySession() {
  const { data, error } = await supabase.auth.refreshSession()
  if (error || !data.session?.access_token) {
    throw new Error(EXPIRED_MSG)
  }
  return data.session
}

export function mapPasswordUpdateError(error) {
  return authErrorMessage(error)
}
