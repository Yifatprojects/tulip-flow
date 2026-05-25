import { useState } from 'react'
import { Eye, EyeOff, Loader2, LogIn } from 'lucide-react'
import { supabase } from './lib/supabaseClient'
import tulipFlowBrand from './assets/tulip-flow-brand.png'

export function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

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
    const { error: authError } = await supabase.auth.signInWithPassword({ email: em, password: pw })
    setBusy(false)

    if (authError) {
      setError(
        authError.message.includes('Invalid login')
          ? 'Incorrect email or password. Please try again.'
          : authError.message,
      )
    }
  }

  return (
    <div className="relative isolate flex min-h-dvh w-full flex-col overflow-hidden">
      {/* Backdrop — cool gray family matches the logo artboard; soft violet/gold haze only */}
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
              <img
                src={tulipFlowBrand}
                alt="Tulip Flow"
                className="h-auto w-full object-contain sm:max-h-[180px]"
                decoding="async"
              />
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-3.5 px-7 pb-6 pt-3 sm:px-9 sm:pb-7">
            <div>
              <label
                htmlFor="lp-email"
                className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.16em] text-[#4A148C]"
              >
                Email
              </label>
              <input
                id="lp-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@studio.com"
                className="w-full rounded-xl border border-[rgba(74,20,140,0.14)] bg-[#FAFAFE] px-4 py-[0.65rem] text-sm text-[#2D1B69] outline-none transition placeholder:text-[#ACA3C7] focus:border-[#6B57A8] focus:bg-white focus:ring-2 focus:ring-[#4B4594]/12"
              />
            </div>

            <div>
              <label
                htmlFor="lp-password"
                className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.16em] text-[#4A148C]"
              >
                Password
              </label>
              <div className="relative">
                <input
                  id="lp-password"
                  type={showPass ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full rounded-xl border border-[rgba(74,20,140,0.14)] bg-[#FAFAFE] px-4 py-[0.65rem] pr-10 text-sm text-[#2D1B69] outline-none transition placeholder:text-[#ACA3C7] focus:border-[#6B57A8] focus:bg-white focus:ring-2 focus:ring-[#4B4594]/12"
                />
                <button
                  type="button"
                  onClick={() => setShowPass((v) => !v)}
                  tabIndex={-1}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#A69BC4] transition hover:text-[#4A148C]"
                  aria-label={showPass ? 'Hide password' : 'Show password'}
                >
                  {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {error && (
              <div
                className="rounded-xl border border-red-100 bg-red-50/95 px-4 py-3 text-xs font-medium text-red-700"
                role="alert"
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#4B4594] py-[0.68rem] text-sm font-semibold text-white shadow-[0_10px_26px_-4px_rgba(75,69,148,0.42)] transition hover:bg-[#5E54A8] disabled:opacity-55"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
              {busy ? 'Signing in…' : 'Sign in'}
            </button>

            <p className="text-center text-[11px] leading-snug text-[#9186AD]">
              Access is by invitation only.
              <br />
              Contact your administrator for an account.
            </p>
          </form>
        </div>

        <p className="max-w-[400px] text-center text-[11px] text-[#9B94B0] drop-shadow-[0_1px_0_rgba(255,255,255,0.75)]">
          Built with <span className="text-[#E61E6E]">❤️</span> by{' '}
          <span className="font-semibold text-[#6B5CAE]">Y.Tishler</span>
        </p>
      </div>
    </div>
  )
}
