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
    const { data, error: authError } = await supabase.auth.signInWithPassword({ 
      email: em, 
      password: pw 
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

          <form onSubmit={handleSubmit} className="space-y-3.5 px-7 pb-6 pt-3 sm:px-9 sm:pb-7">
            <div>
              <label htmlFor="lp-email" className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.16em] text-[#4A148C]">Email</label>
              <input id="lp-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full rounded-xl border border-[rgba(74,20,140,0.14)] bg-[#FAFAFE] px-4 py-[0.65rem] text-sm text-[#2D1B69] outline-none transition" />
            </div>
            <div>
              <label htmlFor="lp-password" className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.16em] text-[#4A148C]">Password</label>
              <input id="lp-password" type={showPass ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} className="w-full rounded-xl border border-[rgba(74,20,140,0.14)] bg-[#FAFAFE] px-4 py-[0.65rem] pr-10 text-sm text-[#2D1B69] outline-none transition" />
            </div>
            
            {/* הודעת השגיאה - תקין ומומלץ שיהיה כאן */}
            {error && (
              <div className="text-red-600 text-xs text-center">{error}</div>
            )}

            <button type="submit" disabled={busy} className="w-full bg-[#4B4594] text-white py-2 rounded-xl text-sm font-semibold">
              {busy ? <Loader2 className="animate-spin h-4 w-4" /> : 'Sign in'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}