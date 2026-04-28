'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import toast from 'react-hot-toast'
import { ChevronRight, ChevronLeft, CheckCircle2, User, Phone, CreditCard, ShieldCheck } from 'lucide-react'
import { authApi } from '@/lib/api'
import { motion, AnimatePresence } from 'framer-motion'

const step1Schema = z.object({
  full_name: z.string().min(2, 'Full name required').max(255),
  email: z.string().email('Valid email required'),
  phone: z.string().regex(/^(\+233|0)[0-9]{9}$/, 'Valid Ghana number: +233XXXXXXXXX or 0XXXXXXXXX'),
  date_of_birth: z.string().min(1, 'Date of birth required'),
  password: z.string().min(8, 'At least 8 characters'),
  confirm_password: z.string(),
}).refine((d) => d.password === d.confirm_password, {
  message: "Passwords don't match",
  path: ['confirm_password'],
})

const step2Schema = z.object({
  id_type: z.enum(['ghana_card', 'passport', 'voters_id', 'drivers_license']),
  id_number: z.string().min(4, 'ID number required'),
  address: z.string().min(10, 'Full address required'),
  region: z.string().min(1, 'Region required'),
})

const step3Schema = z.object({
  next_of_kin_name: z.string().min(2, 'Next of kin name required'),
  next_of_kin_phone: z.string().regex(/^(\+233|0)[0-9]{9}$/),
  next_of_kin_relation: z.string().min(1, 'Relation required'),
  agree_terms: z.boolean().refine((v) => v, 'You must accept the terms'),
})

type Step1 = z.infer<typeof step1Schema>
type Step2 = z.infer<typeof step2Schema>
type Step3 = z.infer<typeof step3Schema>

const STEPS_META = [
  { label: 'Personal Info', icon: User },
  { label: 'ID & Address', icon: CreditCard },
  { label: 'Next of Kin', icon: ShieldCheck },
]

const REGIONS = [
  'Ashanti', 'Brong-Ahafo', 'Central', 'Eastern', 'Greater Accra',
  'Northern', 'Upper East', 'Upper West', 'Volta', 'Western',
  'Savannah', 'Bono', 'Bono East', 'Ahafo', 'Oti', 'North East',
]

