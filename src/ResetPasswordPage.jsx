import { useState, useEffect } from 'react';
import { Eye, EyeOff, Loader2, Lock, ArrowLeft } from 'lucide-react';
import { supabase } from './lib/supabaseClient';
import { establishRecoverySession, clearRecoverySessionFlag, isRecoverySessionActive, cleanRecoveryUrl, mapPasswordUpdateError } from './lib/authRecovery';
import { validatePassword, passwordsMatch, PASSWORD_POLICY_MESSAGE } from './lib/passwordPolicy';
import tulipFlowBrand from './assets/tulip-flow-brand.png';

export function ResetPasswordPage({ onComplete }) {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [sessionLoading, setSessionLoading] = useState(true);

  useEffect(() => {
    supabase.auth.stopAutoRefresh()

    let active = true

    void establishRecoverySession().then((result) => {
      if (!active) return
      if (result.ok) {
        setSessionReady(true)
        setError(null)
      } else {
        setSessionReady(false)
        setError(result.message)
      }
      setSessionLoading(false)
    })

    return () => {
      active = false
      supabase.auth.startAutoRefresh()
    }
  }, [])

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);

    if (!sessionReady) {
      setError('Your reset session has expired. Please request a new link from the login page.');
      return;
    }

    const validation = validatePassword(password);
    if (!validation.valid) {
      setError(validation.message);
      return;
    }

    if (!passwordsMatch(password, confirmPassword)) {
      setError('Passwords do not match.');
      return;
    }

    setBusy(true);
    try {
      if (!isRecoverySessionActive()) {
        setSessionReady(false);
        throw new Error('Your reset session has expired. Please request a new link from the login page.');
      }

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setSessionReady(false);
        clearRecoverySessionFlag();
        throw new Error('Your reset session has expired. Please request a new link from the login page.');
      }

      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;

      clearRecoverySessionFlag();
      cleanRecoveryUrl();
      await supabase.auth.signOut();
      window.history.replaceState(null, '', '/');
      onComplete?.();
    } catch (err) {
      setError(mapPasswordUpdateError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative isolate flex min-h-dvh w-full flex-col overflow-hidden">
      <LoginBackdrop />
      <div className="relative z-[1] flex flex-1 flex-col items-center justify-center px-4 py-6 sm:py-8">
        <div className="w-full max-w-[400px] overflow-hidden rounded-[1.25rem] border border-white/60 bg-white shadow-[0_32px_80px_-16px_rgba(45,27,105,0.2)] backdrop-blur-[12px]">
          <div className="bg-white px-7 pt-6 sm:px-9 sm:pt-7">
            <div className="relative mx-auto flex w-full max-w-[280px] justify-center">
              <img src={tulipFlowBrand} alt="Tulip Flow" className="h-auto w-full object-contain sm:max-h-[120px]" decoding="async" />
            </div>
          </div>

          {sessionLoading ? (
            <div className="flex flex-col items-center gap-3 px-7 py-10 sm:px-9">
              <Loader2 className="h-6 w-6 animate-spin text-[#4B4594]" />
              <p className="text-sm text-[#8A7BAB]">Verifying reset link…</p>
            </div>
          ) : !sessionReady ? (
            <div className="space-y-4 px-7 pb-6 pt-3 sm:px-9 sm:pb-7">
              <p className="text-center text-sm text-red-600" role="alert">{error}</p>
              <button
                type="button"
                onClick={() => onComplete?.()}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#4B4594] py-2.5 text-sm font-semibold text-white"
              >
                <ArrowLeft className="h-4 w-4" aria-hidden />
                Back to sign in
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-3.5 px-7 pb-6 pt-3 sm:px-9 sm:pb-7">
              <div className="text-center">
                <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-[#F4F0FF]">
                  <Lock className="h-5 w-5 text-[#4B4594]" aria-hidden />
                </div>
                <h1 className="text-lg font-bold text-[#4B4594]">Set new password</h1>
                <p className="mt-1 text-xs text-[#8A7BAB]">
                  Choose a strong password for your account.
                </p>
              </div>

              <p className="rounded-lg bg-[#FAFAFE] px-3 py-2 text-[10px] leading-relaxed text-[#6A5B88] ring-1 ring-[rgba(74,20,140,0.1)]">
                {PASSWORD_POLICY_MESSAGE}
              </p>

              <div>
                <label htmlFor="rp-password" className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.16em] text-[#4A148C]">
                  New password
                </label>
                <div className="relative">
                  <input
                    id="rp-password"
                    type={showPass ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="new-password"
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

              <div>
                <label htmlFor="rp-confirm" className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.16em] text-[#4A148C]">
                  Confirm new password
                </label>
                <div className="relative">
                  <input
                    id="rp-confirm"
                    type={showConfirm ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    autoComplete="new-password"
                    className="w-full rounded-xl border border-[rgba(74,20,140,0.14)] bg-[#FAFAFE] px-4 py-[0.65rem] pr-10 text-sm text-[#2D1B69] outline-none transition"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirm((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8A7BAB]"
                    aria-label={showConfirm ? 'Hide password' : 'Show password'}
                  >
                    {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {error && (
                <p className="text-center text-xs text-red-600" role="alert">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={busy}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#4B4594] py-2.5 text-sm font-semibold text-white transition hover:bg-[#5a529f] disabled:opacity-60"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Update password'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

function LoginBackdrop() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      <div className="login-page__wash h-full w-full" />
      <div className="login-page__mist-a" />
      <div className="login-page__mist-b" />
      <div className="login-page__edge" />
    </div>
  );
}
