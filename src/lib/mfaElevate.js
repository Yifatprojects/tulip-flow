import { supabase } from './supabaseClient'

export async function getPrimaryVerifiedTotpFactorId() {
  const { data, error } = await supabase.auth.mfa.listFactors()
  if (error) throw error
  const verified = (data?.totp ?? []).filter((f) => f.status === 'verified')
  return verified[0]?.id ?? null
}

export async function userHasVerifiedMfa() {
  return (await getPrimaryVerifiedTotpFactorId()) != null
}

export async function sessionIsAal2() {
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
  if (error) {
    if (/mfa|aal|factor/i.test(error.message ?? '')) return false
    throw error
  }
  return data.currentLevel === 'aal2'
}

/** Challenge TOTP and refresh session so updateUser(password) is allowed. */
export async function verifyTotpAndElevateToAal2(code, factorId) {
  const trimmed = code.trim()
  if (!trimmed || !factorId) {
    throw new Error('Enter the 6-digit code from your authenticator app.')
  }

  const { data: challengeData, error: challengeError } = await supabase.auth.mfa.challenge({ factorId })
  if (challengeError) throw challengeError

  const { error: verifyError } = await supabase.auth.mfa.verify({
    factorId,
    challengeId: challengeData.id,
    code: trimmed,
  })
  if (verifyError) throw verifyError

  const { error: refreshError } = await supabase.auth.refreshSession()
  if (refreshError) throw refreshError

  const { data: aalData, error: aalError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
  if (aalError) throw aalError
  if (aalData.currentLevel !== 'aal2') {
    throw new Error('MFA verification did not complete. Please try again.')
  }
}

export function formatMfaError(err) {
  const msg = err?.message ?? ''
  if (msg === 'Invalid TOTP code entered') {
    return 'Wrong code. Make sure your phone clock is synced and try again.'
  }
  if (/aal2|aal 2/i.test(msg)) {
    return 'Enter your authenticator code below, then set your new password.'
  }
  return msg || 'Verification failed. Please try again.'
}
