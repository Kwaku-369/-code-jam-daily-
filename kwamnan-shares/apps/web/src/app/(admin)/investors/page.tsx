'use client'
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Search, UserCheck, UserX, Eye } from 'lucide-react'
import { adminApi, type UserProfile } from '@/lib/api'
import { useAuthStore } from '@/lib/store'

export default function InvestorsPage() {
  const { token } = useAuthStore()
  const [investors, setInvestors] = useState<UserProfile[]>([])
  const [total, setTotal] = useState(0)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)

  const load = async (s = search, p = page) => {
    if (!token) return
    setLoading(true)
    try {
      const r = await adminApi.getInvestors(token, s, p)
      setInvestors(r.data)
      setTotal(r.total)
    } catch { toast.error('Failed to load investors') }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [token])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setPage(1)
    load(search, 1)
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Investors</h1>
          <p className="text-gray-400 text-sm">{total.toLocaleString()} registered investors</p>
        </div>
        <form onSubmit={handleSearch} className="flex gap-2">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, ID, phone..."
              className="bg-gray-800 border border-gray-700 rounded-xl pl-9 pr-4 py-2.5 text-white text-sm w-72 focus:outline-none focus:border-brand-gold-400"
            />
          </div>
          <button type="submit" className="px-4 py-2.5 bg-brand-gold-500 text-gray-900 rounded-xl text-sm font-semibold hover:bg-brand-gold-400 transition-colors">Search</button>
        </form>
      </div>

      <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-500 text-xs uppercase border-b border-gray-700">
                {['Investor ID', 'Name', 'Phone', 'KYC', 'Status', 'Total Shares', 'Invested (GHS)', 'Joined', ''].map((h) => (
                  <th key={h} className="text-left px-4 py-3 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? Array(5).fill(0).map((_, i) => (
                <tr key={i}><td colSpan={9}><div className="h-14 bg-gray-750 animate-pulse mx-4 my-2 rounded" /></td></tr>
              )) : investors.map((inv) => (
                <tr key={inv.id} className="border-b border-gray-700/50 hover:bg-gray-750 transition-colors">
                  <td className="px-4 py-3 font-mono text-xs text-gray-400">{inv.investor_id || '—'}</td>
                  <td className="px-4 py-3">
                    <p className="text-white font-medium">{inv.full_name}</p>
                    <p className="text-gray-500 text-xs">{inv.email}</p>
                  </td>
                  <td className="px-4 py-3 text-gray-300 text-xs">{inv.phone}</td>
                  <td className="px-4 py-3">
                    {inv.kyc_verified
                      ? <span className="flex items-center gap-1 text-green-400 text-xs"><UserCheck size={12} /> Verified</span>
                      : <span className="flex items-center gap-1 text-amber-400 text-xs"><UserX size={12} /> Pending</span>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      inv.status === 'active' ? 'bg-green-900/50 text-green-400' :
                      inv.status === 'suspended' ? 'bg-red-900/50 text-red-400' :
                      'bg-gray-700 text-gray-400'}`}>{inv.status}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-300">{inv.total_shares.toLocaleString()}</td>
                  <td className="px-4 py-3 text-white font-medium">{inv.total_invested.toLocaleString()}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{new Date().toLocaleDateString()}</td>
                  <td className="px-4 py-3">
                    <button className="text-brand-gold-400 hover:text-brand-gold-300 transition-colors">
                      <Eye size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {total > 20 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-700">
            <p className="text-gray-500 text-xs">Showing {(page-1)*20+1}-{Math.min(page*20, total)} of {total}</p>
            <div className="flex gap-2">
              <button onClick={() => { setPage(p=>p-1); load(search, page-1) }} disabled={page===1} className="px-3 py-1 bg-gray-700 text-gray-300 rounded-lg text-xs disabled:opacity-40">Prev</button>
              <button onClick={() => { setPage(p=>p+1); load(search, page+1) }} disabled={page*20>=total} className="px-3 py-1 bg-gray-700 text-gray-300 rounded-lg text-xs disabled:opacity-40">Next</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
