'use client'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import toast from 'react-hot-toast'
import { TrendingUp, Info, CheckCircle2, ExternalLink, Smartphone, CreditCard, ArrowRight, Shield } from 'lucide-react'
import { sharesApi, paymentsApi, type ShareClass } from '@/lib/api'
import { useAuthStore } from '@/lib/store'
import { motion, AnimatePresence } from 'framer-motion'

const purchaseSchema = z.object({
  share_class_id: z.string().min(1, 'Select a share class'),
  units: z.number().min(200, 'Minimum purchase is 200 units (GHS 200)').max(1000000),
  payment_channel: z.enum(['mtn_momo', 'vodafone_cash', 'airteltigo', 'visa', 'mastercard']),
  mobile_number: z.string().optional(),
})

type PurchaseForm = z.infer<typeof purchaseSchema>

const CHANNELS = [
  { id: 'mtn_momo', label: 'MTN MoMo', icon: '📱', color: 'bg-yellow-50 border-yellow-200', activeColor: 'bg-yellow-100 border-yellow-500' },
  { id: 'vodafone_cash', label: 'Telecel Cash', icon: '📱', color: 'bg-red-50 border-red-200', activeColor: 'bg-red-100 border-red-500' },
  { id: 'airteltigo', label: 'AirtelTigo', icon: '📱', color: 'bg-blue-50 border-blue-200', activeColor: 'bg-blue-100 border-blue-500' },
  { id: 'visa', label: 'Visa Card', icon: '💳', color: 'bg-indigo-50 border-indigo-200', activeColor: 'bg-indigo-100 border-indigo-500' },
  { id: 'mastercard', label: 'Mastercard', icon: '💳', color: 'bg-orange-50 border-orange-200', activeColor: 'bg-orange-100 border-orange-500' },
]

const STEPS = ['Choose Shares', 'Payment', 'Confirm']

