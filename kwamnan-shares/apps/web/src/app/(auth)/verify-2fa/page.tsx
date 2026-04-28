'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import toast from 'react-hot-toast'
import { Shield, Smartphone, QrCode, Copy, CheckCircle2 } from 'lucide-react'
import { authApi } from '@/lib/api'
import { useAuthStore } from '@/lib/store'
import Image from 'next/image'

export default function Setup2FAPage() {
  const router = useRouter()
  const { token, user } = useAuthStore()
  const [step, setStep] = useState<'choose' | 'totp-scan' | 'totp-verify' | 'done'>('choose')
  const [totpData, setTotpData] = useState<{ factor_id: string; qr_code: string; secret: string } | null>(null)
  const [challengeId, setChallengeId] = useState('')
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  const enrollTotp = async () => {
    if (!token) return
    setLoading(true)
    try {
      const res = await authApi.enrollTotp(token)
      setTotpData(res)
      // Create challenge immediately
      const challenge = await authApi.challengeTotp(res.factor_id, token)
      setChallengeId(challenge.challenge_id)
      setStep('totp-scan')
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to setup TOTP'
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }

  const verifyTotp = async () => {
    if (!token || !totpData || code.length !== 6) return
    setLoading(true)
    try {
      await authApi.verifyTotp(totpData.factor_id, challengeId, code, token)
      setStep('done')
      toast.success('Google Authenticator setup complete!')
    } catch {
      toast.error('Invalid code. Check your authenticator app.')
    } finally {
      setLoading(false)
    }
  }

  const copySecret = () => {
    if (totpData?.secret) {
      navigator.clipboard.writeText(totpData.secret)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <div className="min-h-screen bg-brand-cream flex items-center justify-center p-6">
      <div className="w-full max-w-lg">
        <div className="flex items-center gap-2 mb-8 justify-center">
          <div className="w-8 h-8 bg-brand-green-900 rounded-lg flex items-center justify-center">
            <span className="text-brand-gold-500 font-bold text-sm">K</span>
          </div>
          <span className="font-bold text-brand-green-900">KWAMNAN RURAL BANK</span>
        </div>

        {step === 'choose' && (
          <div className="card">
            <div className="text-center mb-6">
              <div className="w-16 h-16 bg-brand-green-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <Shield size={32} className="text-brand-green-900" />
              </div>
              <h1 className="text-2xl font-serif font-bold text-brand-green-900 mb-2">Secure Your Account</h1>
              <p className="text-gray-500 text-sm">
                Add two-factor authentication to protect your investments. Choose your preferred method:
              </p>
            </div>

            <div className="space-y-3 mb-6">
              <button
                onClick={enrollTotp}
                disabled={loading}
                className="w-full flex items-center gap-4 p-4 border-2 border-brand-green-900 rounded-xl hover:bg-brand-green-50 transition-all group"
              >
                <div className="w-12 h-12 bg-brand-green-100 rounded-xl flex items-center justify-center group-hover:bg-brand-green-900 transition-colors">
                  <Smartphone size={22} className="text-brand-green-900 group-hover:text-white transition-colors" />
                </div>
                <div className="text-left">
                  <p className="font-semibold text-brand-charcoal">Google Authenticator</p>
                  <p className="text-gray-500 text-xs">Scan QR code — works offline, most secure</p>
                </div>
                <span className="ml-auto badge-success text-xs">Recommended</span>
              </button>

              <button className="w-full flex items-center gap-4 p-4 border border-gray-200 rounded-xl hover:border-gray-300 transition-all opacity-60 cursor-not-allowed">
                <div className="w-12 h-12 bg-gray-100 rounded-xl flex items-center justify-center">
                  <Smartphone size={22} className="text-gray-400" />
                </div>
                <div className="text-left">
                  <p className="font-semibold text-gray-500">SMS One-Time Password</p>
                  <p className="text-gray-400 text-xs">Receive codes via SMS to {user?.phone} — coming soon</p>
                </div>
              </button>
            </div>

            <button onClick={() => router.push('/dashboard')} className="w-full text-center text-sm text-gray-400 hover:text-gray-600">
              Skip for now (not recommended)
            </button>
          </div>
        )}

        {step === 'totp-scan' && totpData && (
          <div className="card">
            <div className="flex items-center gap-3 mb-6">
              <QrCode size={24} className="text-brand-green-900" />
              <div>
                <h2 className="font-bold text-brand-green-900">Scan QR Code</h2>
                <p className="text-gray-500 text-sm">Open Google Authenticator and scan this code</p>
              </div>
            </div>

            <div className="flex justify-center mb-4">
              <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-sm"
                dangerouslySetInnerHTML={{ __html: totpData.qr_code || '' }}
              />
            </div>

            <div className="bg-gray-50 rounded-xl p-3 flex items-center justify-between mb-6">
              <div>
                <p className="text-xs text-gray-500 mb-1">Manual entry code (if QR doesn't scan)</p>
                <p className="font-mono text-sm text-brand-charcoal break-all">{totpData.secret}</p>
              </div>
              <button onClick={copySecret} className="ml-3 p-2 text-brand-green-900 hover:bg-brand-green-50 rounded-lg transition-colors">
                {copied ? <CheckCircle2 size={16} className="text-green-600" /> : <Copy size={16} />}
              </button>
            </div>

            <p className="text-center text-gray-500 text-sm mb-4">After scanning, enter the 6-digit code shown in your app:</p>

            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              placeholder="000000"
              className="input-field text-center text-3xl tracking-[0.5em] font-mono mb-4"
              autoFocus
            />

            <button
              onClick={verifyTotp}
              disabled={code.length !== 6 || loading}
              className="btn-primary w-full"
            >
              {loading ? 'Verifying...' : 'Verify & Activate 2FA'}
            </button>
          </div>
        )}

        {step === 'done' && (
          <div className="card text-center py-10">
            <div className="w-20 h-20 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 size={40} className="text-green-600" />
            </div>
            <h2 className="text-2xl font-serif font-bold text-brand-green-900 mb-2">2FA Activated!</h2>
            <p className="text-gray-500 text-sm mb-6">
              Your account is now protected with Google Authenticator. You'll need your authenticator code every time you log in.
            </p>
            <button onClick={() => router.push('/dashboard')} className="btn-primary w-full">
              Go to Dashboard
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
