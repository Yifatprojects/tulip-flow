import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from './lib/supabaseClient';

function getMfaEnrollOptions(): { factorType: 'totp'; friendlyName: string; issuer: string } {
  const raw =
    (import.meta as ImportMeta & { env: Record<string, string | undefined> }).env.VITE_MFA_ISSUER ||
    (typeof window !== 'undefined' ? window.location.hostname : '') ||
    'TULIP-Flow';

  const issuer = raw.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/\s+/g, '-');

  return {
    factorType: 'totp',
    friendlyName: `TULIP Flow (${issuer})`,
    issuer,
  };
}

async function initializeMfa(): Promise<{ qrCode: string | null; factorId: string }> {
  const { data: factors, error: listError } = await supabase.auth.mfa.listFactors();
  if (listError) throw listError;

  const totpFactors = factors?.totp ?? [];
  const verified = totpFactors.filter((f) => f.status === 'verified');
  const unverified = totpFactors.filter((f) => f.status !== 'verified');

  if (verified.length > 0) {
    return { qrCode: null, factorId: verified[0].id };
  }

  for (const factor of unverified) {
    await supabase.auth.mfa.unenroll({ factorId: factor.id });
  }

  const { data, error: enrollError } = await supabase.auth.mfa.enroll(getMfaEnrollOptions());
  if (enrollError) throw enrollError;

  return { qrCode: data.totp.qr_code, factorId: data.id };
}

function QrCodeDisplay({ qrCode }: { qrCode: string }) {
  const isDataUri = qrCode.startsWith('data:');

  return (
    <div className="flex flex-col items-center mb-6">
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-5 shadow-sm">
        {isDataUri ? (
          <img src={qrCode} alt="Authenticator QR code" className="h-48 w-48 object-contain" />
        ) : (
          <div
            className="flex h-48 w-48 items-center justify-center [&>svg]:h-full [&>svg]:w-full"
            dangerouslySetInnerHTML={{ __html: qrCode }}
          />
        )}
      </div>
      <p className="mt-3 text-sm text-gray-500 text-center">
        Scan this with your authenticator app
      </p>
    </div>
  );
}

export default function MFAComponent({ onVerified }) {
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(true);
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
      const message = err?.message || 'Could not start MFA setup. Please try again.';
      setError(message);
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

  const verifyMFA = async () => {
    if (!factorId || !code.trim()) return;
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

      const target = window.location.pathname + window.location.search + window.location.hash;
      window.history.replaceState(null, '', target || '/');

      if (onVerified) await onVerified();
    } catch (err) {
      setError(
        err.message === 'Invalid TOTP code entered'
          ? 'Wrong code. Make sure your phone clock is synced and try again.'
          : err.message || 'Verification failed. Please try again.'
      );
    }
  };

  if (loading) {
    return (
      <div className="p-6 border border-gray-200 rounded-xl shadow-lg bg-white text-center">
        <p className="text-sm text-gray-500">Loading...</p>
      </div>
    );
  }

  return (
    <div className="p-6 border border-gray-200 rounded-xl shadow-lg bg-white">
      <h2 className="text-xl font-bold mb-6 text-gray-800 text-center">Two-Factor Authentication</h2>

      {qrCode && <QrCodeDisplay qrCode={qrCode} />}

      {!qrCode && !error && (
        <p className="text-sm text-gray-600 mb-4 text-center">
          {existingFactor
            ? 'MFA is already set up for this account. Enter the code from your authenticator app (including any localhost entry).'
            : 'Enter the code from your authenticator app'}
        </p>
      )}

      <input
        value={code}
        onChange={(e) => setCode(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && verifyMFA()}
        placeholder="000000"
        maxLength={6}
        className="w-full border border-gray-300 p-3 rounded-lg text-center tracking-widest text-2xl font-mono mb-3"
        autoFocus
      />

      {error && (
        <p className="mb-3 text-sm text-red-600 text-center">{error}</p>
      )}

      <button
        onClick={verifyMFA}
        disabled={!factorId || code.trim().length < 6}
        className="w-full bg-[#4B4594] text-white p-3 rounded-lg hover:bg-[#5E54A8] transition disabled:opacity-50 font-semibold mb-2"
      >
        Verify and Enter
      </button>

      {(error || (!qrCode && !existingFactor)) && (
        <button
          type="button"
          onClick={() => void loadMfa()}
          className="w-full text-sm text-[#4B4594] underline hover:text-[#5E54A8]"
        >
          Show QR code again
        </button>
      )}
    </div>
  );
}