export default function BuySharesPage() {
  const { token, user } = useAuthStore()
  const [step, setStep] = useState(1)
  const [shareClasses, setShareClasses] = useState<ShareClass[]>([])
  const [selectedClass, setSelectedClass] = useState<ShareClass | null>(null)
  const [txnResponse, setTxnResponse] = useState<Record<string, unknown> | null>(null)
  const [paymentResponse, setPaymentResponse] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(false)

  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm<PurchaseForm>({
    resolver: zodResolver(purchaseSchema),
    defaultValues: { units: 200, payment_channel: 'mtn_momo' },
  })

  const units = watch('units') || 200
  const channel = watch('payment_channel')
  const isMoMo = ['mtn_momo', 'vodafone_cash', 'airteltigo'].includes(channel)

  const grossAmount = selectedClass ? units * selectedClass.current_price : 0
  const processingFee = grossAmount < 200 ? grossAmount * 0.025 : Math.min(grossAmount * 0.0195, 100)
  const platformFee = grossAmount < 200 ? grossAmount * 0.015 : grossAmount * 0.005
  const vat = processingFee * 0.15
  const totalAmount = grossAmount + processingFee + platformFee + vat

  useEffect(() => {
    sharesApi.getClasses().then((r) => {
      setShareClasses(r.data)
      if (r.data.length > 0) {
        setSelectedClass(r.data[0])
        setValue('share_class_id', r.data[0].id)
      }
    })
  }, [setValue])

  const onSubmitPurchase = async (data: PurchaseForm) => {
    if (!token) return
    setLoading(true)
    try {
      const res = await sharesApi.purchase(data, token)
      setTxnResponse(res as unknown as Record<string, unknown>)
      setStep(2)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Purchase failed'
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }

  const onInitiatePayment = async () => {
    if (!token || !txnResponse) return
    setLoading(true)
    try {
      const mobileNumber = (document.getElementById('mobile_number') as HTMLInputElement)?.value
      const res = await paymentsApi.initiate({
        transaction_id: txnResponse.transaction_id as string,
        mobile_number: mobileNumber || undefined,
      }, token)
      setPaymentResponse(res as unknown as Record<string, unknown>)

      if (res.redirect_url) {
        window.location.href = res.redirect_url
      } else {
        setStep(3)
        toast.success('Payment initiated! Check your phone.')
        pollPaymentStatus(txnResponse.reference as string)
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Payment failed'
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }

  const pollPaymentStatus = (reference: string) => {
    const interval = setInterval(async () => {
      if (!token) return
      const res = await paymentsApi.verify(reference, token)
      if (res.status === 'completed') {
        clearInterval(interval)
        toast.success('Payment confirmed! 🎉 Awaiting bank approval.')
      } else if (res.status === 'failed') {
        clearInterval(interval)
        toast.error('Payment failed. Please try again.')
      }
    }, 5000)
    setTimeout(() => clearInterval(interval), 120000) // Stop polling after 2 min
  }

  if (step === 3) {
    return (
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="max-w-lg mx-auto">
        <div className="card text-center py-12">
          <div className="w-20 h-20 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-6">
            <CheckCircle2 size={40} className="text-green-600" />
          </div>
          <h2 className="text-2xl font-serif font-bold text-brand-green-900 mb-3">Payment Initiated!</h2>
          {isMoMo ? (
            <p className="text-gray-500 mb-6">
              Check your phone for an approval prompt from your mobile money provider.
              Once approved, your shares will be processed by the bank.
            </p>
          ) : (
            <p className="text-gray-500 mb-6">
              You've been redirected to the secure Paystack payment page.
              After payment, return here to track your shares.
            </p>
          )}
          <div className="bg-brand-cream rounded-xl p-4 mb-6 text-left space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Reference</span>
              <span className="font-mono text-xs font-medium">{txnResponse?.reference as string}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Amount</span>
              <span className="font-semibold text-brand-green-900">GHS {(txnResponse?.amount as number)?.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Units</span>
              <span className="font-semibold">{(txnResponse?.units as number)?.toLocaleString()} shares</span>
            </div>
          </div>
          <button onClick={() => setStep(1)} className="btn-outline w-full mb-3">Buy More Shares</button>
          <a href="/dashboard" className="text-brand-green-900 text-sm hover:underline">Return to Dashboard</a>
        </div>
      </motion.div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto">
      {/* Step indicator */}
      <div className="flex items-center justify-center gap-2 mb-8">
        {STEPS.map((s, i) => (
          <div key={s} className="flex items-center">
            <div className={`flex items-center gap-2 px-4 py-1.5 rounded-full text-sm font-medium transition-all
              ${step === i + 1 ? 'bg-brand-green-900 text-white' : step > i + 1 ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
              {step > i + 1 ? <CheckCircle2 size={14} /> : <span>{i + 1}</span>}
              {s}
            </div>
            {i < 2 && <div className={`w-8 h-0.5 mx-1 ${step > i + 1 ? 'bg-brand-green-900' : 'bg-gray-200'}`} />}
          </div>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {/* ── Step 1: Choose shares ───────────────────────── */}
        {step === 1 && (
          <motion.div key="step1" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
            <form onSubmit={handleSubmit(onSubmitPurchase)}>
              <div className="grid lg:grid-cols-3 gap-6">
                {/* Left: configuration */}
                <div className="lg:col-span-2 space-y-6">
                  {/* Share class selection */}
                  <div className="card">
                    <h2 className="font-semibold text-brand-charcoal mb-4">Select Share Type</h2>
                    <div className="space-y-3">
                      {shareClasses.map((sc) => (
                        <label
                          key={sc.id}
                          className={`flex items-start gap-4 p-4 rounded-xl border-2 cursor-pointer transition-all
                            ${selectedClass?.id === sc.id ? 'border-brand-green-900 bg-brand-green-50/30' : 'border-gray-200 hover:border-brand-green-200'}`}
                        >
                          <input
                            type="radio"
                            {...register('share_class_id')}
                            value={sc.id}
                            onChange={() => { setSelectedClass(sc); setValue('share_class_id', sc.id) }}
                            className="mt-1"
                          />
                          <div className="flex-1">
                            <div className="flex items-center justify-between">
                              <p className="font-semibold text-brand-charcoal">{sc.name}</p>
                              <span className="badge-success">{sc.dividend_rate}% p.a.</span>
                            </div>
                            <p className="text-gray-500 text-sm mt-1">{sc.description}</p>
                            <div className="flex gap-4 mt-2 text-xs text-gray-400">
                              <span>GHS {sc.current_price.toFixed(2)}/unit</span>
                              <span>{sc.investor_count.toLocaleString()} investors</span>
                              <span>Min {sc.minimum_units} units</span>
                            </div>
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* Units input */}
                  <div className="card">
                    <h2 className="font-semibold text-brand-charcoal mb-4">Number of Shares</h2>
                    <div className="mb-2">
                      <input
                        {...register('units', { valueAsNumber: true })}
                        type="number"
                        min={200}
                        step={100}
                        className="input-field text-xl font-bold text-center"
                        placeholder="200"
                      />
                      {errors.units && <p className="text-red-500 text-xs mt-1">{errors.units.message}</p>}
                    </div>
                    {/* Quick select buttons */}
                    <div className="flex gap-2 flex-wrap mt-3">
                      {[200, 500, 1000, 2000, 5000].map((n) => (
                        <button
                          key={n}
                          type="button"
                          onClick={() => setValue('units', n)}
                          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all
                            ${units === n ? 'bg-brand-green-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                        >
                          {n.toLocaleString()} <span className="text-xs opacity-60">= GHS {n}</span>
                        </button>
                      ))}
                    </div>
                    {units < 200 && (
                      <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-2">
                        <Info size={14} className="text-amber-600 mt-0.5 flex-shrink-0" />
                        <p className="text-amber-700 text-xs">
                          <strong>Minimum is 200 shares (GHS 200)</strong> — this ensures your investment grows meaningfully and qualifies for dividends.
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Payment channel */}
                  <div className="card">
                    <h2 className="font-semibold text-brand-charcoal mb-4">Payment Method</h2>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {CHANNELS.map((ch) => (
                        <label
                          key={ch.id}
                          className={`flex flex-col items-center gap-2 p-3 rounded-xl border-2 cursor-pointer transition-all
                            ${channel === ch.id ? ch.activeColor : ch.color + ' hover:opacity-80'}`}
                        >
                          <input type="radio" {...register('payment_channel')} value={ch.id} className="sr-only" />
                          <span className="text-2xl">{ch.icon}</span>
                          <span className="text-xs font-medium text-center">{ch.label}</span>
                        </label>
                      ))}
                    </div>

                    {isMoMo && (
                      <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="mt-4">
                        <label className="block text-sm font-medium text-gray-700 mb-1">Mobile Money Number</label>
                        <input
                          id="mobile_number"
                          type="tel"
                          placeholder="+233 XX XXX XXXX (leave blank to use registered number)"
                          className="input-field"
                        />
                        <p className="text-xs text-gray-400 mt-1">Leave blank to use your registered number: {user?.phone}</p>
                      </motion.div>
                    )}
                  </div>
                </div>

                {/* Right: Summary */}
                <div>
                  <div className="card sticky top-20">
                    <h2 className="font-semibold text-brand-charcoal mb-4">Order Summary</h2>
                    {selectedClass && (
                      <div className="space-y-3 text-sm">
                        <div className="flex justify-between">
                          <span className="text-gray-500">Share Class</span>
                          <span className="font-medium text-right text-xs max-w-[120px]">{selectedClass.name}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-500">Units</span>
                          <span className="font-medium">{units.toLocaleString()}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-500">Price/Unit</span>
                          <span className="font-medium">GHS {selectedClass.current_price.toFixed(2)}</span>
                        </div>
                        <div className="border-t border-gray-100 pt-3">
                          <div className="flex justify-between text-xs text-gray-400">
                            <span>Shares Cost</span>
                            <span>GHS {grossAmount.toFixed(2)}</span>
                          </div>
                          <div className="flex justify-between text-xs text-gray-400">
                            <span>Processing Fee</span>
                            <span>GHS {processingFee.toFixed(2)}</span>
                          </div>
                          <div className="flex justify-between text-xs text-gray-400">
                            <span>Platform Fee</span>
                            <span>GHS {platformFee.toFixed(2)}</span>
                          </div>
                          <div className="flex justify-between text-xs text-gray-400">
                            <span>VAT (15%)</span>
                            <span>GHS {vat.toFixed(2)}</span>
                          </div>
                        </div>
                        <div className="border-t border-gray-200 pt-3 flex justify-between items-center">
                          <span className="font-bold text-brand-charcoal">Total</span>
                          <span className="font-bold text-brand-green-900 text-lg">GHS {totalAmount.toFixed(2)}</span>
                        </div>

                        <div className="bg-brand-green-50 rounded-xl p-3 text-xs text-brand-green-900">
                          <p className="font-medium">💡 Expected Annual Dividend</p>
                          <p className="mt-1">GHS {(grossAmount * selectedClass.dividend_rate / 100).toFixed(2)} per year at {selectedClass.dividend_rate}%</p>
                        </div>
                      </div>
                    )}

                    <button
                      type="submit"
                      disabled={loading || units < 200}
                      className="btn-primary w-full mt-4 flex items-center justify-center gap-2"
                    >
                      {loading ? (
                        <span className="flex items-center gap-2">
                          <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                          Processing...
                        </span>
                      ) : (
                        <>Continue to Payment <ArrowRight size={16} /></>
                      )}
                    </button>

                    <div className="flex items-center justify-center gap-1 text-xs text-gray-400 mt-3">
                      <Shield size={11} /> Secured by Paystack & 256-bit SSL
                    </div>
                  </div>
                </div>
              </div>
            </form>
          </motion.div>
        )}

        {/* ── Step 2: Confirm & Pay ─────────────────────── */}
        {step === 2 && txnResponse && (
          <motion.div key="step2" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
            <div className="max-w-lg mx-auto card">
              <h2 className="text-xl font-serif font-bold text-brand-green-900 mb-6">Confirm Your Order</h2>
              <div className="bg-brand-cream rounded-xl p-4 space-y-3 mb-6">
                {Object.entries(txnResponse.breakdown as Record<string, string> || {}).map(([k, v]) => (
                  <div key={k} className="flex justify-between text-sm">
                    <span className="text-gray-500 capitalize">{k.replace(/_/g, ' ')}</span>
                    <span className="font-medium">{v}</span>
                  </div>
                ))}
              </div>
              {isMoMo && (
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-1">MoMo Number to Charge</label>
                  <input
                    id="mobile_number"
                    type="tel"
                    defaultValue={user?.phone}
                    placeholder="+233 XX XXX XXXX"
                    className="input-field"
                  />
                </div>
              )}
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-6 flex items-start gap-2">
                <Info size={14} className="text-amber-600 mt-0.5 flex-shrink-0" />
                <p className="text-amber-700 text-xs">
                  After payment, your shares will be reviewed and approved by bank officers (usually within 1 business day). You'll receive a certificate once approved.
                </p>
              </div>
              <button onClick={onInitiatePayment} disabled={loading} className="btn-gold w-full flex items-center justify-center gap-2">
                {loading ? 'Processing...' : (
                  isMoMo ? <><Smartphone size={18} />Pay with {CHANNELS.find(c => c.id === channel)?.label}</> :
                  <><CreditCard size={18} />Pay with Card <ExternalLink size={14} /></>
                )}
              </button>
              <button onClick={() => setStep(1)} className="w-full text-center text-sm text-gray-500 mt-3 hover:text-gray-700">
                ← Modify Order
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
