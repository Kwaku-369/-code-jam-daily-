'use client'
import { useEffect, useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import toast from 'react-hot-toast'
import {
  UserCog, Shield, Users, Plus, Search,
  ToggleLeft, ToggleRight, RefreshCw, CheckCircle2, XCircle, Eye
} from 'lucide-react'
import { useAuthStore } from '@/lib/store'
import { createClient } from '@/lib/supabase'

type Role = 'investor' | 'inputer' | 'authorizer' | 'bank_staff' | 'admin' | 'auditor'

type StaffProfile = {
  id: string
  full_name: string
  email: string
  phone: string
  role: Role
  acting_as_inputer: boolean
  totp_enrolled: boolean
  status: string
  staff_employee_id?: string
  department?: string
  created_at: string
}

const ROLE_INFO: Record<string, { label: string; color: string; desc: string }> = {
  inputer:    { label: 'Inputer (Maker)', color: 'bg-blue-900/40 text-blue-300 border-blue-500/30', desc: 'Can create and submit transactions' },
  authorizer: { label: 'Authorizer (Checker)', color: 'bg-purple-900/40 text-purple-300 border-purple-500/30', desc: 'Can approve/reject transactions; can also act as inputer' },
  bank_staff: { label: 'Bank Staff', color: 'bg-gray-700 text-gray-300 border-gray-600', desc: 'General staff access' },
  admin:      { label: 'Admin', color: 'bg-amber-900/40 text-amber-300 border-amber-500/30', desc: 'Full system access' },
  auditor:    { label: 'Auditor', color: 'bg-teal-900/40 text-teal-300 border-teal-500/30', desc: 'Read-only audit access' },
  investor:   { label: 'Investor', color: 'bg-green-900/40 text-green-300 border-green-500/30', desc: 'Standard investor account' },
}

export default function StaffManagementPage() {
  const { token } = useAuthStore()
  const [staff, setStaff] = useState<StaffProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<StaffProfile | null>(null)
  const [saving, setSaving] = useState(false)

  const loadStaff = useCallback(async () => {
    setLoading(true)
    try {
      const supabase = createClient()
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, email, phone, role, acting_as_inputer, totp_enrolled, status, staff_employee_id, department, created_at')
        .in('role', ['inputer', 'authorizer', 'bank_staff', 'admin', 'auditor'])
        .ilike('full_name', `%${search}%`)
        .order('role')
      if (error) throw error
      setStaff((data || []) as StaffProfile[])
    } catch (err) {
      toast.error('Failed to load staff')
    } finally {
      setLoading(false)
    }
  }, [search])

  useEffect(() => { loadStaff() }, [loadStaff])

  const updateRole = async (profileId: string, newRole: Role) => {
    setSaving(true)
    try {
      const supabase = createClient()
      const { error } = await supabase
        .from('profiles')
        .update({ role: newRole })
        .eq('id', profileId)
      if (error) throw error
      toast.success('Role updated')
      loadStaff()
      setSelected(null)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Update failed'
      toast.error(msg)
    } finally {
      setSaving(false)
    }
  }

  const toggleInputerMode = async (profile: StaffProfile) => {
    if (profile.role !== 'authorizer') {
      toast.error('Only authorizers can toggle inputer mode')
      return
    }
    setSaving(true)
    try {
      const supabase = createClient()
      const { error } = await supabase
        .from('profiles')
        .update({ acting_as_inputer: !profile.acting_as_inputer })
        .eq('id', profile.id)
      if (error) throw error
      toast.success(profile.acting_as_inputer ? 'Switched to Authorizer mode' : 'Switched to Inputer mode')
      loadStaff()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Toggle failed'
      toast.error(msg)
    } finally {
      setSaving(false)
    }
  }

  const filtered = staff.filter((s) =>
    s.full_name.toLowerCase().includes(search.toLowerCase()) ||
    s.email?.toLowerCase().includes(search.toLowerCase()) ||
    s.staff_employee_id?.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <UserCog size={22} className="text-brand-gold-400" />
            Staff Management
          </h1>
          <p className="text-gray-400 text-sm mt-1">
            Manage bank staff roles: inputers (makers) and authorizers (checkers)
          </p>
        </div>
        <button onClick={loadStaff} className="flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors">
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {/* Role legend */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-6">
        {['inputer', 'authorizer', 'admin'].map((role) => {
          const info = ROLE_INFO[role]
          return (
            <div key={role} className={`border rounded-xl p-3 ${info.color}`}>
              <p className="font-medium text-sm">{info.label}</p>
              <p className="text-xs opacity-70 mt-0.5">{info.desc}</p>
            </div>
          )
        })}
      </div>

      {/* Dual-control info */}
      <div className="bg-blue-900/20 border border-blue-500/30 rounded-xl p-4 mb-6 flex items-start gap-3">
        <Shield size={18} className="text-blue-400 mt-0.5 flex-shrink-0" />
        <div>
          <p className="text-blue-300 font-medium text-sm">Dual-Control Protocol</p>
          <p className="text-blue-400/80 text-xs mt-1">
            <strong>Inputers</strong> create transactions (maker). <strong>Authorizers</strong> approve them (checker).
            The same person CANNOT both input and authorize the same transaction.
            An authorizer can switch to inputer mode to create transactions — but must then have a different authorizer approve.
          </p>
        </div>
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
        <input
          type="text"
          placeholder="Search staff by name, email, or employee ID…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded-xl pl-9 pr-4 py-2.5 text-white text-sm w-full focus:outline-none focus:border-brand-gold-400 placeholder:text-gray-500"
        />
      </div>

      {/* Staff table */}
      {loading ? (
        <div className="space-y-3">
          {Array(4).fill(0).map((_, i) => (
            <div key={i} className="bg-gray-800 rounded-xl h-16 animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 text-gray-500">
          <Users size={40} className="mx-auto mb-3 opacity-30" />
          <p>No staff found</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((s) => {
            const info = ROLE_INFO[s.role] ?? ROLE_INFO.bank_staff
            return (
              <motion.div
                key={s.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-gray-800 border border-gray-700 rounded-xl px-5 py-4 flex items-center justify-between gap-4"
              >
                <div className="flex items-center gap-4 min-w-0">
                  <div className="w-9 h-9 bg-gray-700 rounded-full flex items-center justify-center text-sm font-bold text-gray-300 flex-shrink-0">
                    {s.full_name[0]}
                  </div>
                  <div className="min-w-0">
                    <p className="text-white font-medium truncate">{s.full_name}</p>
                    <p className="text-gray-400 text-xs truncate">{s.email} {s.staff_employee_id ? `• ${s.staff_employee_id}` : ''}</p>
                  </div>
                </div>

                <div className="flex items-center gap-3 flex-shrink-0">
                  {/* TOTP indicator */}
                  <div title={s.totp_enrolled ? 'TOTP enrolled' : 'No TOTP'} className={`flex items-center gap-1 text-xs ${s.totp_enrolled ? 'text-green-400' : 'text-red-400'}`}>
                    <Shield size={12} />
                    {s.totp_enrolled ? 'MFA' : 'No MFA'}
                  </div>

                  {/* Role badge */}
                  <span className={`text-xs font-medium px-2.5 py-1 rounded-full border ${info.color}`}>
                    {info.label}
                  </span>

                  {/* Authorizer mode-switch toggle */}
                  {s.role === 'authorizer' && (
                    <button
                      onClick={() => toggleInputerMode(s)}
                      disabled={saving}
                      title={s.acting_as_inputer ? 'Currently acting as Inputer — click to switch back to Authorizer' : 'Click to also act as Inputer'}
                      className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white transition-colors"
                    >
                      {s.acting_as_inputer
                        ? <ToggleRight size={18} className="text-amber-400" />
                        : <ToggleLeft size={18} />
                      }
                      <span>{s.acting_as_inputer ? 'Input mode ON' : 'Input mode'}</span>
                    </button>
                  )}

                  {/* View/edit */}
                  <button
                    onClick={() => setSelected(s)}
                    className="text-gray-500 hover:text-white transition-colors"
                  >
                    <Eye size={16} />
                  </button>
                </div>
              </motion.div>
            )
          })}
        </div>
      )}

      {/* Role editor modal */}
      {selected && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={() => setSelected(null)}>
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            onClick={(e) => e.stopPropagation()}
            className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-md"
          >
            <h3 className="text-white font-bold text-lg mb-1">{selected.full_name}</h3>
            <p className="text-gray-400 text-sm mb-5">{selected.email}</p>

            <p className="text-gray-300 text-sm font-medium mb-3">Change Role</p>
            <div className="space-y-2 mb-6">
              {(['inputer', 'authorizer', 'bank_staff', 'admin', 'auditor'] as Role[]).map((role) => {
                const info = ROLE_INFO[role]
                return (
                  <button
                    key={role}
                    onClick={() => updateRole(selected.id, role)}
                    disabled={saving || selected.role === role}
                    className={`w-full text-left px-4 py-3 rounded-xl border transition-all text-sm
                      ${selected.role === role ? info.color + ' opacity-80' : 'border-gray-700 text-gray-400 hover:border-gray-500 hover:text-white'}`}
                  >
                    <span className="font-medium">{info.label}</span>
                    <span className="block text-xs opacity-60 mt-0.5">{info.desc}</span>
                  </button>
                )
              })}
            </div>

            {selected.role === 'authorizer' && (
              <div className="bg-amber-900/20 border border-amber-500/30 rounded-xl p-3 text-amber-300 text-xs mb-4">
                <strong>Inputer mode:</strong> {selected.acting_as_inputer ? 'ON — this authorizer is currently also acting as an inputer. They cannot approve transactions they themselves created.' : 'OFF — standard authorizer-only mode.'}
              </div>
            )}

            <button onClick={() => setSelected(null)} className="w-full btn-outline text-sm">
              Close
            </button>
          </motion.div>
        </div>
      )}
    </div>
  )
}
