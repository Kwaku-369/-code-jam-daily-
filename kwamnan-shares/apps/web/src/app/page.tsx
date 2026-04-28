'use client'
import { useEffect, useState, useRef } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { motion, useInView } from 'framer-motion'
import {
  ShieldCheck, TrendingUp, Users, Award, ArrowRight,
  Star, ChevronRight, Lock, BadgeCheck, Leaf
} from 'lucide-react'

// Animated counter — draws attention to social proof numbers
function CountUp({ end, duration = 2000, prefix = '', suffix = '' }: {
  end: number; duration?: number; prefix?: string; suffix?: string
}) {
  const [count, setCount] = useState(0)
  const ref = useRef<HTMLSpanElement>(null)
  const inView = useInView(ref, { once: true })

  useEffect(() => {
    if (!inView) return
    const start = Date.now()
    const timer = setInterval(() => {
      const elapsed = Date.now() - start
      const progress = Math.min(elapsed / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3)
      setCount(Math.round(eased * end))
      if (progress === 1) clearInterval(timer)
    }, 16)
    return () => clearInterval(timer)
  }, [inView, end, duration])

  return <span ref={ref}>{prefix}{count.toLocaleString()}{suffix}</span>
}

const SOCIAL_STATS = [
  { label: 'Investors', value: 4700, suffix: '+', icon: Users },
  { label: 'Total Invested', value: 12, prefix: 'GHS ', suffix: 'M+', icon: TrendingUp },
  { label: 'Dividends Paid', value: 1.4, prefix: 'GHS ', suffix: 'M', icon: Award },
  { label: 'Years of Trust', value: 32, suffix: '', icon: Star },
]

const FEATURES = [
  { icon: ShieldCheck, title: 'Bank-Grade Security', desc: 'Military-level encryption, dual-control approvals, and AI threat monitoring protect every transaction.' },
  { icon: TrendingUp, title: 'Growing Returns', desc: 'Earn up to 15% annual dividends. Watch your wealth grow quarter by quarter.' },
  { icon: Award, title: 'Official Certificates', desc: 'Receive a legally valid share certificate for every purchase — yours forever, downloadable anytime.' },
  { icon: Leaf, title: 'Community-First Banking', desc: 'Your investment directly powers local communities, agriculture, and small businesses in Ghana.' },
]

const TESTIMONIALS = [
  { name: 'Abena K.', role: 'Teacher, Kumasi', text: 'I started with GHS 200 and now have over 2,000 shares. The dividends are real!', rating: 5 },
  { name: 'Kweku A.', role: 'Trader, Accra', text: 'The app is so simple. I bought shares for my kids\' future in minutes from my phone.', rating: 5 },
  { name: 'Afia M.', role: 'Nurse, Takoradi', text: 'I never thought investing was for me. Kwamnan made it easy and I trust them completely.', rating: 5 },
]

