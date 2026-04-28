import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: ['class'],
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Kwamnan Rural Bank brand palette
        brand: {
          green: {
            50:  '#e8f4ed',
            100: '#c5e4d0',
            200: '#9fd3b1',
            300: '#72c190',
            400: '#4eb376',
            500: '#2aa45c',
            600: '#1d9451',
            700: '#147f43',
            800: '#0c6a36',
            900: '#1A5C38', // Primary forest green
            950: '#0d3a22',
          },
          gold: {
            50:  '#fdf9eb',
            100: '#f9f0c8',
            200: '#f5e48e',
            300: '#f0d354',
            400: '#e8c02e',
            500: '#D4AF37', // Primary gold
            600: '#b8941c',
            700: '#9a7614',
            800: '#7d5e10',
            900: '#674e0d',
          },
          earth: '#8B4513',
          cream: '#FAFAF7',
          charcoal: '#1C1C1C',
        },
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        serif: ['Playfair Display', 'Georgia', 'serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      backgroundImage: {
        'hero-gradient': 'linear-gradient(135deg, #1A5C38 0%, #0d3a22 50%, #1A5C38 100%)',
        'gold-gradient': 'linear-gradient(135deg, #D4AF37, #f0d354, #b8941c)',
        'green-gradient': 'linear-gradient(180deg, #1A5C38 0%, #147f43 100%)',
        'card-gradient': 'linear-gradient(145deg, rgba(26,92,56,0.05) 0%, rgba(212,175,55,0.05) 100%)',
      },
      animation: {
        'fade-in': 'fadeIn 0.6s ease-out',
        'slide-up': 'slideUp 0.5s ease-out',
        'slide-in': 'slideIn 0.4s ease-out',
        'pulse-gold': 'pulseGold 2s infinite',
        'count-up': 'countUp 1s ease-out',
        'shimmer': 'shimmer 2s infinite',
      },
      keyframes: {
        fadeIn: { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        slideUp: { '0%': { opacity: '0', transform: 'translateY(20px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
        slideIn: { '0%': { opacity: '0', transform: 'translateX(-20px)' }, '100%': { opacity: '1', transform: 'translateX(0)' } },
        pulseGold: { '0%,100%': { boxShadow: '0 0 0 0 rgba(212,175,55,0.4)' }, '50%': { boxShadow: '0 0 0 8px rgba(212,175,55,0)' } },
        shimmer: { '0%': { backgroundPosition: '-1000px 0' }, '100%': { backgroundPosition: '1000px 0' } },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      boxShadow: {
        'card': '0 4px 24px rgba(26, 92, 56, 0.08)',
        'card-hover': '0 8px 40px rgba(26, 92, 56, 0.15)',
        'gold': '0 4px 20px rgba(212, 175, 55, 0.25)',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
}
export default config
