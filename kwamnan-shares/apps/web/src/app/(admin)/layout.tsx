'use client'
import { useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import {
  LayoutDashboard, Clock, Users, Shield, AlertTriangle, Settings,
  LogOut, ChevronRight, FileText, Copy
} from 'lucide-react'
import { useAuthStore } from '@/lib/store'
import { motion } from 'framer-motion'

const ADMIN_NAV = [
  { href: '/admin', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/admin/approve', label: 'Pending Approvals', icon: Clock, badge: true },
  { href: '/admin/investors', label: 'Investors', icon: Users },
  { href: '/admin/duplicates', label: 'Duplicate Flags', icon: Copy },
  { href: '/admin/security', label: 'Security Events', icon: AlertTriangle },
  { href: '/admin/reports', label: 'Reports', icon: FileText },
  { href: '/admin/settings', label: 'Settings', icon: Settings },
]

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const { user, isAuthenticated, clearAuth } = useAuthStore()

  useEffect(() => {
    if (!isAuthenticated) { router.push('/login'); return }
    if (!['admin', 'bank_staff', 'auditor'].includes(user?.role || '')) {
      router.push('/dashboard')
    }
  }, [isAuthenticated, user, router])

  if (!isAuthenticated || !['admin', 'bank_staff', 'auditor'].includes(user?.role || '')) return null

  return (
    <div className="min-h-screen bg-gray-950 flex">
      {/* Dark admin sidebar */}
      <aside className="w-64 fixed top-0 left-0 h-full bg-gray-900 border-r border-gray-800 flex flex-col">
        <div className="flex items-center gap-3 px-5 py-5 border-b border-gray-800">
          <div className="w-8 h-8 bg-brand-gold-500 rounded-lg flex items-center justify-center">
            <span className="text-brand-green-900 font-bold text-sm">K</span>
          </div>
          <div>
            <p className="text-white font-bold text-xs">KWAMNAN BANK</p>
            <p className="text-brand-gold-400 text-xs">Admin Portal</p>
          </div>
        </div>

        <nav className="flex-1 py-4 px-3 space-y-1">
          {ADMIN_NAV.map(({ href, label, icon: Icon }) => {
            const active = pathname === href
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all text-sm
                  ${active ? 'bg-brand-gold-500 text-gray-900 font-semibold' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}
              >
                <Icon size={16} />
                {label}
                {active && <ChevronRight size={12} className="ml-auto" />}
              </Link>
            )
          })}
        </nav>

        <div className="p-3 border-t border-gray-800">
          <div className="px-2 py-2 mb-2">
            <p className="text-white text-xs font-medium">{user?.full_name}</p>
            <p className="text-gray-500 text-xs capitalize">{user?.role?.replace('_', ' ')}</p>
          </div>
          <button onClick={() => { clearAuth(); router.push('/login') }}
            className="flex items-center gap-3 px-3 py-2 rounded-xl text-gray-400 hover:text-red-400 hover:bg-gray-800 w-full text-sm transition-all">
            <LogOut size={14} /> Sign Out
          </button>
        </div>
      </aside>

      <main className="ml-64 flex-1 min-h-screen">
        <div className="bg-gray-900 border-b border-gray-800 px-6 py-4">
          <div className="flex items-center gap-3">
            <Shield size={16} className="text-brand-gold-400" />
            <p className="text-white text-sm font-medium">Admin Control Panel — {user?.full_name}</p>
          </div>
        </div>
        <motion.div
          key={pathname}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="p-6"
        >
          {children}
        </motion.div>
      </main>
    </div>
  )
}
