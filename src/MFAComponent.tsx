import React, { useState, useEffect, useCallback } from 'react';
import { Loader2, Shield } from 'lucide-react';
import { supabase } from './lib/supabaseClient';
import { formatMfaError } from './lib/mfaElevate';
import tulipFlowBrand from './assets/tulip-flow-brand.png';

function getIssuer(): string {
  const raw =
    (import.meta as ImportMeta & { env: Record<string, string | undefined> }).env.VITE_MFA_ISSUER ||
    (typeof window !== 'undefined' ? window.location.hostname : '') ||
    'TULIP-Flow';

  return raw.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/\s+/g, '-');
}

function getMfaEnrollOptions(suffix = ''): { factorType: 'totp'; friendlyName: string; issuer: string } {
  const issuer = getIssuer();
  const friendlyName = suffix ? `TULIP Flow ${suffix}` : 'TULIP Flow';

  return { factorType: 'totp', friendlyName, issuer };
}

async function listTotpFactors() {
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) throw error;
  return data?.totp ?? [];
}

async function cleanupUnverifiedFactors() {
  const factors = await listTotpFactors();
  const unverified = factors.filter((f) => f.status !== 'verified');

  for (const factor of unverified) {
    const { error } = await supabase.auth.mfa.unenroll({ factorId: factor.id });
    if (error) throw new Error(`Could not reset MFA: ${error.message}`);
  }

  return unverified.length;
}

async function enrollTotpFactor(): Promise<{ qrCode: string; factorId: string }> {
  await cleanupUnverifiedFactors();

  let { data, error } = await supabase.auth.mfa.enroll(getMfaEnrollOptions());

  if (error && /friendly name|already exists/i.test(error.message)) {
    const suffix = Date.now().toString(36);
    ({ data, error } = await supabase.auth.mfa.enroll(getMfaEnrollOptions(suffix)));
  }

  if (error) throw error;

  return { qrCode: data.totp.qr_code, factorId: data.id };
}

async function initializeMfa(): Promise<{ qrCode: string | null; factorId: string }> {
  const totpFactors = await listTotpFactors();
  const verified = totpFactors.filter((f) => f.status === 'verified');

  if (verified.length > 0) {
    return { qrCode: null, factorId: verified[0].id };
  }

  const enrolled = await enrollTotpFactor();
  return { qrCode: enrolled.qrCode, factorId: enrolled.factorId };
}

