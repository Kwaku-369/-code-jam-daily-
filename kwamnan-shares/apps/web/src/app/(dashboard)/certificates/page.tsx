'use client'
import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import toast from 'react-hot-toast'
import { Award, Download, Eye, Clock, CheckCircle2 } from 'lucide-react'
import { sharesApi, type Holding } from '@/lib/api'
import { useAuthStore } from '@/lib/store'

export default function CertificatesPage() {
  const { token, user } = useAuthStore()
  const [holdings, setHoldings] = useState<Holding[]>([])
  const [loading, setLoading] = useState(true)
  const [downloading, setDownloading] = useState<string | null>(null)

  useEffect(() => {
    if (!token) return
    sharesApi.getPortfolio(token)
      .then((r) => setHoldings(r.data))
      .catch(() => toast.error('Failed to load certificates'))
      .finally(() => setLoading(false))
  }, [token])

  const handleDownload = async (holdingId: string, certNumber: string) => {
    if (!token) return
    setDownloading(holdingId)
    try {
      const { url } = await sharesApi.getCertificateUrl(holdingId, token)
      const a = document.createElement('a')
      a.href = url
      a.download = `${certNumber}.pdf`
      a.target = '_blank'
      a.click()
      toast.success('Certificate downloaded!')
    } catch {
      toast.error('Certificate not available yet. Contact support.')
    } finally {
      setDownloading(null)
    }
  }

  const hasCertificates = holdings.some((h) => h.certificate_url)

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-serif font-bold text-brand-green-900">Share Certificates</h1>
        <p className="text-gray-500 text-sm mt-1">
          Your official proof of share ownership — legally valid documents issued by Kwamnan Rural Bank.
        </p>
      </div>

      {loading ? (
        <div className="grid md:grid-cols-2 gap-4">
          {Array(2).fill(0).map((_, i) => <div key={i} className="skeleton h-48" />)}
        </div>
      ) : holdings.length === 0 ? (
        <div className="card text-center py-16">
          <Award size={48} className="mx-auto text-brand-green-100 mb-4" />
          <h2 className="font-serif font-bold text-brand-green-900 mb-2">No Certificates Yet</h2>
          <p className="text-gray-500 text-sm mb-6">Purchase shares to receive your official certificates.</p>
          <a href="/dashboard/shares" className="btn-primary inline-block">Buy Shares</a>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-6">
          {holdings.map((holding) => (
            <motion.div
              key={holding.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="certificate-preview relative overflow-hidden"
            >
              {/* Certificate header */}
              <div className="bg-brand-green-900 -mx-8 -mt-8 px-8 pt-8 pb-6 mb-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-brand-gold-400 text-xs font-medium uppercase tracking-wider">Certificate No.</p>
                    <p className="text-white font-mono font-bold">{holding.certificate_number}</p>
                  </div>
                  <div className="w-12 h-12 bg-brand-gold-500 rounded-xl flex items-center justify-center">
                    <span className="text-brand-green-900 font-bold text-xl">K</span>
                  </div>
                </div>
                <p className="text-white/60 text-xs mt-2">KWAMNAN RURAL BANK LIMITED</p>
              </div>

              {/* Holder info */}
              <p className="text-gray-400 text-xs uppercase tracking-wider mb-1">Certificate Holder</p>
              <p className="font-serif font-bold text-brand-green-900 text-xl mb-1">{user?.full_name}</p>
              <p className="text-gray-400 text-xs mb-5">{user?.investor_id}</p>

              {/* Holdings */}
              <div className="grid grid-cols-2 gap-3 mb-5">
                <div className="bg-brand-green-900 rounded-xl p-3 text-white">
                  <p className="text-xs text-white/60 mb-1">Units Held</p>
                  <p className="text-2xl font-bold text-brand-gold-400">{holding.total_units.toLocaleString()}</p>
                </div>
                <div className="border border-brand-gold-300 rounded-xl p-3">
                  <p className="text-xs text-gray-400 mb-1">Total Invested</p>
                  <p className="text-lg font-bold text-brand-green-900">
                    GHS {holding.total_amount_invested.toLocaleString('en-GH', { minimumFractionDigits: 2 })}
                  </p>
                </div>
              </div>

              <p className="text-xs text-gray-400 mb-1">Share Class</p>
              <p className="font-semibold text-brand-charcoal mb-5">{holding.share_classes?.name}</p>

              {/* Status + Download */}
              <div className="flex items-center justify-between">
                {holding.certificate_url ? (
                  <span className="badge-success flex items-center gap-1">
                    <CheckCircle2 size={12} /> Certificate Ready
                  </span>
                ) : (
                  <span className="badge-pending flex items-center gap-1">
                    <Clock size={12} /> Pending Issuance
                  </span>
                )}

                <div className="flex gap-2">
                  {holding.certificate_url && (
                    <>
                      <button
                        onClick={() => window.open(`/dashboard/certificates/${holding.id}/view`, '_blank')}
                        className="flex items-center gap-1.5 text-brand-green-900 border border-brand-green-900 rounded-lg px-3 py-1.5 text-sm font-medium hover:bg-brand-green-50 transition-all"
                      >
                        <Eye size={14} /> View
                      </button>
                      <button
                        onClick={() => handleDownload(holding.id, holding.certificate_number)}
                        disabled={downloading === holding.id}
                        className="flex items-center gap-1.5 bg-brand-green-900 text-white rounded-lg px-3 py-1.5 text-sm font-medium hover:bg-brand-green-800 transition-all disabled:opacity-50"
                      >
                        <Download size={14} />
                        {downloading === holding.id ? 'Downloading...' : 'Download PDF'}
                      </button>
                    </>
                  )}
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {hasCertificates && (
        <div className="mt-6 p-4 bg-brand-green-50 border border-brand-green-200 rounded-xl">
          <p className="text-brand-green-800 text-sm font-medium mb-1">About Your Certificate</p>
          <p className="text-brand-green-700 text-xs leading-relaxed">
            This certificate is issued under the Companies Act 2019 (Act 992) of Ghana and constitutes legal proof of share ownership in Kwamnan Rural Bank Limited.
            Please keep a secure copy. For queries, contact the Share Registrar at the bank.
          </p>
        </div>
      )}
    </div>
  )
}
