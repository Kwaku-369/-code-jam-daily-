'use client'
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { TrendingUp, TrendingDown, Download, RefreshCw } from 'lucide-react'
import { sharesApi, type Holding } from '@/lib/api'
import { useAuthStore } from '@/lib/store'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts'

const CHART_COLORS = ['#1A5C38', '#D4AF37', '#147f43', '#b8941c', '#2aa45c']

export default function PortfolioPage() {
  const { token } = useAuthStore()
  const [holdings, setHoldings] = useState<Holding[]>([])
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    if (!token) return
    sharesApi.getPortfolio(token).then((r) => setHoldings(r.data)).catch(() => toast.error('Failed to load portfolio')).finally(() => setLoading(false))
  }, [token])

  const totalInvested = holdings.reduce((s, h) => s + h.total_amount_invested, 0)
  const totalValue = holdings.reduce((s, h) => s + (h.current_value || 0), 0)
  const totalPnl = totalValue - totalInvested
  const pnlPct = totalInvested > 0 ? (totalPnl / totalInvested) * 100 : 0

  const chartData = holdings.map((h) => ({
    name: h.share_classes?.code || 'N/A',
    value: h.total_amount_invested,
    fullName: h.share_classes?.name,
  }))

  const handleExport = async () => {
    if (!token) return
    setExporting(true)
    try {
      const blob = await sharesApi.downloadSpreadsheet(token)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `kwamnan-portfolio-${new Date().toISOString().split('T')[0]}.csv`
      a.click()
      URL.revokeObjectURL(url)
      toast.success('Spreadsheet exported!')
    } catch { toast.error('Export failed') } finally { setExporting(false) }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-serif font-bold text-brand-green-900">My Portfolio</h1>
          <p className="text-gray-500 text-sm mt-1">Real-time view of all your share holdings</p>
        </div>
        <button
          onClick={handleExport}
          disabled={exporting}
          className="btn-outline flex items-center gap-2 text-sm py-2 px-4"
        >
          <Download size={15} /> {exporting ? 'Exporting...' : 'Export CSV'}
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid sm:grid-cols-3 gap-4">
        {[
          { label: 'Total Invested', value: `GHS ${totalInvested.toLocaleString('en-GH', { minimumFractionDigits: 2 })}`, sub: `${holdings.length} positions` },
          { label: 'Current Value', value: `GHS ${totalValue.toLocaleString('en-GH', { minimumFractionDigits: 2 })}`, sub: 'Mark-to-market' },
          { label: 'Unrealized P&L', value: `${totalPnl >= 0 ? '+' : ''}GHS ${totalPnl.toFixed(2)}`, sub: `${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%`, positive: totalPnl >= 0 },
        ].map((s) => (
          <div key={s.label} className="stat-card">
            <p className="text-gray-500 text-sm mb-1">{s.label}</p>
            <p className={`text-2xl font-bold ${(s as Record<string, unknown>).positive === false ? 'text-red-600' : 'text-brand-green-900'}`}>{s.value}</p>
            <p className={`text-xs font-medium mt-1 ${(s as Record<string, unknown>).positive === false ? 'text-red-500' : 'text-gray-500'}`}>{s.sub}</p>
          </div>
        ))}
      </div>

      {/* Chart + Holdings table */}
      <div className="grid lg:grid-cols-3 gap-6">
        {chartData.length > 0 && (
          <div className="card">
            <h2 className="font-semibold text-brand-charcoal mb-4">Allocation</h2>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={chartData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={3} dataKey="value">
                  {chartData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(v) => [`GHS ${(v as number).toLocaleString()}`, 'Invested']} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}

        <div className={`card ${chartData.length > 0 ? 'lg:col-span-2' : 'lg:col-span-3'}`}>
          <h2 className="font-semibold text-brand-charcoal mb-4">Holdings</h2>
          {loading ? (
            <div className="space-y-3">{Array(3).fill(0).map((_, i) => <div key={i} className="skeleton h-14" />)}</div>
          ) : holdings.length === 0 ? (
            <div className="text-center py-8 text-gray-400">
              <p>No holdings yet.</p>
              <a href="/dashboard/shares" className="text-brand-green-900 text-sm hover:underline mt-2 inline-block">Buy your first shares →</a>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-gray-400 text-xs uppercase border-b border-gray-100">
                    {['Share Class', 'Units', 'Avg Cost', 'Invested', 'Current Value', 'P&L', 'Dividend p.a.'].map((h) => (
                      <th key={h} className="text-right first:text-left pb-3 font-medium px-2">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {holdings.map((h) => {
                    const pnl = (h.current_value || 0) - h.total_amount_invested
                    const pnlPct = h.total_amount_invested > 0 ? (pnl / h.total_amount_invested) * 100 : 0
                    const annualDividend = h.total_amount_invested * (h.share_classes?.dividend_rate || 0) / 100
                    return (
                      <tr key={h.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                        <td className="py-3 px-2">
                          <p className="font-medium text-brand-charcoal">{h.share_classes?.name}</p>
                          <p className="text-xs text-gray-400">{h.share_classes?.code}</p>
                        </td>
                        <td className="py-3 px-2 text-right text-gray-600">{h.total_units.toLocaleString()}</td>
                        <td className="py-3 px-2 text-right text-gray-400 text-xs">
                          GHS {h.average_cost_per_unit?.toFixed(4) || '—'}
                        </td>
                        <td className="py-3 px-2 text-right text-gray-600">GHS {h.total_amount_invested.toLocaleString()}</td>
                        <td className="py-3 px-2 text-right font-semibold text-brand-green-900">
                          GHS {h.current_value?.toLocaleString() || '—'}
                        </td>
                        <td className={`py-3 px-2 text-right font-medium ${pnl >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                          <span className="flex items-center justify-end gap-1">
                            {pnl >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                            {pnl >= 0 ? '+' : ''}{pnlPct.toFixed(1)}%
                          </span>
                        </td>
                        <td className="py-3 px-2 text-right text-brand-gold-600 font-medium text-xs">
                          GHS {annualDividend.toFixed(2)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
