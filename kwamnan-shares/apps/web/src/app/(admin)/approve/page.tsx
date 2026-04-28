'use client'
import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import toast from 'react-hot-toast'
import { CheckCircle2, XCircle, Shield, Clock, ChevronDown } from 'lucide-react'
import { adminApi, type ApprovalItem } from '@/lib/api'
import { useAuthStore } from '@/lib/store'

export default function ApprovalPage() {
  const { token } = useAuthStore()
  const [queue, setQueue] = useState<ApprovalItem[]>([])
  const [loading, setLoading] = useState(true)
  const [activeItem, setActiveItem] = useState<string | null>(null)
  const [totpCode, setTotpCode] = useState('')
  const [notes, setNotes] = useState('')
  const [rejectReason, setRejectReason] = useState('')
  const [action, setAction] = useState<'approve' | 'reject' | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!token) return
    adminApi.getApprovalQueue(token)
      .then((r) => setQueue(r.data))
      .catch(() => toast.error('Failed to load queue'))
      .finally(() => setLoading(false))
  }, [token])

  const handleAction = async (queueId: string, actionType: 'approve' | 'reject') => {
    if (!token || !totpCode || totpCode.length !== 6) {
      toast.error('Enter your 6-digit Google Authenticator code')
      return
    }

    if (actionType === 'reject' && !rejectReason.trim()) {
      toast.error('Rejection reason is required')
      return
    }

    setSubmitting(true)
    try {
      if (actionType === 'approve') {
        const res = await adminApi.approve(queueId, { totp_code: totpCode, notes }, token) as { message: string }
        toast.success(res.message)
      } else {
        const res = await adminApi.reject(queueId, { totp_code: totpCode, reason: rejectReason }, token) as { message: string }
        toast.success(res.message)
      }
      // Refresh queue
      const updated = await adminApi.getApprovalQueue(token)
      setQueue(updated.data)
      setActiveItem(null)
      setTotpCode('')
      setNotes('')
      setRejectReason('')
      setAction(null)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Action failed'
      toast.error(message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Pending Approvals</h1>
          <p className="text-gray-400 text-sm mt-1">
            Dual control required — two different officers must approve each transaction
          </p>
        </div>
        <div className="flex items-center gap-2 text-amber-400 bg-amber-900/20 px-3 py-2 rounded-xl text-sm border border-amber-500/30">
          <Clock size={14} />
          {queue.length} pending
        </div>
      </div>

      {/* Dual control explanation */}
      <div className="bg-blue-900/20 border border-blue-500/30 rounded-xl p-4 mb-6 flex items-start gap-3">
        <Shield size={18} className="text-blue-400 mt-0.5 flex-shrink-0" />
        <div>
          <p className="text-blue-300 font-medium text-sm">Dual Control Protocol</p>
          <p className="text-blue-400/80 text-xs mt-1">
            Each transaction requires approval from two different authorized officers. The first approver reviews and validates; a second officer independently confirms. Both must use Google Authenticator (TOTP) codes.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array(3).fill(0).map((_, i) => <div key={i} className="bg-gray-800 rounded-xl h-24 animate-pulse" />)}
        </div>
      ) : queue.length === 0 ? (
        <div className="text-center py-20 text-gray-500">
          <CheckCircle2 size={40} className="mx-auto mb-3 text-green-600" />
          <p className="font-medium">All clear — no pending approvals</p>
        </div>
      ) : (
        <div className="space-y-4">
          {queue.map((item) => {
            const txn = item.share_transactions
            const investor = txn?.profiles
            const isExpanded = activeItem === item.id
            const isFirstApproved = !!item.first_approved_at

            return (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden"
              >
                {/* Header */}
                <button
                  onClick={() => setActiveItem(isExpanded ? null : item.id)}
                  className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-750 transition-all"
                >
                  <div className="flex items-center gap-4">
                    <div>
                      <p className="text-white font-medium text-left">{investor?.full_name}</p>
                      <p className="text-gray-400 text-xs text-left">{investor?.investor_id} • {txn?.reference}</p>
                    </div>
                    <div className="text-left">
                      <p className="text-white font-bold">GHS {txn?.net_amount?.toLocaleString()}</p>
                      <p className="text-gray-400 text-xs">{txn?.units?.toLocaleString()} units of {txn?.share_classes?.name}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1">
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${isFirstApproved ? 'bg-green-600' : 'bg-gray-600'}`}>
                        {isFirstApproved ? '✓' : '1'}
                      </div>
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${item.second_approved_at ? 'bg-green-600' : 'bg-gray-600'}`}>
                        {item.second_approved_at ? '✓' : '2'}
                      </div>
                    </div>
                    <ChevronDown size={16} className={`text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                  </div>
                </button>

                {/* Expanded detail */}
                {isExpanded && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    className="border-t border-gray-700 px-5 py-4"
                  >
                    {/* Transaction details */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
                      {[
                        ['Investor', investor?.full_name],
                        ['ID', investor?.id || 'N/A'],
                        ['Phone', investor?.phone],
                        ['KYC', investor?.kyc_verified ? 'Verified ✓' : 'Pending ⚠️'],
                        ['Share Class', txn?.share_classes?.name],
                        ['Units', txn?.units?.toLocaleString()],
                        ['Amount', `GHS ${txn?.net_amount?.toLocaleString()}`],
                        ['Payment', txn?.payment_channel?.replace('_', ' ')],
                        ['Submitted', new Date(item.requested_at).toLocaleString()],
                      ].map(([k, v]) => (
                        <div key={k} className="bg-gray-750 rounded-lg p-2">
                          <p className="text-gray-500 text-xs">{k}</p>
                          <p className="text-white text-sm font-medium truncate">{v || 'N/A'}</p>
                        </div>
                      ))}
                    </div>

                    {isFirstApproved && (
                      <div className="bg-green-900/20 border border-green-500/30 rounded-xl p-3 mb-4 text-xs text-green-400">
                        ✓ First approval by officer on {new Date(item.first_approved_at!).toLocaleString()} — {item.first_approval_notes || 'No notes'}
                      </div>
                    )}

                    {/* TOTP input + actions */}
                    <div className="bg-gray-900 rounded-xl p-4">
                      <p className="text-gray-300 text-sm font-medium mb-3 flex items-center gap-2">
                        <Shield size={14} className="text-brand-gold-400" />
                        Enter Google Authenticator Code
                      </p>
                      <input
                        type="text"
                        inputMode="numeric"
                        maxLength={6}
                        placeholder="000000"
                        value={totpCode}
                        onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ''))}
                        className="bg-gray-800 border border-gray-600 rounded-xl px-4 py-3 text-white text-center text-2xl tracking-[0.5em] font-mono w-full mb-3 focus:outline-none focus:border-brand-gold-400"
                      />

                      {action === 'reject' && (
                        <textarea
                          placeholder="Reason for rejection (required)"
                          value={rejectReason}
                          onChange={(e) => setRejectReason(e.target.value)}
                          rows={2}
                          className="bg-gray-800 border border-gray-600 rounded-xl px-4 py-3 text-white w-full mb-3 focus:outline-none focus:border-red-400 resize-none text-sm"
                        />
                      )}

                      <textarea
                        placeholder="Notes (optional)"
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        rows={2}
                        className="bg-gray-800 border border-gray-600 rounded-xl px-4 py-3 text-white w-full mb-4 focus:outline-none focus:border-gray-500 resize-none text-sm"
                      />

                      <div className="flex gap-3">
                        <button
                          onClick={() => { setAction('approve'); handleAction(item.id, 'approve') }}
                          disabled={submitting || totpCode.length !== 6}
                          className="flex-1 flex items-center justify-center gap-2 bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white font-semibold py-3 rounded-xl transition-all"
                        >
                          <CheckCircle2 size={16} />
                          {isFirstApproved ? 'Final Approval' : 'First Approval'}
                        </button>
                        <button
                          onClick={() => { setAction('reject'); handleAction(item.id, 'reject') }}
                          disabled={submitting || totpCode.length !== 6}
                          className="flex-1 flex items-center justify-center gap-2 bg-red-600/80 hover:bg-red-600 disabled:opacity-50 text-white font-semibold py-3 rounded-xl transition-all"
                        >
                          <XCircle size={16} />
                          Reject
                        </button>
                      </div>
                    </div>
                  </motion.div>
                )}
              </motion.div>
            )
          })}
        </div>
      )}
    </div>
  )
}