const STEPS = [
  { num: '01', title: 'Register in 3 minutes', desc: 'Quick sign-up with your Ghana Card or passport' },
  { num: '02', title: 'Choose your shares', desc: 'Select from ordinary or preference shares starting at GHS 200' },
  { num: '03', title: 'Pay securely', desc: 'MTN MoMo, Vodafone Cash, Visa or Mastercard accepted' },
  { num: '04', title: 'Get your certificate', desc: 'Download your official share certificate instantly' },
]

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-brand-cream overflow-x-hidden">
      {/* ── Nav ─────────────────────────────────────────── */}
      <nav className="fixed top-0 w-full z-50 bg-white/95 backdrop-blur border-b border-brand-green-100 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 flex items-center justify-between h-16">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-brand-green-900 rounded-xl flex items-center justify-center">
              <span className="text-brand-gold-500 font-bold text-lg">K</span>
            </div>
            <div>
              <div className="font-bold text-brand-green-900 leading-tight text-sm">KWAMNAN RURAL BANK</div>
              <div className="text-xs text-brand-gold-600 font-medium">Share Investment Portal</div>
            </div>
          </div>
          <div className="hidden md:flex items-center gap-6 text-sm font-medium text-gray-600">
            <a href="#how-it-works" className="hover:text-brand-green-900 transition-colors">How It Works</a>
            <a href="#why-invest" className="hover:text-brand-green-900 transition-colors">Why Invest</a>
            <a href="#testimonials" className="hover:text-brand-green-900 transition-colors">Testimonials</a>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/login" className="btn-outline text-sm py-2 px-4">Sign In</Link>
            <Link href="/register" className="btn-primary text-sm py-2 px-4">Start Investing</Link>
          </div>
        </div>
      </nav>

      {/* ── Hero ────────────────────────────────────────── */}
      <section className="pt-24 pb-16 bg-hero-gradient relative overflow-hidden">
        {/* Decorative circles */}
        <div className="absolute top-10 right-10 w-96 h-96 rounded-full bg-brand-gold-500 opacity-5 blur-3xl" />
        <div className="absolute bottom-0 left-0 w-64 h-64 rounded-full bg-white opacity-5 blur-2xl" />

        <div className="max-w-7xl mx-auto px-4 sm:px-6 grid md:grid-cols-2 gap-12 items-center">
          <motion.div initial={{ opacity: 0, x: -30 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.7 }}>
            {/* Trust badge */}
            <div className="inline-flex items-center gap-2 bg-white/10 rounded-full px-4 py-2 mb-6">
              <BadgeCheck size={16} className="text-brand-gold-400" />
              <span className="text-white/90 text-sm font-medium">Licensed by Bank of Ghana • Est. 1992</span>
            </div>

            <h1 className="text-4xl md:text-5xl lg:text-6xl font-serif font-bold text-white leading-tight mb-6">
              Grow Your{' '}
              <span className="text-brand-gold-400">Wealth</span>{' '}
              With Every Cedi
            </h1>

            <p className="text-white/80 text-lg mb-8 leading-relaxed">
              Join over 4,700 Ghanaians investing in Kwamnan Rural Bank shares.
              Earn up to <strong className="text-brand-gold-400">15% annual dividends</strong> from
              just GHS 200. Your community, your bank, your future.
            </p>

            {/* Urgency + social proof */}
            <div className="flex items-center gap-2 mb-8 bg-white/10 rounded-xl px-4 py-3">
              <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              <span className="text-white/90 text-sm">
                <strong className="text-white">127 investors</strong> joined this month — limited shares remaining
              </span>
            </div>

            <div className="flex flex-col sm:flex-row gap-4">
              <Link href="/register" className="btn-gold text-center">
                Start with GHS 200 <ArrowRight size={18} className="inline ml-1" />
              </Link>
              <Link href="/login" className="btn-outline border-white/40 text-white hover:bg-white hover:text-brand-green-900 text-center">
                I have an account
              </Link>
            </div>

            {/* Trust indicators */}
            <div className="flex flex-wrap gap-4 mt-6">
              {['Bank of Ghana Licensed', '256-bit SSL Secured', 'TOTP Protected'].map(t => (
                <div key={t} className="trust-badge text-white/70">
                  <Lock size={13} /> <span className="text-xs">{t}</span>
                </div>
              ))}
            </div>
          </motion.div>

          {/* Hero visual — investment card */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.2 }}
            className="relative"
          >
            {/* Share certificate preview */}
            <div className="bg-white rounded-3xl shadow-2xl p-8 border-4 border-brand-gold-500/30">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wider">SHARE CERTIFICATE</p>
                  <p className="font-bold text-brand-green-900 text-lg">Ordinary Shares Class A</p>
                </div>
                <div className="w-12 h-12 bg-brand-green-900 rounded-xl flex items-center justify-center">
                  <span className="text-brand-gold-500 font-bold">K</span>
                </div>
              </div>

              <div className="bg-brand-cream rounded-xl p-4 mb-4">
                <p className="text-xs text-gray-500 mb-1">Certificate Holder</p>
                <p className="font-semibold text-brand-charcoal">Yaa Asantewaa</p>
                <p className="text-xs text-gray-400">KRB-2024-04721</p>
              </div>

              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="bg-brand-green-900 rounded-xl p-3 text-white">
                  <p className="text-xs opacity-70 mb-1">Units Held</p>
                  <p className="text-2xl font-bold text-brand-gold-400">1,500</p>
                </div>
                <div className="border border-brand-gold-300 rounded-xl p-3">
                  <p className="text-xs text-gray-500 mb-1">Annual Dividend</p>
                  <p className="text-2xl font-bold text-brand-green-900">12.5%</p>
                </div>
              </div>

              <div className="flex items-center justify-between text-xs text-gray-500">
                <span>Issued: Jan 15, 2024</span>
                <span className="flex items-center gap-1 text-green-600 font-medium">
                  <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                  Active
                </span>
              </div>
            </div>
          </motion.div>
        </div>

        {/* Stats bar */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 mt-16">
          <div className="bg-white/10 backdrop-blur rounded-2xl p-6 grid grid-cols-2 md:grid-cols-4 gap-6">
            {SOCIAL_STATS.map(({ label, value, prefix = '', suffix, icon: Icon }) => (
              <div key={label} className="text-center">
                <Icon size={20} className="text-brand-gold-400 mx-auto mb-2" />
                <p className="text-2xl md:text-3xl font-bold text-white">
                  <CountUp end={value} prefix={prefix} suffix={suffix} />
                </p>
                <p className="text-white/60 text-sm">{label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How It Works ─────────────────────────────────── */}
      <section id="how-it-works" className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-14">
            <h2 className="text-3xl md:text-4xl font-serif font-bold text-brand-green-900 mb-3">
              Start Investing in 4 Simple Steps
            </h2>
            <p className="text-gray-500 max-w-xl mx-auto">
              No complexity, no confusion. We've built the simplest share investment experience in Ghana.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {STEPS.map((step, i) => (
              <motion.div
                key={step.num}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
                className="relative card text-center group hover:border-brand-green-200 transition-all"
              >
                <div className="text-5xl font-bold text-brand-green-900 opacity-10 mb-3 font-serif">{step.num}</div>
                <h3 className="font-semibold text-brand-charcoal mb-2">{step.title}</h3>
                <p className="text-gray-500 text-sm">{step.desc}</p>
                {i < 3 && (
                  <ChevronRight className="hidden lg:block absolute -right-3 top-1/2 -translate-y-1/2 text-brand-gold-400" size={20} />
                )}
              </motion.div>
            ))}
          </div>
          <div className="text-center mt-10">
            <Link href="/register" className="btn-primary inline-flex items-center gap-2">
              Open Your Account Now <ArrowRight size={18} />
            </Link>
          </div>
        </div>
      </section>

      {/* ── Why Invest ──────────────────────────────────── */}
      <section id="why-invest" className="py-20 bg-brand-cream">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-14">
            <h2 className="text-3xl md:text-4xl font-serif font-bold text-brand-green-900 mb-3">
              Why Thousands Choose Kwamnan
            </h2>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {FEATURES.map((f, i) => (
              <motion.div
                key={f.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
                className="card group hover:shadow-card-hover transition-all"
              >
                <div className="w-12 h-12 bg-brand-green-50 rounded-xl flex items-center justify-center mb-4 group-hover:bg-brand-green-900 transition-colors">
                  <f.icon size={22} className="text-brand-green-900 group-hover:text-brand-gold-400 transition-colors" />
                </div>
                <h3 className="font-semibold text-brand-charcoal mb-2">{f.title}</h3>
                <p className="text-gray-500 text-sm leading-relaxed">{f.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Testimonials ─────────────────────────────────── */}
      <section id="testimonials" className="py-20 bg-brand-green-900 relative overflow-hidden">
        <div className="absolute inset-0 opacity-5">
          <div className="absolute top-0 right-0 w-96 h-96 rounded-full bg-brand-gold-500 blur-3xl" />
        </div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 relative">
          <h2 className="text-3xl md:text-4xl font-serif font-bold text-white text-center mb-14">
            Real Stories from Real Investors
          </h2>
          <div className="grid md:grid-cols-3 gap-6">
            {TESTIMONIALS.map((t, i) => (
              <motion.div
                key={t.name}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
                className="bg-white/10 backdrop-blur rounded-2xl p-6"
              >
                <div className="flex gap-1 mb-4">
                  {Array(t.rating).fill(0).map((_, j) => (
                    <Star key={j} size={16} className="text-brand-gold-400 fill-brand-gold-400" />
                  ))}
                </div>
                <p className="text-white/90 text-sm leading-relaxed mb-4">"{t.text}"</p>
                <div>
                  <p className="text-white font-semibold text-sm">{t.name}</p>
                  <p className="text-white/50 text-xs">{t.role}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ─────────────────────────────────────────── */}
      <section className="py-20 bg-gold-gradient">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 text-center">
          <h2 className="text-3xl md:text-4xl font-serif font-bold text-brand-charcoal mb-4">
            Your wealth starts with GHS 200
          </h2>
          <p className="text-brand-charcoal/70 mb-8 text-lg">
            Every great investor started small. Open your account today and begin your journey to financial freedom.
          </p>
          <Link href="/register" className="inline-flex items-center gap-2 bg-brand-green-900 hover:bg-brand-green-800 text-white font-bold px-8 py-4 rounded-2xl transition-all shadow-lg hover:shadow-xl active:scale-95 text-lg">
            Create Free Account <ArrowRight size={20} />
          </Link>
          <p className="text-brand-charcoal/50 text-sm mt-4">No hidden fees • Secure & regulated • Cancel anytime</p>
        </div>
      </section>

      {/* ── Footer ──────────────────────────────────────── */}
      <footer className="bg-brand-charcoal text-white/60 py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex flex-col md:flex-row justify-between gap-8 mb-8">
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 bg-brand-green-900 rounded-lg flex items-center justify-center">
                  <span className="text-brand-gold-500 font-bold">K</span>
                </div>
                <span className="text-white font-semibold">Kwamnan Rural Bank</span>
              </div>
              <p className="text-sm max-w-xs">Licensed by the Bank of Ghana. Regulated under the Companies Act 2019 (Act 992).</p>
            </div>
            <div className="flex gap-12 text-sm">
              <div>
                <p className="text-white font-medium mb-3">Platform</p>
                <ul className="space-y-2">
                  {['Invest', 'Portfolio', 'Dividends', 'Certificates'].map(l => (
                    <li key={l}><a href="#" className="hover:text-white transition-colors">{l}</a></li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="text-white font-medium mb-3">Support</p>
                <ul className="space-y-2">
                  {['Contact Us', 'FAQ', 'Privacy Policy', 'Terms'].map(l => (
                    <li key={l}><a href="#" className="hover:text-white transition-colors">{l}</a></li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
          <div className="border-t border-white/10 pt-6 text-center text-sm">
            © 2024 Kwamnan Rural Bank Limited. All rights reserved. Share investments carry risk.
            Past performance is not a guarantee of future returns.
          </div>
        </div>
      </footer>
    </div>
  )
}
