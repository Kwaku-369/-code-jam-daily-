'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { TrendingUp, Award, DollarSign, ArrowRight, Bell, ChevronRight, Activity } from 'lucide-react'
import { useAuthStore } from '@/lib/store'
import { sharesApi, notificationsApi, type Holding, type Notification } from '@/lib/api'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { createClient } from '@/lib/supabase'
import toast from 'react-hot-toast'

// Mock portfolio growth chart data (will be replaced by real data)
const generateChartData = (total: number) => {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return months.slice(0, new Date().getMonth() + 1).map((month, i) => ({
    month,
    value: Math.round((total * 0.6) + (total * 0.4 * (i / (new Date().getMonth() + 1)))),
  }))
}

export default function DashboardPage() {
  const { user, token } = useAuthStore()
  const [holdings, setHoldings] = useState<Holding[]>([])
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!token) return
    Promise.all([
      sharesApi.getPortfolio(token),
      notificationsApi.getAll(token),
    ]).then(([portfolioRes, notifRes]) => {
      setHoldings(portfolioRes.data || [])
      setNotifications((notifRes.data || []).slice(0, 5))
    }).catch(() => toast.error('Failed to load dashboard')).finally(() => setLoading(false))

    // Realtime: subscribe to notifications
    const supabase = createClient()
    const channel = supabase.channel('notifications')
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'notifications',
        filter: `user_id=eq.${user?.id}`,
      }, (payload) => {
        toast(payload.new.title, { icon: '🔔' })
        setNotifications((prev) => [payload.new as Notification, ...prev.slice(0, 4)])
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [token, user?.id])

  const totalValue = holdings.reduce((s, h) => s + (h.current_value || 0), 0)
  const totalInvested = holdings.reduce((s, h) => s + h.total_amount_invested, 0)
  const totalPnl = totalValue - totalInvested
  const totalUnits = holdings.reduce((s, h) => s + h.total_units, 0)

  const chartData = generateChartData(totalValue)

  const stats = [
    { label: 'Portfolio Value', value: `GHS ${totalValue.toLocaleString('en-GH', { minimumFractionDigits: 2 })}`, change: totalPnl >= 0 ? `+GHS ${totalPnl.toFixed(2)}` : `-GHS ${Math.abs(totalPnl).toFixed(2)}`, icon: TrendingUp, positive: totalPnl >= 0 },
    { label: 'Total Invested', value: `GHS ${totalInvested.toLocaleString('en-GH', { minimumFractionDigits: 2 })}`, change: `${holdings.length} holdings`, icon: DollarSign, positive: true },
    { label: 'Total Shares', value: totalUnits.toLocaleString(), change: `${holdings.length} share class${holdings.length !== 1 ? 'es' : ''}`, icon: Award, positive: true },
  ]

  return (
    <div className="space-y-6">
      {/* Welcome */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-serif font-bold text-brand-green-900">
            Good {new Date().getHours() < 12 ? 'Morning' : new Date().getHours() < 17 ? 'Afternoon' : 'Evening'},{' '}
            {user?.full_name?.split(' ')[0]} 👋
          </h1>
          <p className="text-gray-500 text-sm mt-1">
            {user?.investor_id || 'Account pending activation'} • {new Date().toLocaleDateString('en-GH', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
        </div>
        <Link href="/dashboard/shares" className="btn-primary flex items-center gap-2">
          Buy More Shares <ArrowRight size={16} />
        </Link>
      </div>

      {/* KYC Banner if not verified */}
      {user?.status === 'pending' && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-center justify-between">
          <div>
            <p className="font-medium text-amber-800 text-sm">Complete your verification</p>
            <p className="text-amber-600 text-xs">Submit your ID documents to start investing</p>
          </div>
          <Link href="/dashboard/settings" className="text-amber-700 font-medium text-sm hover:underline flex items-center gap-1">
            Verify Now <ChevronRight size={14} />
          </Link>
        </div>
      )}

      {/* Stats */}
      <div className="grid sm:grid-cols-3 gap-4">
        {stats.map((stat) => (
          <div key={stat.label} className="stat-card">
            <div className="flex items-center justify-between mb-3">
              <p className="text-gray-500 text-sm">{stat.label}</p>
              <div className="w-9 h-9 bg-brand-green-50 rounded-lg flex items-center justify-center">
                <stat.icon size={18} className="text-brand-green-900" />
              </div>
            </div>
            {loading ? (
              <div className="skeleton h-8 w-3/4 mb-2" />
            ) : (
              <>
                <p className="stat-number text-2xl">{stat.value}</p>
                <p className={`text-xs font-medium mt-1 ${stat.positive ? 'text-green-600' : 'text-red-500'}`}>
                  {stat.change}
                </p>
              </>
            )}
          </div>
        ))}
      </div>

      {/* Chart + Notifications */}
      <div className="grid lg:grid-cols-3 gap-6">
        {/* Portfolio growth chart */}
        <div className="card lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-brand-charcoal flex items-center gap-2">
              <Activity size={18} className="text-brand-green-900" /> Portfolio Growth (2024)
            </h2>
            <span className="badge-success">+12.5% annual</span>
          </div>
          {loading ? (
            <div className="skeleton h-48 w-full" />
          ) : totalValue > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#1A5C38" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#1A5C38" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#9ca3af' }} />
                <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} tickFormatter={(v) => `GHS ${v.toLocaleString()}`} />
                <Tooltip formatter={(v) => [`GHS ${(v as number).toLocaleString()}`, 'Value']} contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.1)' }} />
                <Area type="monotone" dataKey="value" stroke="#1A5C38" strokeWidth={2} fill="url(#colorValue)" />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-48 flex flex-col items-center justify-center text-center">
              <TrendingUp size={40} className="text-brand-green-100 mb-3" />
              <p className="text-gray-400 text-sm">Your portfolio chart will appear here after your first investment.</p>
              <Link href="/dashboard/shares" className="btn-primary mt-4 text-sm py-2 px-4">Start Investing</Link>
            </div>
          )}
        </div>

        {/* Notifications */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-brand-charcoal flex items-center gap-2">
              <Bell size={18} className="text-brand-green-900" /> Recent Activity
            </h2>
          </div>
          <div className="space-y-3">
            {loading ? Array(3).fill(0).map((_, i) => (
              <div key={i} className="skeleton h-12 w-full" />
            )) : notifications.length > 0 ? notifications.map((n) => (
              <div key={n.id} className={`p-3 rounded-xl border transition-all ${n.read ? 'border-gray-100 bg-gray-50/50' : 'border-brand-green-100 bg-brand-green-50/30'}`}>
                <p className={`text-xs font-medium ${n.read ? 'text-gray-700' : 'text-brand-green-900'}`}>{n.title}</p>
                <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{n.message}</p>
                <p className="text-xs text-gray-400 mt-1">{new Date(n.created_at).toLocaleDateString()}</p>
              </div>
            )) : (
              <p className="text-gray-400 text-sm text-center py-8">No recent activity</p>
            )}
          </div>
        </div>
      </div>

      {/* Holdings */}
      {holdings.length > 0 && (
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-brand-charcoal">My Holdings</h2>
            <Link href="/dashboard/portfolio" className="text-brand-green-900 text-sm font-medium hover:underline flex items-center gap-1">
              View all <ChevronRight size={14} />
            </Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-400 text-xs uppercase border-b border-gray-100">
                  <th className="text-left pb-3 font-medium">Share Class</th>
                  <th className="text-right pb-3 font-medium">Units</th>
                  <th className="text-right pb-3 font-medium">Invested</th>
                  <th className="text-right pb-3 font-medium">Current Value</th>
                  <th className="text-right pb-3 font-medium">Return</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {holdings.map((h) => {
                  const pnl = h.current_value - h.total_amount_invested
                  const pnlPct = (pnl / h.total_amount_invested) * 100
                  return (
                    <tr key={h.id} className="hover:bg-gray-50/50 transition-colors">
                      <td className="py-3 font-medium text-brand-charcoal">{h.share_classes?.name}</td>
                      <td className="py-3 text-right text-gray-600">{h.total_units.toLocaleString()}</td>
                      <td className="py-3 text-right text-gray-600">GHS {h.total_amount_invested.toLocaleString()}</td>
                      <td className="py-3 text-right font-semibold text-brand-green-900">GHS {h.current_value?.toLocaleString()}</td>
                      <td className={`py-3 text-right font-medium ${pnl >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                        {pnl >= 0 ? '+' : ''}{pnlPct.toFixed(1)}%
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