function QrCodeDisplay({ qrCode }: { qrCode: string }) {
  const isDataUri = qrCode.startsWith('data:');

  return (
    <div className="flex flex-col items-center">
      <div className="rounded-xl border border-[rgba(74,20,140,0.14)] bg-[#FAFAFE] p-4 ring-1 ring-[rgba(74,20,140,0.08)]">
        {isDataUri ? (
          <img src={qrCode} alt="Authenticator QR code" className="h-40 w-40 object-contain sm:h-44 sm:w-44" />
        ) : (
          <div
            className="flex h-40 w-40 items-center justify-center sm:h-44 sm:w-44 [&>svg]:h-full [&>svg]:w-full"
            dangerouslySetInnerHTML={{ __html: qrCode }}
          />
        )}
      </div>
      <p className="mt-2 text-center text-[10px] leading-relaxed text-[#6A5B88]">
        Scan with your authenticator app, then enter the 6-digit code below.
      </p>
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

type MFAComponentProps = {
  onVerified?: () => void | Promise<void>;
  onSignOut?: () => void;
};

export default function MFAComponent({ onVerified, onSignOut }: MFAComponentProps) {
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existingFactor, setExistingFactor] = useState(false);

  const loadMfa = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await initializeMfa();
      setQrCode(result.qrCode);
      setFactorId(result.factorId);
      setExistingFactor(!result.qrCode);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start MFA setup. Please try again.');
      setQrCode(null);
      setFactorId(null);
      setExistingFactor(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadMfa();
  }, [loadMfa]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!factorId || code.trim().length < 6) {
      setError('Enter the 6-digit code from your authenticator app.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const { data: challengeData, error: challengeError } = await supabase.auth.mfa.challenge({ factorId });
      if (challengeError) throw challengeError;

      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId,
        challengeId: challengeData.id,
        code: code.trim(),
      });
      if (verifyError) throw verifyError;

      const { error: refreshError } = await supabase.auth.refreshSession();
      if (refreshError) throw refreshError;

      const { data: aalData, error: aalError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aalError) throw aalError;
      if (aalData.currentLevel !== 'aal2') {
        throw new Error('MFA verification did not complete. Please try again.');
      }

      if (onVerified) await onVerified();
    } catch (err) {
      setError(formatMfaError(err));
    } finally {
      setBusy(false);
    }
  }

  const subtitle = qrCode
    ? 'Set up two-factor authentication to secure your account.'
    : existingFactor
      ? 'Enter the code from your authenticator app to continue to the dashboard.'
      : 'Enter the code from your authenticator app.';

  return (
    <div className="relative isolate flex min-h-dvh w-full flex-col overflow-hidden">
      <LoginBackdrop />
      <div className="relative z-[1] flex flex-1 flex-col items-center justify-center px-4 py-6 sm:py-8">
        <div className="w-full max-w-[400px] overflow-hidden rounded-[1.25rem] border border-white/60 bg-white shadow-[0_32px_80px_-16px_rgba(45,27,105,0.2)] backdrop-blur-[12px]">
          <div className="bg-white px-7 pt-6 sm:px-9 sm:pt-7">
            <div className="relative mx-auto flex w-full max-w-[280px] justify-center">
              <img
                src={tulipFlowBrand}
                alt="Tulip Flow"
                className="h-auto w-full object-contain sm:max-h-[120px]"
                decoding="async"
              />
            </div>
          </div>

          {loading ? (
            <div className="flex flex-col items-center gap-3 px-7 py-10 sm:px-9">
              <Loader2 className="h-6 w-6 animate-spin text-[#4B4594]" />
              <p className="text-sm text-[#8A7BAB]">Preparing two-factor authentication…</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-3.5 px-7 pb-6 pt-3 sm:px-9 sm:pb-7">
              <div className="text-center">
                <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-[#F4F0FF]">
                  <Shield className="h-5 w-5 text-[#4B4594]" aria-hidden />
                </div>
                <h1 className="text-lg font-bold text-[#4B4594]">Two-factor authentication</h1>
                <p className="mt-1 text-xs text-[#8A7BAB]">{subtitle}</p>
              </div>

              {qrCode && <QrCodeDisplay qrCode={qrCode} />}

              <div>
                <label
                  htmlFor="mfa-code"
                  className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.16em] text-[#4A148C]"
                >
                  Authenticator code
                </label>
                <input
                  id="mfa-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="000000"
                  maxLength={6}
                  className="w-full rounded-xl border border-[rgba(74,20,140,0.14)] bg-[#FAFAFE] px-4 py-[0.65rem] text-center font-mono text-lg tracking-widest text-[#2D1B69] outline-none transition"
                  autoFocus
                />
              </div>

              {error && (
                <p className="text-center text-xs text-red-600" role="alert">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={busy || !factorId || code.trim().length < 6}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#4B4594] py-2.5 text-sm font-semibold text-white transition hover:bg-[#5a529f] disabled:opacity-60"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Verify and enter'}
              </button>

              {(error || !qrCode) && (
                <button
                  type="button"
                  onClick={() => void loadMfa()}
                  className="w-full text-center text-xs font-semibold text-[#4B4594] underline-offset-2 hover:underline"
                >
                  {qrCode ? 'Refresh QR code' : 'Show QR code again'}
                </button>
              )}

              {onSignOut && (
                <div className="pt-1 text-center">
                  <button
                    type="button"
                    onClick={onSignOut}
                    className="text-xs text-[#8A7BAB] underline-offset-2 hover:text-[#4B4594] hover:underline"
                  >
                    Sign out
                  </button>
                </div>
              )}
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