export default function RegisterPage() {
  const router = useRouter()
  const [step, setStep] = useState(1)
  const [loading, setLoading] = useState(false)
  const [formData, setFormData] = useState<Partial<Step1 & Step2 & Step3>>({})

  const form1 = useForm<Step1>({ resolver: zodResolver(step1Schema), defaultValues: formData as Step1 })
  const form2 = useForm<Step2>({ resolver: zodResolver(step2Schema), defaultValues: formData as Step2 })
  const form3 = useForm<Step3>({ resolver: zodResolver(step3Schema), defaultValues: formData as Step3 })

  const nextStep1 = form1.handleSubmit((data) => {
    setFormData((p) => ({ ...p, ...data }))
    setStep(2)
  })

  const nextStep2 = form2.handleSubmit((data) => {
    setFormData((p) => ({ ...p, ...data }))
    setStep(3)
  })

  const submitFinal = form3.handleSubmit(async (data) => {
    setLoading(true)
    const allData = { ...formData, ...data }
    const { confirm_password, agree_terms, ...payload } = allData as typeof allData & { confirm_password: string; agree_terms: boolean }

    // Normalize phone to +233 format
    const phone = (payload.phone || '').startsWith('0')
      ? '+233' + (payload.phone || '').slice(1)
      : (payload.phone || '')

    try {
      await authApi.register({ ...payload, phone })
      toast.success('Registration successful! Please check your email to verify.')
      setStep(4) // Success screen
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Registration failed'
      toast.error(message)
    } finally {
      setLoading(false)
    }
  })

  if (step === 4) {
    return (
      <div className="min-h-screen bg-brand-cream flex items-center justify-center p-6">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="card max-w-md w-full text-center py-12"
        >
          <div className="w-20 h-20 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-6">
            <CheckCircle2 size={40} className="text-green-600" />
          </div>
          <h2 className="text-2xl font-serif font-bold text-brand-green-900 mb-3">
            Account Created!
          </h2>
          <p className="text-gray-500 mb-6">
            We've sent a verification link to <strong>{formData.email}</strong>.
            Please verify your email, then complete your KYC to start investing.
          </p>
          <Link href="/login" className="btn-primary inline-block w-full">
            Go to Login
          </Link>
        </motion.div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-brand-cream flex items-center justify-center p-6">
      <div className="w-full max-w-lg">
        {/* Logo */}
        <div className="flex items-center gap-2 mb-8 justify-center">
          <div className="w-8 h-8 bg-brand-green-900 rounded-lg flex items-center justify-center">
            <span className="text-brand-gold-500 font-bold text-sm">K</span>
          </div>
          <span className="font-bold text-brand-green-900">KWAMNAN RURAL BANK</span>
        </div>

        {/* Progress */}
        <div className="flex items-center justify-center mb-8">
          {STEPS_META.map((s, i) => (
            <div key={s.label} className="flex items-center">
              <div className={`flex items-center gap-2 ${step > i + 1 ? 'text-brand-green-900' : step === i + 1 ? 'text-brand-green-900' : 'text-gray-400'}`}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-all ${step > i + 1 ? 'bg-brand-green-900 text-white' : step === i + 1 ? 'bg-brand-green-900 text-white' : 'bg-gray-200 text-gray-500'}`}>
                  {step > i + 1 ? <CheckCircle2 size={16} /> : i + 1}
                </div>
                <span className="text-xs font-medium hidden sm:block">{s.label}</span>
              </div>
              {i < STEPS_META.length - 1 && (
                <div className={`w-8 sm:w-16 h-0.5 mx-2 ${step > i + 1 ? 'bg-brand-green-900' : 'bg-gray-200'}`} />
              )}
            </div>
          ))}
        </div>

        <AnimatePresence mode="wait">
          {step === 1 && (
            <motion.div key="step1" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
              <div className="card">
                <h2 className="text-xl font-serif font-bold text-brand-green-900 mb-6">Personal Information</h2>
                <form onSubmit={nextStep1} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Full Name (as on ID)</label>
                    <input {...form1.register('full_name')} placeholder="Kwame Asante" className="input-field" />
                    {form1.formState.errors.full_name && <p className="text-red-500 text-xs mt-1">{form1.formState.errors.full_name.message}</p>}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                    <input {...form1.register('email')} type="email" placeholder="kwame@example.com" className="input-field" />
                    {form1.formState.errors.email && <p className="text-red-500 text-xs mt-1">{form1.formState.errors.email.message}</p>}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Ghana Phone Number</label>
                    <div className="relative">
                      <Phone size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input {...form1.register('phone')} placeholder="+233 XX XXX XXXX" className="input-field pl-9" />
                    </div>
                    {form1.formState.errors.phone && <p className="text-red-500 text-xs mt-1">{form1.formState.errors.phone.message}</p>}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Date of Birth</label>
                    <input {...form1.register('date_of_birth')} type="date" className="input-field" />
                    {form1.formState.errors.date_of_birth && <p className="text-red-500 text-xs mt-1">{form1.formState.errors.date_of_birth.message}</p>}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                    <input {...form1.register('password')} type="password" placeholder="Min 8 characters" className="input-field" />
                    {form1.formState.errors.password && <p className="text-red-500 text-xs mt-1">{form1.formState.errors.password.message}</p>}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Confirm Password</label>
                    <input {...form1.register('confirm_password')} type="password" placeholder="Repeat password" className="input-field" />
                    {form1.formState.errors.confirm_password && <p className="text-red-500 text-xs mt-1">{form1.formState.errors.confirm_password.message}</p>}
                  </div>
                  <button type="submit" className="btn-primary w-full flex items-center justify-center gap-2">
                    Continue <ChevronRight size={18} />
                  </button>
                </form>
              </div>
            </motion.div>
          )}

          {step === 2 && (
            <motion.div key="step2" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
              <div className="card">
                <h2 className="text-xl font-serif font-bold text-brand-green-900 mb-6">ID & Address Verification</h2>
                <form onSubmit={nextStep2} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">ID Type</label>
                    <select {...form2.register('id_type')} className="input-field">
                      <option value="">Select ID type</option>
                      <option value="ghana_card">Ghana Card (National ID)</option>
                      <option value="passport">Passport</option>
                      <option value="voters_id">Voter's ID</option>
                      <option value="drivers_license">Driver's License</option>
                    </select>
                    {form2.formState.errors.id_type && <p className="text-red-500 text-xs mt-1">{form2.formState.errors.id_type.message}</p>}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">ID Number</label>
                    <input {...form2.register('id_number')} placeholder="GHA-XXXXXXXXX-X" className="input-field" />
                    {form2.formState.errors.id_number && <p className="text-red-500 text-xs mt-1">{form2.formState.errors.id_number.message}</p>}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Region</label>
                    <select {...form2.register('region')} className="input-field">
                      <option value="">Select region</option>
                      {REGIONS.map((r) => <option key={r} value={r}>{r} Region</option>)}
                    </select>
                    {form2.formState.errors.region && <p className="text-red-500 text-xs mt-1">{form2.formState.errors.region.message}</p>}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Residential Address</label>
                    <textarea {...form2.register('address')} placeholder="House no., Street, Town/City" rows={3} className="input-field resize-none" />
                    {form2.formState.errors.address && <p className="text-red-500 text-xs mt-1">{form2.formState.errors.address.message}</p>}
                  </div>
                  <div className="flex gap-3">
                    <button type="button" onClick={() => setStep(1)} className="btn-outline flex-1 flex items-center justify-center gap-2">
                      <ChevronLeft size={18} /> Back
                    </button>
                    <button type="submit" className="btn-primary flex-1 flex items-center justify-center gap-2">
                      Continue <ChevronRight size={18} />
                    </button>
                  </div>
                </form>
              </div>
            </motion.div>
          )}

          {step === 3 && (
            <motion.div key="step3" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
              <div className="card">
                <h2 className="text-xl font-serif font-bold text-brand-green-900 mb-6">Next of Kin & Terms</h2>
                <form onSubmit={submitFinal} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Next of Kin Full Name</label>
                    <input {...form3.register('next_of_kin_name')} placeholder="Full name" className="input-field" />
                    {form3.formState.errors.next_of_kin_name && <p className="text-red-500 text-xs mt-1">{form3.formState.errors.next_of_kin_name.message}</p>}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Next of Kin Phone</label>
                    <input {...form3.register('next_of_kin_phone')} placeholder="+233 XX XXX XXXX" className="input-field" />
                    {form3.formState.errors.next_of_kin_phone && <p className="text-red-500 text-xs mt-1">{form3.formState.errors.next_of_kin_phone.message}</p>}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Relationship</label>
                    <select {...form3.register('next_of_kin_relation')} className="input-field">
                      <option value="">Select relationship</option>
                      {['Spouse', 'Child', 'Parent', 'Sibling', 'Other Relative', 'Friend'].map((r) => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </select>
                    {form3.formState.errors.next_of_kin_relation && <p className="text-red-500 text-xs mt-1">{form3.formState.errors.next_of_kin_relation.message}</p>}
                  </div>
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input {...form3.register('agree_terms')} type="checkbox" className="mt-1" />
                    <span className="text-sm text-gray-600">
                      I agree to the <a href="#" className="text-brand-green-900 underline">Terms & Conditions</a> and{' '}
                      <a href="#" className="text-brand-green-900 underline">Privacy Policy</a> of Kwamnan Rural Bank.
                    </span>
                  </label>
                  {form3.formState.errors.agree_terms && <p className="text-red-500 text-xs">{form3.formState.errors.agree_terms.message}</p>}
                  <div className="flex gap-3">
                    <button type="button" onClick={() => setStep(2)} className="btn-outline flex-1 flex items-center justify-center gap-2">
                      <ChevronLeft size={18} /> Back
                    </button>
                    <button type="submit" disabled={loading} className="btn-primary flex-1">
                      {loading ? 'Creating Account...' : 'Create Account'}
                    </button>
                  </div>
                </form>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <p className="text-center text-sm text-gray-500 mt-6">
          Already have an account?{' '}
          <Link href="/login" className="text-brand-green-900 font-medium hover:underline">Sign in</Link>
        </p>
      </div>
    </div>
  )
}
