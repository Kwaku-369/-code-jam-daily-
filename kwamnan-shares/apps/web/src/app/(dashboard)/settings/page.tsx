'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import toast from 'react-hot-toast'
import { Shield, Smartphone, Bell, User, ChevronRight } from 'lucide-react'
import { useAuthStore } from '@/lib/store'
import Link from 'next/link'

export default function SettingsPage() {
  const { user } = useAuthStore()

  const SECTIONS = [
    {
      title: 'Security', icon: Shield,
      items: [
        { label: 'Two-Factor Authentication', desc: user?.totp_enabled ? 'Google Authenticator is active ✓' : 'Not set up — recommended', href: '/verify-2fa', badge: user?.totp_enabled ? 'Active' : 'Set up now', danger: !user?.totp_enabled },
        { label: 'Login Activity', desc: 'View recent logins and devices', href: '#' },
      ]
    },
    {
      title: 'Account', icon: User,
      items: [
        { label: 'Personal Information', desc: 'Update your profile details', href: '#' },
        { label: 'KYC Documents', desc: user?.kyc_verified ? 'Verified ✓' : 'Upload your identity documents', href: '#', badge: user?.kyc_verified ? 'Verified' : 'Required' },
        { label: 'Change Password', desc: 'Update your account password', href: '#' },
      ]
    },
    {
      title: 'Notifications', icon: Bell,
      items: [
        { label: 'Email Notifications', desc: 'Receive updates via email', href: '#' },
        { label: 'SMS Alerts', desc: 'Get SMS for important transactions', href: '#' },
      ]
    },
  ]

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-serif font-bold text-brand-green-900 mb-6">Account Settings</h1>

      {/* Profile card */}
      <div className="card mb-6 flex items-center gap-4">
        <div className="w-14 h-14 bg-brand-green-900 rounded-2xl flex items-center justify-center text-2xl font-bold text-brand-gold-400">
          {user?.full_name?.charAt(0)}
        </div>
        <div>
          <p className="font-semibold text-brand-charcoal">{user?.full_name}</p>
          <p className="text-gray-400 text-sm">{user?.email}</p>
          <p className="text-brand-green-700 text-xs font-medium mt-1">{user?.investor_id || 'Pending ID'}</p>
        </div>
        <div className="ml-auto">
          <span className={`${user?.status === 'active' ? 'badge-success' : 'badge-pending'}`}>
            {user?.status}
          </span>
        </div>
      </div>

      <div className="space-y-6">
        {SECTIONS.map((section) => (
          <div key={section.title} className="card">
            <h2 className="font-semibold text-brand-charcoal flex items-center gap-2 mb-4">
              <section.icon size={18} className="text-brand-green-900" /> {section.title}
            </h2>
            <div className="space-y-2">
              {section.items.map((item) => (
                <Link
                  key={item.label}
                  href={item.href}
                  className="flex items-center justify-between p-3 rounded-xl hover:bg-brand-cream transition-all group"
                >
                  <div>
                    <p className="text-sm font-medium text-brand-charcoal">{item.label}</p>
                    <p className="text-xs text-gray-400">{item.desc}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {item.badge && (
                      <span className={(item as Record<string, unknown>).danger ? 'badge-pending text-xs' : 'badge-success text-xs'}>
                        {item.badge}
                      </span>
                    )}
                    <ChevronRight size={16} className="text-gray-300 group-hover:text-brand-green-900 transition-colors" />
                  </div>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
