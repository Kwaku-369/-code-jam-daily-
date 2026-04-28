'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import toast from 'react-hot-toast'
import { Eye, EyeOff, Lock, Mail, ShieldCheck } from 'lucide-react'
import { authApi } from '@/lib/api'
import { useAuthStore } from '@/lib/store'
import { motion } from 'framer-motion'

const loginSchema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(1, 'Password required'),
})

type LoginForm = z.infer<typeof loginSchema>

export default function LoginPage() {
  const router = useRouter()
  const setAuth = useAuthStore((s) => s.setAuth)
  const [showPass, setShowPass] = useState(false)
  const [loading, setLoading] = useState(false)
  const [pendingTotp, setPendingTotp] = useState<{
    factor_id: string; token: string; user: Parameters<typeof setAuth>[0]; refreshToken: string
  } | null>(null)
  const [totpCode, setTotpCode] = useState('')

  const { register, handleSubmit, formState: { errors } } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
  })

  const onSubmit = async (data: LoginForm) => {
    setLoading(true)
    try {
      const res = await authApi.login(data.email, data.password)

      if (res.requires_2fa) {
        // Need TOTP verification
        setPendingTotp({
          factor_id: '', // Will be fetched
          token: res.access_token,
          user: res.user,
          refreshToken: res.refresh_token,
        })
        toast('Enter your authenticator code to complete login', { icon: '🔐' })
        setLoading(false)
        return
      }

      setAuth(res.user, res.access_token, res.refresh_token)
      toast.success(`Welcome back, ${res.user.full_name?.split(' ')[0]}!`)
      router.push(res.user.role === 'investor' ? '/dashboard' : '/admin')
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Login failed'
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }

  const submitTotp = async () => {
    if (!pendingTotp || totpCode.length !== 6) return
    setLoading(true)
    try {
      // Get factors list to get factor_id
      const { createClient } = await import('@/lib/supabase')
      const supabase = createClient()

      // Set the session first
      await supabase.auth.setSession({
        access_token: pendingTotp.token,
        refresh_token: pendingTotp.refreshToken,
      })

      const { data: factors } = await supabase.auth.mfa.listFactors()
      const totpFactor = factors?.totp?.[0]

      if (!totpFactor) {
        toast.error('Authenticator not set up')
        setLoading(false)
        return
      }

      const { data: challenge } = await supabase.auth.mfa.challenge({ factorId: totpFactor.id })
      const { error } = await supabase.auth.mfa.verify({
        factorId: totpFactor.id,
        challengeId: challenge!.id,
        code: totpCode,
      })

      if (error) {
        toast.error('Invalid code. Check your authenticator app.')
        setLoading(false)
        return
      }

      setAuth(pendingTotp.user, pendingTotp.token, pendingTotp.refreshToken)
      toast.success('Logged in securely!')
      router.push(pendingTotp.user.role === 'investor' ? '/dashboard' : '/admin')
    } catch {
      toast.error('Verification failed. Try again.')
    } finally {
      setLoading(false)
    }
  }

  // TOTP entry screen
  if (pendingTotp) {
    return (
      <AuthLayout title="Two-Factor Verification" subtitle="Enter the 6-digit code from your authenticator app">
        <div className="text-center mb-6">
          <div className="w-16 h-16 bg-brand-green-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <ShieldCheck size={32} className="text-brand-green-900" />
          </div>
          <p className="text-gray-600 text-sm">
            Open Google Authenticator or your 2FA app and enter the current code.
          </p>
        </div>

        <div className="mb-6">
          <input
            type="text"
            inputMode="numeric"
            maxLength={6}
            placeholder="000000"
            value={totpCode}
            onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ''))}
            className="input-field text-center text-3xl tracking-[0.5em] font-mono"
            autoFocus
          />
          <p className="text-center text-xs text-gray-400 mt-2">Code refreshes every 30 seconds</p>
        </div>

        <button
          onClick={submitTotp}
          disabled={totpCode.length !== 6 || loading}
          className="btn-primary w-full"
        >
          {loading ? 'Verifying...' : 'Verify & Login'}
        </button>

        <button
          onClick={() => setPendingTotp(null)}
          className="w-full text-center text-sm text-gray-500 mt-4 hover:text-gray-700"
        >
          ← Back to login
        </button>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout title="Welcome Back" subtitle="Sign in to your Kwamnan shares account">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Email Address</label>
          <div className="relative">
            <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              {...register('email')}
              type="email"
              placeholder="you@example.com"
              className="input-field pl-9"
              autoComplete="email"
            />
          </div>
          {errors.email && <p className="text-red-500 text-xs mt-1">{errors.email.message}</p>}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
          <div className="relative">
            <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              {...register('password')}
              type={showPass ? 'text' : 'password'}
              placeholder="••••••••"
              className="input-field pl-9 pr-10"
              autoComplete="current-password"
            />
            <button type="button" onClick={() => setShowPass(!showPass)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          {errors.password && <p className="text-red-500 text-xs mt-1">{errors.password.message}</p>}
        </div>

        <div className="text-right">
          <Link href="/forgot-password" className="text-sm text-brand-green-900 hover:underline">
            Forgot password?
          </Link>
        </div>

        <button type="submit" disabled={loading} className="btn-primary w-full mt-2">
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Signing in...
            </span>
          ) : 'Sign In'}
        </button>
      </form>

      <p className="text-center text-sm text-gray-500 mt-6">
        Don't have an account?{' '}
        <Link href="/register" className="text-brand-green-900 font-medium hover:underline">
          Create one free
        </Link>
      </p>
    </AuthLayout>
  )
}

