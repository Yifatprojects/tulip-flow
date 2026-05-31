import React, { useState, useEffect } from 'react';
import { supabase } from './lib/supabaseClient';

function QrCodeDisplay({ qrCode }: { qrCode: string }) {
  const isDataUri = qrCode.startsWith('data:');

  return (
    <div className="flex flex-col items-center mb-6">
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-5 shadow-sm">
        {isDataUri ? (
          <img
            src={qrCode}
            alt="Authenticator QR code"
            className="h-48 w-48 object-contain"
          />
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
  const [qrCode, setQrCode] = useState(null);
  const [factorId, setFactorId] = useState(null);
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function init() {
      try {
        const { data, error: enrollError } = await supabase.auth.mfa.enroll({ factorType: 'totp' })

        if (!enrollError && data) {
          setQrCode(data.totp.qr_code)
          setFactorId(data.id)
          setLoading(false)
          return
        }

        const { data: factors, error: listError } = await supabase.auth.mfa.listFactors()
        if (listError) throw listError

        const allFactors = factors?.totp ?? []

        if (allFactors.length === 0) {
          throw new Error('Cannot enable MFA. Please sign out and sign in again.')
        }

        const verified = allFactors.find(f => f.status === 'verified')
        const factor = verified ?? allFactors[0]

        if (!verified) {
          await supabase.auth.mfa.unenroll({ factorId: factor.id })
          const { data: newData, error: newEnrollError } = await supabase.auth.mfa.enroll({ factorType: 'totp' })
          if (newEnrollError) throw newEnrollError
          setQrCode(newData.totp.qr_code)
          setFactorId(newData.id)
        } else {
          setFactorId(verified.id)
        }

      } catch (err) {
        setError('Error: ' + (err.message || 'Please sign out and sign in again.'))
      } finally {
        setLoading(false)
      }
    }
    void init()
  }, [])

  const verifyMFA = async () => {
    if (!factorId || !code.trim()) return
    setError(null)
    try {
      const { data: challengeData, error: challengeError } = await supabase.auth.mfa.challenge({ factorId })
      if (challengeError) throw challengeError

      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId,
        challengeId: challengeData.id,
        code: code.trim(),
      })
      if (verifyError) throw verifyError

      const { error: refreshError } = await supabase.auth.refreshSession()
      if (refreshError) throw refreshError

      const { data: aalData, error: aalError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
      if (aalError) throw aalError
      if (aalData.currentLevel !== 'aal2') {
        throw new Error('MFA verification did not complete. Please try again.')
      }

      // Replace history entry so the MFA setup screen cannot be reached via Back.
      const target = window.location.pathname + window.location.search + window.location.hash;
      window.history.replaceState(null, '', target || '/');

      if (onVerified) await onVerified()
    } catch (err) {
      setError(
        err.message === 'Invalid TOTP code entered'
          ? 'Wrong code. Make sure your phone clock is synced and try again.'
          : 'Error: ' + err.message
      )
    }
  }

  if (loading) {
    return (
      <div className="p-6 border border-gray-200 rounded-xl shadow-lg bg-white text-center">
        <p className="text-sm text-gray-500">Loading...</p>
      </div>
    )
  }

  return (
    <div className="p-6 border border-gray-200 rounded-xl shadow-lg bg-white">
      <h2 className="text-xl font-bold mb-6 text-gray-800 text-center">Two-Factor Authentication</h2>

      {qrCode && <QrCodeDisplay qrCode={qrCode} />}

      {!qrCode && (
        <p className="text-sm text-gray-600 mb-4 text-center">
          Enter the code from your authenticator app
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
        disabled={code.trim().length < 6}
        className="w-full bg-[#4B4594] text-white p-3 rounded-lg hover:bg-[#5E54A8] transition disabled:opacity-50 font-semibold"
      >
        Verify and Enter
      </button>
    </div>
  )
}