'use client'
import { useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { motion } from 'framer-motion'
import {
  LayoutDashboard, TrendingUp, Award, History,
  Bell, Settings, LogOut, ChevronRight, Menu, X
} from 'lucide-react'
import { useAuthStore, useUIStore } from '@/lib/store'
import { notificationsApi } from '@/lib/api'
import { FeedbackWidget } from '@/components/feedback/FeedbackWidget'

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Overview', icon: LayoutDashboard },
  { href: '/dashboard/shares', label: 'Buy Shares', icon: TrendingUp },
  { href: '/dashboard/portfolio', label: 'My Portfolio', icon: Award },
  { href: '/dashboard/history', label: 'Transactions', icon: History },
  { href: '/dashboard/certificates', label: 'Certificates', icon: Award },
]

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const { user, token, isAuthenticated, clearAuth } = useAuthStore()
  const { sidebarOpen, toggleSidebar, notifications, setNotifications } = useUIStore()

  useEffect(() => {
    if (!isAuthenticated || !token) {
      router.push('/login')
      return
    }
    // Poll unread notification count
    notificationsApi.getUnreadCount(token).then((r) => setNotifications(r.count)).catch(() => {})
    const interval = setInterval(() => {
      notificationsApi.getUnreadCount(token).then((r) => setNotifications(r.count)).catch(() => {})
    }, 30000)
    return () => clearInterval(interval)
  }, [isAuthenticated, token, router, setNotifications])

  const logout = () => {
    clearAuth()
    router.push('/login')
  }

  if (!isAuthenticated) return null

  return (
    <div className="min-h-screen bg-brand-cream flex">
      {/* ── Sidebar ─────────────────────────────────────── */}
      <aside className={`${sidebarOpen ? 'w-64' : 'w-16'} fixed top-0 left-0 h-full bg-brand-green-900 transition-all duration-300 z-40 flex flex-col`}>
        {/* Logo */}
        <div className="flex items-center gap-3 px-4 py-5 border-b border-white/10">
          <div className="w-8 h-8 bg-brand-gold-500 rounded-lg flex items-center justify-center flex-shrink-0">
            <span className="text-brand-green-900 font-bold text-sm">K</span>
          </div>
          {sidebarOpen && (
            <div className="overflow-hidden">
              <p className="text-white font-bold text-xs leading-tight">KWAMNAN RURAL BANK</p>
              <p className="text-brand-gold-400 text-xs">Investor Portal</p>
            </div>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 py-4 px-2 space-y-1">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || (href !== '/dashboard' && pathname.startsWith(href))
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 group
                  ${active ? 'bg-brand-gold-500 text-brand-green-900' : 'text-white/70 hover:bg-white/10 hover:text-white'}`}
              >
                <Icon size={18} className="flex-shrink-0" />
                {sidebarOpen && <span className="text-sm font-medium">{label}</span>}
                {sidebarOpen && active && <ChevronRight size={14} className="ml-auto" />}
              </Link>
            )
          })}
        </nav>

        {/* User + logout */}
        <div className="p-3 border-t border-white/10">
          {sidebarOpen && (
            <div className="px-2 py-2 mb-2">
              <p className="text-white text-sm font-medium truncate">{user?.full_name}</p>
              <p className="text-white/50 text-xs">{user?.investor_id || 'Pending approval'}</p>
            </div>
          )}
          <button
            onClick={logout}
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-white/60 hover:text-red-400 hover:bg-white/10 w-full transition-all"
          >
            <LogOut size={18} />
            {sidebarOpen && <span className="text-sm">Sign Out</span>}
          </button>
        </div>
      </aside>

      {/* ── Main content ────────────────────────────────── */}
      <main className={`flex-1 ${sidebarOpen ? 'ml-64' : 'ml-16'} transition-all duration-300`}>
        {/* Topbar */}
        <header className="sticky top-0 z-30 bg-white border-b border-border px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button onClick={toggleSidebar} className="text-gray-400 hover:text-brand-green-900 transition-colors">
              {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
            <div>
              <h1 className="font-semibold text-brand-charcoal capitalize text-sm">
                {pathname === '/dashboard' ? 'Welcome back' : pathname.split('/').pop()?.replace('-', ' ')}
              </h1>
              <p className="text-xs text-gray-400">Kwamnan Rural Bank • Investor Portal</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/dashboard/notifications" className="relative p-2 text-gray-400 hover:text-brand-green-900 transition-colors">
              <Bell size={20} />
              {notifications > 0 && (
                <span className="absolute top-1 right-1 w-4 h-4 bg-red-500 rounded-full text-white text-xs flex items-center justify-center font-bold">
                  {notifications > 9 ? '9+' : notifications}
                </span>
              )}
            </Link>
            <Link href="/dashboard/settings" className="p-2 text-gray-400 hover:text-brand-green-900 transition-colors">
              <Settings size={20} />
            </Link>
          </div>
        </header>

        <motion.div
          key={pathname}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="p-6"
        >
          {children}
        </motion.div>
      </main>

      {/* Multilingual feedback widget — visible on all dashboard pages */}
      <FeedbackWidget />
    </div>
  )
}