// Shared auth layout component
function AuthLayout({ title, subtitle, children }: {
  title: string; subtitle: string; children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-brand-cream flex">
      {/* Left: Branding panel */}
      <div className="hidden lg:flex lg:w-1/2 bg-hero-gradient flex-col justify-between p-12 relative overflow-hidden">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-20 right-20 w-64 h-64 rounded-full bg-brand-gold-500 blur-3xl" />
          <div className="absolute bottom-20 left-10 w-40 h-40 rounded-full bg-white blur-2xl" />
        </div>

        <div className="relative flex items-center gap-3">
          <div className="w-10 h-10 bg-white/10 rounded-xl flex items-center justify-center">
            <span className="text-brand-gold-400 font-bold text-lg">K</span>
          </div>
          <div>
            <div className="font-bold text-white text-sm">KWAMNAN RURAL BANK</div>
            <div className="text-brand-gold-400 text-xs">Share Investment Portal</div>
          </div>
        </div>

        <div className="relative">
          <p className="text-brand-gold-400 text-sm font-medium mb-2 uppercase tracking-wider">Our Promise</p>
          <blockquote className="text-white text-2xl font-serif leading-relaxed">
            "Growing communities, one share at a time."
          </blockquote>
          <p className="text-white/60 text-sm mt-4">
            Since 1992, Kwamnan Rural Bank has empowered Ghanaian families to build lasting wealth through community investment.
          </p>
        </div>

        <div className="relative flex gap-6 text-center">
          {[['4,700+', 'Investors'], ['GHS 12M+', 'Invested'], ['15%', 'Max Dividend']].map(([v, l]) => (
            <div key={l}>
              <p className="text-white font-bold text-xl">{v}</p>
              <p className="text-white/50 text-xs">{l}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Right: Form */}
      <div className="w-full lg:w-1/2 flex items-center justify-center px-6 py-12">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md"
        >
          <div className="lg:hidden flex items-center gap-2 mb-8">
            <div className="w-8 h-8 bg-brand-green-900 rounded-lg flex items-center justify-center">
              <span className="text-brand-gold-500 font-bold text-sm">K</span>
            </div>
            <span className="font-bold text-brand-green-900 text-sm">KWAMNAN RURAL BANK</span>
          </div>

          <h1 className="text-3xl font-serif font-bold text-brand-green-900 mb-1">{title}</h1>
          <p className="text-gray-500 mb-8 text-sm">{subtitle}</p>

          {children}

          <p className="text-center text-xs text-gray-400 mt-8">
            <ShieldCheck size={12} className="inline mr-1" />
            Secured with 256-bit SSL encryption
          </p>
        </motion.div>
      </div>
    </div>
  )
}
