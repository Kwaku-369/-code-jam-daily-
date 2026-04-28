import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import { Toaster } from 'react-hot-toast'
import '../styles/globals.css'

const inter = Inter({ subsets: ['latin'], display: 'swap' })

export const metadata: Metadata = {
  title: { default: 'Kwamnan Rural Bank | Share Investment', template: '%s | Kwamnan Shares' },
  description: 'Invest in Kwamnan Rural Bank shares. Build wealth for your future with Ghana\'s trusted community bank. Simple, secure share ownership from GHS 200.',
  keywords: ['shares', 'investment', 'Ghana', 'rural bank', 'Kwamnan', 'stock', 'dividend'],
  openGraph: {
    title: 'Kwamnan Rural Bank Share Investment',
    description: 'Build your wealth with Kwamnan Rural Bank shares. Trusted by thousands of Ghanaians.',
    locale: 'en_GH',
    type: 'website',
  },
  robots: { index: true, follow: true },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#1A5C38',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700&display=swap" rel="stylesheet" />
      </head>
      <body className={inter.className}>
        {children}
        <Toaster
          position="top-right"
          toastOptions={{
            duration: 4000,
            style: {
              background: '#1A5C38',
              color: '#fff',
              borderRadius: '12px',
              fontFamily: 'Inter, sans-serif',
            },
            success: { iconTheme: { primary: '#D4AF37', secondary: '#fff' } },
            error: { style: { background: '#dc2626' } },
          }}
        />
      </body>
    </html>
  )
}
