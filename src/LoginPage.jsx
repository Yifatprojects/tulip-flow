import { useState } from 'react'
import { Eye, EyeOff, Loader2, LogIn } from 'lucide-react'
import { supabase } from './lib/supabaseClient'
import tulipLogo from './assets/tulip-logo.png'

export function LoginPage() {
  const [email, setEmail]         = useState('')
  const [password, setPassword]   = useState('')
  const [showPass, setShowPass]   = useState(false)
  const [busy, setBusy]           = useState(false)
  const [error, setError]         = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    const em = email.trim()
    const pw = password

    if (!em || !pw) { setError('Please enter your email and password.'); return }

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
    // on success, onAuthStateChange in App.jsx picks up the session automatically
  }

  return (
    <div className="flex min-h-dvh w-full flex-col items-center justify-center bg-gradient-to-br from-[#F4EFFF] via-[#FFF8F0] to-[#EFF9F6] p-4 gap-5">
      {/* Card */}
      <div className="w-full max-w-sm rounded-2xl border border-[rgba(74,20,140,0.14)] bg-white shadow-[0_32px_72px_rgba(74,20,140,0.16)]">

        {/* Header */}
        <div className="flex flex-col items-center border-b border-[rgba(74,20,140,0.1)] px-8 pb-6 pt-8">
          <img src={tulipLogo} alt="Tulip logo" className="mb-4 h-14 w-14 rounded-xl object-contain shadow-[0_8px_20px_rgba(74,20,140,0.18)]" />
          <p className="flex items-baseline gap-2">
            <span className="font-['Montserrat',sans-serif] text-2xl font-extrabold tracking-[0.06em] text-[#4B4594]">
              TULIP
            </span>
            <span className="font-['Montserrat',sans-serif] text-2xl font-bold uppercase tracking-[0.1em] text-[#F9B233]">
              Flow
            </span>
          </p>
          <p className="mt-2 font-['Georgia',serif] text-[0.8rem] italic tracking-[0.18em] text-[#7B52AB]/70">
            <span className="font-extrabold not-italic text-[#7B52AB]">movie</span>ing in sync
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4 px-8 py-7">
          <div>
            <label htmlFor="lp-email" className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.16em] text-[#4A148C]">
              Email
            </label>
            <input
              id="lp-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@studio.com"
              className="w-full rounded-xl border border-[rgba(74,20,140,0.2)] bg-[#FAFAFE] px-4 py-2.5 text-sm text-[#4B4594] outline-none transition placeholder:text-[#B0A4CC] focus:border-[#4B4594] focus:bg-white focus:ring-2 focus:ring-[#4B4594]/20"
            />
          </div>

          <div>
            <label htmlFor="lp-password" className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.16em] text-[#4A148C]">
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
                className="w-full rounded-xl border border-[rgba(74,20,140,0.2)] bg-[#FAFAFE] px-4 py-2.5 pr-10 text-sm text-[#4B4594] outline-none transition placeholder:text-[#B0A4CC] focus:border-[#4B4594] focus:bg-white focus:ring-2 focus:ring-[#4B4594]/20"
              />
              <button
                type="button"
                onClick={() => setShowPass((v) => !v)}
                tabIndex={-1}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#9A8AB8] transition hover:text-[#4A148C]"
                aria-label={showPass ? 'Hide password' : 'Show password'}
              >
                {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-medium text-red-700" role="alert">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#4B4594] py-2.5 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(75,69,148,0.35)] transition hover:bg-[#5a529f] disabled:opacity-60"
          >
            {busy
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <LogIn className="h-4 w-4" />}
            {busy ? 'Signing in…' : 'Sign in'}
          </button>

          <p className="pt-1 text-center text-[11px] leading-relaxed text-[#8A7BAB]">
            Access is by invitation only.
            <br />Contact your administrator to get an account.
          </p>
        </form>
      </div>
      <p className="text-center text-[11px] text-[#B0A4CC]">
        Built with <span className="text-[#E61E6E]">❤️</span> by{' '}
        <span className="font-semibold text-[#4B4594]">Y.Tishler</span>
      </p>
    </div>
  )
}
