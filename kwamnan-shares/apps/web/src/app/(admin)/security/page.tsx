'use client'
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { AlertTriangle, Shield, Eye } from 'lucide-react'
import { adminApi, type SecurityEvent, type DuplicateFlag } from '@/lib/api'
import { useAuthStore } from '@/lib/store'
import { createClient } from '@/lib/supabase'

const THREAT_COLORS: Record<string, string> = {
  low: 'bg-blue-900/30 text-blue-400 border-blue-500/30',
  medium: 'bg-amber-900/30 text-amber-400 border-amber-500/30',
  high: 'bg-orange-900/30 text-orange-400 border-orange-500/30',
  critical: 'bg-red-900/30 text-red-400 border-red-500/30',
}

export default function SecurityPage() {
  const { token } = useAuthStore()
  const [events, setEvents] = useState<SecurityEvent[]>([])
  const [duplicates, setDuplicates] = useState<DuplicateFlag[]>([])
  const [tab, setTab] = useState<'threats' | 'duplicates'>('threats')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!token) return
    Promise.all([
      adminApi.getSecurityEvents(token),
      adminApi.getDuplicates(token),
    ]).then(([eventsRes, dupRes]) => {
      setEvents(eventsRes.data)
      setDuplicates(dupRes.data)
    }).catch(() => toast.error('Failed to load security data')).finally(() => setLoading(false))

    // Realtime security alerts
    const supabase = createClient()
    const channel = supabase.channel('security-realtime')
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'security_events',
      }, (payload) => {
        const ev = payload.new as SecurityEvent
        setEvents((prev) => [ev, ...prev])
        if (ev.threat_level === 'critical') {
          toast.error(`🚨 CRITICAL: ${ev.event_type}`, { duration: 10000 })
        }
      }).subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [token])

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Security Center</h1>
          <p className="text-gray-400 text-sm">AI-powered threat detection and duplicate account monitoring</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-400 bg-gray-800 px-3 py-2 rounded-xl border border-gray-700">
          <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          AI Security Agent: Active
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6">
        {[
          { id: 'threats', label: `Threat Events (${events.length})` },
          { id: 'duplicates', label: `Duplicate Flags (${duplicates.length})` },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id as typeof tab)}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${tab === t.id ? 'bg-brand-gold-500 text-gray-900' : 'bg-gray-800 text-gray-400 hover:text-white'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-3">{Array(5).fill(0).map((_, i) => <div key={i} className="bg-gray-800 h-16 rounded-xl animate-pulse" />)}</div>
      ) : tab === 'threats' ? (
        events.length === 0 ? (
          <div className="text-center py-16 text-gray-500">
            <Shield size={40} className="mx-auto mb-3 text-green-600" />
            <p>No active threats detected</p>
          </div>
        ) : (
          <div className="space-y-3">
            {events.map((ev) => (
              <div key={ev.id} className={`flex items-start gap-4 p-4 rounded-xl border ${THREAT_COLORS[ev.threat_level] || THREAT_COLORS.low}`}>
                <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium text-sm">{ev.event_type.replace(/_/g, ' ')}</p>
                    <span className="text-xs opacity-70 uppercase font-bold">{ev.threat_level}</span>
                  </div>
                  <p className="text-xs opacity-80 mt-1">{ev.description}</p>
                  <div className="flex gap-4 mt-2 text-xs opacity-60">
                    {ev.profiles && <span>User: {ev.profiles.full_name}</span>}
                    {ev.ip_address && <span>IP: {ev.ip_address}</span>}
                    <span>{new Date(ev.created_at).toLocaleString()}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )
      ) : (
        duplicates.length === 0 ? (
          <div className="text-center py-16 text-gray-500">
            <Eye size={40} className="mx-auto mb-3 text-green-600" />
            <p>No duplicate accounts flagged</p>
          </div>
        ) : (
          <div className="space-y-4">
            {duplicates.map((dup) => (
              <div key={dup.id} className="bg-gray-800 border border-amber-500/30 rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-amber-400 font-medium text-sm flex items-center gap-2">
                    <AlertTriangle size={14} /> Possible Duplicate — {Math.round(dup.match_confidence)}% confidence
                  </p>
                  <span className="text-xs bg-amber-900/30 text-amber-400 px-2 py-1 rounded-full capitalize">{dup.match_type}</span>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  {[dup.flagged, dup.matching].map((profile, i) => (
                    <div key={i} className="bg-gray-900 rounded-lg p-3">
                      <p className="text-white font-medium text-sm">{profile?.full_name}</p>
                      <p className="text-gray-400 text-xs mt-1">{profile?.investor_id}</p>
                      <p className="text-gray-500 text-xs">{profile?.phone}</p>
                      <p className="text-gray-500 text-xs">{profile?.email}</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  )
}
