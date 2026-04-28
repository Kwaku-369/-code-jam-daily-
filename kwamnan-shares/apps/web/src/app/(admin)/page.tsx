'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Users, Clock, DollarSign, Shield, AlertTriangle, Copy, ChevronRight, Activity } from 'lucide-react'
import { adminApi, type AdminDashboard } from '@/lib/api'
import { useAuthStore } from '@/lib/store'
import { createClient } from '@/lib/supabase'
import toast from 'react-hot-toast'

export default function AdminDashboardPage() {
  const { token } = useAuthStore()
  const [data, setData] = useState<AdminDashboard | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!token) return
    adminApi.getDashboard(token)
      .then(setData)
      .catch(() => toast.error('Failed to load dashboard'))
      .finally(() => setLoading(false))

    // Realtime security alerts
    const supabase = createClient()
    const channel = supabase.channel('admin-security')
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'security_events',
      }, (payload) => {
        const level = payload.new.threat_level
        if (level === 'critical' || level === 'high') {
          toast.error(`🚨 ${level.toUpperCase()} THREAT: ${payload.new.event_type}`, { duration: 8000 })
        }
      })
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'approval_queue',
      }, () => {
        toast('New share purchase awaiting approval', { icon: '⏳' })
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [token])

  const STATS = data ? [
    { label: 'Total Investors', value: data.stats.total_investors.toLocaleString(), icon: Users, color: 'text-blue-400', link: '/admin/investors' },
    { label: 'Pending Approvals', value: data.stats.pending_approvals.toLocaleString(), icon: Clock, color: 'text-amber-400', link: '/admin/approve', urgent: data.stats.pending_approvals > 0 },
    { label: 'Total Invested (GHS)', value: data.stats.total_invested_ghs.toLocaleString('en-GH', { maximumFractionDigits: 0 }), icon: DollarSign, color: 'text-green-400', link: '#' },
    { label: 'Security Alerts', value: data.stats.security_alerts.toLocaleString(), icon: AlertTriangle, color: 'text-red-400', link: '/admin/security', urgent: data.stats.security_alerts > 0 },
    { label: 'Duplicate Flags', value: data.stats.duplicate_flags.toLocaleString(), icon: Copy, color: 'text-purple-400', link: '/admin/duplicates' },
  ] : []

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white mb-1">Admin Dashboard</h1>
        <p className="text-gray-400 text-sm">{new Date().toLocaleDateString('en-GH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
      </div>

      {/* Stats grid */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {loading ? Array(5).fill(0).map((_, i) => (
          <div key={i} className="bg-gray-800 rounded-xl p-4 animate-pulse h-24" />
        )) : STATS.map((s) => (
          <Link key={s.label} href={s.link}
            className={`bg-gray-800 hover:bg-gray-750 rounded-xl p-4 border transition-all ${s.urgent ? 'border-amber-500/50 bg-amber-950/20' : 'border-gray-700'}`}>
            <div className="flex items-center justify-between mb-2">
              <s.icon size={18} className={s.color} />
              {s.urgent && <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />}
            </div>
            <p className="text-2xl font-bold text-white">{s.value}</p>
            <p className="text-gray-400 text-xs mt-1">{s.label}</p>
          </Link>
        ))}
      </div>

      {/* Recent transactions */}
      <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700">
          <h2 className="text-white font-semibold flex items-center gap-2">
            <Activity size={16} className="text-brand-gold-400" /> Recent Transactions
          </h2>
          <Link href="/admin/approve" className="text-brand-gold-400 text-sm flex items-center gap-1 hover:text-brand-gold-300">
            View pending <ChevronRight size={14} />
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-500 text-xs uppercase border-b border-gray-700">
                {['Investor', 'Reference', 'Share Class', 'Units', 'Amount', 'Status', 'Date'].map((h) => (
                  <th key={h} className="text-left px-5 py-3 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(data?.recent_transactions || []).map((t) => (
                <tr key={t.id} className="border-b border-gray-700/50 hover:bg-gray-750 transition-colors">
                  <td className="px-5 py-3">
                    <p className="text-white font-medium text-xs">{(t as Record<string, unknown>).profiles ? ((t as Record<string, unknown>).profiles as Record<string, unknown>).full_name as string : 'N/A'}</p>
                    <p className="text-gray-500 text-xs">{(t as Record<string, unknown>).profiles ? ((t as Record<string, unknown>).profiles as Record<string, unknown>).investor_id as string : ''}</p>
                  </td>
                  <td className="px-5 py-3 font-mono text-xs text-gray-400">{t.reference}</td>
                  <td className="px-5 py-3 text-gray-300 text-xs">{t.share_classes?.name}</td>
                  <td className="px-5 py-3 text-gray-300">{t.units?.toLocaleString()}</td>
                  <td className="px-5 py-3 text-white font-medium">GHS {t.net_amount?.toLocaleString()}</td>
                  <td className="px-5 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium
                      ${t.status === 'active' ? 'bg-green-900/50 text-green-400' :
                        t.status === 'pending_approval' ? 'bg-amber-900/50 text-amber-400' :
                        'bg-gray-700 text-gray-400'}`}>
                      {t.status?.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-gray-500 text-xs">{new Date(t.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {(data?.recent_transactions || []).length === 0 && !loading && (
            <p className="text-gray-500 text-center py-8">No transactions yet</p>
          )}
        </div>
      </div>
    </div>
  )
}
