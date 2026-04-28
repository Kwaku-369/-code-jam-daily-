'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import toast from 'react-hot-toast'
import { CheckCircle2, ArrowRight, ChevronLeft } from 'lucide-react'
import { FaceCapture } from '@/components/kyc/FaceCapture'
import { IDScanner, type ExtractedIDData } from '@/components/kyc/IDScanner'
import { createClient } from '@/lib/supabase'
import { useAuthStore } from '@/lib/store'
import { motion, AnimatePresence } from 'framer-motion'

const STEPS = ['Face Photo', 'ID Document', 'Confirm']

export default function KYCPage() {
  const router = useRouter()
  const { user, token } = useAuthStore()
  const [step, setStep] = useState(0)
  const [faceBlob, setFaceBlob] = useState<Blob | null>(null)
  const [faceDataUrl, setFaceDataUrl] = useState<string | null>(null)
  const [idData, setIdData] = useState<ExtractedIDData | null>(null)
  const [idImageUrl, setIdImageUrl] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm({
    defaultValues: {
      full_name: user?.full_name || '',
      id_type: 'ghana_card',
      id_number: '',
      date_of_birth: '',
    },
  })

  // When OCR extracts data, pre-fill the form
  const handleIDExtract = (data: ExtractedIDData, imageUrl: string) => {
    setIdData(data)
    setIdImageUrl(imageUrl)
    if (data.full_name) setValue('full_name', data.full_name)
    if (data.id_number) setValue('id_number', data.id_number)
    if (data.date_of_birth) setValue('date_of_birth', data.date_of_birth)
  }

  const submitKYC = handleSubmit(async (formData) => {
    if (!faceBlob || !user?.id) {
      toast.error('Please complete all steps')
      return
    }

    setSubmitting(true)
    try {
      const supabase = createClient()

      // Upload face photo
      const facePath = `kyc/${user.id}/face.jpg`
      const { error: faceError } = await supabase.storage
        .from('kyc-documents')
        .upload(facePath, faceBlob, { contentType: 'image/jpeg', upsert: true })

      if (faceError) throw faceError

      // Update profile with KYC data
      const { error: profileError } = await supabase
        .from('profiles')
        .update({
          full_name: formData.full_name,
          id_type: formData.id_type,
          id_number: formData.id_number,
          date_of_birth: formData.date_of_birth || null,
          face_photo_url: facePath,
          kyc_submitted_at: new Date().toISOString(),
        })
        .eq('id', user.id)

      if (profileError) throw profileError

      toast.success('KYC submitted! Bank will verify within 1 business day.')
      router.push('/dashboard')
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'KYC submission failed'
      toast.error(message)
    } finally {
      setSubmitting(false)
    }
  })

  return (
    <div className="min-h-screen bg-brand-cream flex items-center justify-center p-6">
      <div className="w-full max-w-lg">
        {/* Logo */}
        <div className="flex items-center gap-2 mb-8 justify-center">
          <div className="w-8 h-8 bg-brand-green-900 rounded-lg flex items-center justify-center">
            <span className="text-brand-gold-500 font-bold text-sm">K</span>
          </div>
          <span className="font-bold text-brand-green-900">KYC Verification</span>
        </div>

        {/* Step indicator */}
        <div className="flex items-center justify-center gap-2 mb-8">
          {STEPS.map((s, i) => (
            <div key={s} className="flex items-center">
              <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-all
                ${step === i ? 'bg-brand-green-900 text-white' : step > i ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                {step > i ? <CheckCircle2 size={12} /> : <span>{i + 1}</span>}
                {s}
              </div>
              {i < 2 && <div className={`w-6 h-0.5 mx-1 ${step > i ? 'bg-brand-green-900' : 'bg-gray-200'}`} />}
            </div>
          ))}
        </div>

        <AnimatePresence mode="wait">
          {/* Step 0: Face photo */}
          {step === 0 && (
            <motion.div key="face" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
              <div className="card">
                <h2 className="text-xl font-serif font-bold text-brand-green-900 mb-2">Take Your Photo</h2>
                <p className="text-gray-500 text-sm mb-6">
                  This photo will appear on your share certificate. Please ensure good lighting and look directly at the camera.
                </p>
                <FaceCapture
                  label="Face photo (for certificate)"
                  onCapture={(blob, dataUrl) => {
                    setFaceBlob(blob)
                    setFaceDataUrl(dataUrl)
                  }}
                />
                <button
                  type="button"
                  onClick={() => { if (faceBlob) setStep(1); else toast.error('Please capture your photo first') }}
                  className="btn-primary w-full mt-6 flex items-center justify-center gap-2"
                >
                  Continue <ArrowRight size={16} />
                </button>
              </div>
            </motion.div>
          )}

          {/* Step 1: ID scan */}
          {step === 1 && (
            <motion.div key="id" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
              <div className="card">
                <h2 className="text-xl font-serif font-bold text-brand-green-900 mb-2">Scan Your ID</h2>
                <p className="text-gray-500 text-sm mb-6">
                  Upload a clear photo of your ID. We'll read the details automatically.
                </p>
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-1">ID Type</label>
                  <select {...register('id_type')} className="input-field">
                    <option value="ghana_card">Ghana Card (National ID)</option>
                    <option value="passport">Passport</option>
                    <option value="voters_id">Voter's ID</option>
                    <option value="drivers_license">Driver's License</option>
                  </select>
                </div>
                <IDScanner onExtract={handleIDExtract} />

                {idData && (
                  <div className="mt-4 space-y-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Full Name (verify/edit)</label>
                      <input {...register('full_name', { required: true })} className="input-field" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">ID Number (verify/edit)</label>
                      <input {...register('id_number', { required: true })} className="input-field" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Date of Birth</label>
                      <input {...register('date_of_birth')} type="date" className="input-field" />
                    </div>
                  </div>
                )}

                <div className="flex gap-3 mt-6">
                  <button type="button" onClick={() => setStep(0)} className="btn-outline flex items-center gap-2">
                    <ChevronLeft size={16} /> Back
                  </button>
                  <button
                    type="button"
                    onClick={() => { if (idData) setStep(2); else toast.error('Please scan your ID first') }}
                    className="btn-primary flex-1 flex items-center justify-center gap-2"
                  >
                    Continue <ArrowRight size={16} />
                  </button>
                </div>
              </div>
            </motion.div>
          )}

          {/* Step 2: Confirm */}
          {step === 2 && (
            <motion.div key="confirm" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
              <div className="card">
                <h2 className="text-xl font-serif font-bold text-brand-green-900 mb-6">Confirm Your Details</h2>

                {/* Face preview */}
                {faceDataUrl && (
                  <div className="flex items-center gap-4 mb-6 p-4 bg-brand-cream rounded-xl">
                    <img
                      src={faceDataUrl}
                      alt="Your photo"
                      className="w-20 h-20 rounded-xl object-cover scale-x-[-1] border-2 border-brand-gold-400"
                    />
                    <div>
                      <p className="font-semibold text-brand-charcoal">{watch('full_name')}</p>
                      <p className="text-gray-400 text-xs mt-1">Photo for certificate ✓</p>
                    </div>
                  </div>
                )}

                <div className="space-y-3 mb-6">
                  {[
                    ['ID Type', watch('id_type')?.replace('_', ' ')],
                    ['ID Number', watch('id_number')],
                    ['Date of Birth', watch('date_of_birth')],
                  ].filter(([, v]) => v).map(([k, v]) => (
                    <div key={k} className="flex justify-between text-sm border-b border-gray-100 pb-2">
                      <span className="text-gray-500">{k}</span>
                      <span className="font-medium text-brand-charcoal capitalize">{v}</span>
                    </div>
                  ))}
                </div>

                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-6 text-xs text-amber-700">
                  By submitting, you confirm that all information is accurate and belongs to you.
                  Providing false information is an offence under Ghanaian law.
                </div>

                <div className="flex gap-3">
                  <button type="button" onClick={() => setStep(1)} className="btn-outline flex items-center gap-2">
                    <ChevronLeft size={16} /> Edit
                  </button>
                  <button onClick={submitKYC} disabled={submitting} className="btn-primary flex-1">
                    {submitting ? 'Submitting...' : 'Submit KYC'}
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
