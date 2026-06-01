import { useState, useEffect } from 'react'
import { ArrowLeft, Eye, EyeOff, Loader2 } from 'lucide-react'
import { supabase } from './lib/supabaseClient'
import { parseAuthErrorFromUrl, clearAuthErrorFromUrl } from './lib/authRecovery'
import tulipFlowBrand from './assets/tulip-flow-brand.png'

function getPasswordResetRedirectUrl() {
  const base = typeof window !== 'undefined' ? window.location.origin : ''
  return `${base}/reset-password`
}

export function LoginPage() {
  const [view, setView] = useState('login') // 'login' | 'forgot'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [forgotSent, setForgotSent] = useState(false)

  useEffect(() => {
    const linkError = parseAuthErrorFromUrl()
    if (linkError) {
      setError(linkError)
      setView('forgot')
      clearAuthErrorFromUrl()
    }
  }, [])

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    const em = email.trim()
    const pw = password

    if (!em || !pw) {
      setError('Please enter your email and password.')
      return
    }

    setBusy(true)
    const { data, error: authError } = await supabase.auth.signInWithPassword({
      email: em,
      password: pw,
    })

    setBusy(false)

    if (authError) {
      setError(authError.message === 'Invalid login credentials' ? 'Incorrect email or password.' : authError.message)
      return
    }

    if (data.user) {
      window.history.replaceState(null, '', '/dashboard')
    }
  }

  async function handleForgotSubmit(e) {
    e.preventDefault()
    setError(null)
    setForgotSent(false)
    const em = email.trim()

    if (!em) {
      setError('Please enter your email address.')
      return
    }

    setBusy(true)
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(em, {
      redirectTo: getPasswordResetRedirectUrl(),
    })
    setBusy(false)

    if (resetError) {
      setError(resetError.message)
      return
    }

    setForgotSent(true)
  }

  function openForgot() {
    setView('forgot')
    setError(null)
    setForgotSent(false)
    setPassword('')
  }

  function backToLogin() {
    setView('login')
    setError(null)
    setForgotSent(false)
  }

  return (
    <div className="relative isolate flex min-h-dvh w-full flex-col overflow-hidden">
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        <div className="login-page__wash h-full w-full" />
        <div className="login-page__mist-a" />
        <div className="login-page__mist-b" />
        <div className="login-page__edge" />
      </div>

      <div className="relative z-[1] flex flex-1 flex-col items-center justify-center gap-4 px-4 py-6 sm:py-8">
        <div className="w-full max-w-[400px] overflow-hidden rounded-[1.25rem] border border-white/60 bg-white shadow-[0_32px_80px_-16px_rgba(45,27,105,0.2)] backdrop-blur-[12px]">
          <div className="bg-white px-7 pt-6 sm:px-9 sm:pt-7">
            <div className="relative mx-auto flex w-full max-w-[360px] justify-center">
              <img src={tulipFlowBrand} alt="Tulip Flow" className="h-auto w-full object-contain sm:max-h-[180px]" decoding="async" />
            </div>
          </div>

          {view === 'login' ? (
            <form onSubmit={handleSubmit} className="space-y-3.5 px-7 pb-6 pt-3 sm:px-9 sm:pb-7">
              <div>
                <label htmlFor="lp-email" className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.16em] text-[#4A148C]">Email</label>
                <input
                  id="lp-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  className="w-full rounded-xl border border-[rgba(74,20,140,0.14)] bg-[#FAFAFE] px-4 py-[0.65rem] text-sm text-[#2D1B69] outline-none transition"
                />
              </div>
              <div>
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <label htmlFor="lp-password" className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#4A148C]">Password</label>
                  <button
                    type="button"
                    onClick={openForgot}
                    className="text-[11px] font-semibold text-[#4B4594] underline-offset-2 hover:underline"
                  >
                    Forgot password?
                  </button>
                </div>
                <div className="relative">
                  <input
                    id="lp-password"
                    type={showPass ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    className="w-full rounded-xl border border-[rgba(74,20,140,0.14)] bg-[#FAFAFE] px-4 py-[0.65rem] pr-10 text-sm text-[#2D1B69] outline-none transition"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPass((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8A7BAB]"
                    aria-label={showPass ? 'Hide password' : 'Show password'}
                  >
                    {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {error && (
                <div className="text-center text-xs text-red-600">{error}</div>
              )}

              <button
                type="submit"
                disabled={busy}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#4B4594] py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Sign in'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleForgotSubmit} className="space-y-3.5 px-7 pb-6 pt-3 sm:px-9 sm:pb-7">
              <button
                type="button"
                onClick={backToLogin}
                className="flex items-center gap-1 text-xs font-semibold text-[#7B52AB] hover:text-[#4A148C]"
              >
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
                Back to sign in
              </button>

              <div>
                <h2 className="text-base font-bold text-[#4B4594]">Reset your password</h2>
                <p className="mt-1 text-xs text-[#8A7BAB]">
                  Enter your email and we will send you a link to set a new password.
                </p>
              </div>

              <div>
                <label htmlFor="lp-forgot-email" className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.16em] text-[#4A148C]">Email</label>
                <input
                  id="lp-forgot-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  className="w-full rounded-xl border border-[rgba(74,20,140,0.14)] bg-[#FAFAFE] px-4 py-[0.65rem] text-sm text-[#2D1B69] outline-none transition"
                />
              </div>

              {forgotSent && (
                <p className="rounded-lg bg-green-50 px-3 py-2 text-center text-xs text-green-800 ring-1 ring-green-200">
                  If an account exists for this email, you will receive a reset link shortly. Check your inbox and spam folder.
                </p>
              )}

              {error && (
                <div className="text-center text-xs text-red-600">{error}</div>
              )}

              <button
                type="submit"
                disabled={busy}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#4B4594] py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Send reset link'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
