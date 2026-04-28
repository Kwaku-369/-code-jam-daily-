'use client'
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Download } from 'lucide-react'
import { sharesApi, type Transaction } from '@/lib/api'
import { useAuthStore } from '@/lib/store'

const STATUS_STYLE: Record<string, string> = {
  active: 'badge-success',
  pending_approval: 'badge-pending',
  cancelled: 'badge-danger',
  pending: 'badge-pending',
}

export default function HistoryPage() {
  const { token } = useAuthStore()
  const [txns, setTxns] = useState<Transaction[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!token) return
    setLoading(true)
    sharesApi.getTransactions(token, page)
      .then((r) => { setTxns(r.data); setTotal(r.total) })
      .catch(() => toast.error('Failed to load transactions'))
      .finally(() => setLoading(false))
  }, [token, page])

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-serif font-bold text-brand-green-900">Transaction History</h1>
          <p className="text-gray-500 text-sm">{total} total transactions</p>
        </div>
        <button
          onClick={async () => {
            if (!token) return
            const blob = await sharesApi.downloadSpreadsheet(token)
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url; a.download = 'kwamnan-statement.csv'; a.click()
            URL.revokeObjectURL(url)
          }}
          className="btn-outline text-sm py-2 px-4 flex items-center gap-2"
        >
          <Download size={15} /> Export Statement
        </button>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-400 text-xs uppercase border-b border-gray-100">
                {['Reference', 'Date', 'Share Class', 'Units', 'Amount', 'Method', 'Status'].map((h) => (
                  <th key={h} className="text-left px-4 py-3 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? Array(5).fill(0).map((_, i) => (
                <tr key={i}><td colSpan={7} className="px-4 py-3"><div className="skeleton h-8 w-full" /></td></tr>
              )) : txns.map((t) => (
                <tr key={t.id} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                  <td className="px-4 py-3 font-mono text-xs text-gray-500">{t.reference}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{new Date(t.created_at).toLocaleDateString('en-GH', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
                  <td className="px-4 py-3 font-medium text-brand-charcoal">{t.share_classes?.name}</td>
                  <td className="px-4 py-3 text-gray-600">{t.units.toLocaleString()}</td>
                  <td className="px-4 py-3 font-semibold text-brand-green-900">GHS {t.net_amount.toLocaleString()}</td>
                  <td className="px-4 py-3 text-gray-400 text-xs capitalize">{t.payment_channel?.replace('_', ' ')}</td>
                  <td className="px-4 py-3"><span className={STATUS_STYLE[t.status] || 'badge-pending'}>{t.status?.replace('_', ' ')}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {total > 20 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
            <p className="text-gray-400 text-xs">Showing {(page - 1) * 20 + 1}-{Math.min(page * 20, total)} of {total}</p>
            <div className="flex gap-2">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="px-3 py-1 text-sm border rounded-lg disabled:opacity-40 hover:bg-gray-50">Prev</button>
              <button onClick={() => setPage(p => p + 1)} disabled={page * 20 >= total} className="px-3 py-1 text-sm border rounded-lg disabled:opacity-40 hover:bg-gray-50">Next</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
