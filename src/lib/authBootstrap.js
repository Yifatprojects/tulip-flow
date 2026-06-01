/** Runs before React/Supabase — send recovery links to /reset-password with tokens intact. */
const RESET_PATH = '/reset-password'

export function hasRecoveryParamsInUrl() {
  if (typeof window === 'undefined') return false
  const combined = `${window.location.search}${window.location.hash}`
  return (
    /(?:^|[?&#])code=/.test(combined) ||
    /access_token=/.test(combined) ||
    /token_hash=/.test(combined) ||
    /type=recovery/.test(combined) ||
    /(?:^|[?&#])error=/.test(combined)
  )
}

export function isOnResetPasswordPath() {
  if (typeof window === 'undefined') return false
  const path = window.location.pathname
  return path === RESET_PATH || path.endsWith(RESET_PATH)
}

/** Full navigation so hash/query survive before any auth client runs. */
export function redirectToResetPasswordIfNeeded() {
  if (typeof window === 'undefined') return
  if (isOnResetPasswordPath()) return
  if (!hasRecoveryParamsInUrl()) return
  const { search, hash } = window.location
  window.location.replace(`${window.location.origin}${RESET_PATH}${search}${hash}`)
}

if (typeof window !== 'undefined') {
  redirectToResetPasswordIfNeeded()
}
