'use client'
import { useState, useCallback, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { MessageCircle, X, Send, Mic, MicOff, Globe, ChevronDown, ThumbsUp, ThumbsDown, Meh, Star } from 'lucide-react'
import toast from 'react-hot-toast'
import { createClient } from '@/lib/supabase'

// ─── Multilingual UI strings ────────────────────────────────────────────────
const LANGUAGES: Record<string, { label: string; native: string; strings: LangStrings }> = {
  en: {
    label: 'English',
    native: 'English',
    strings: {
      trigger: 'Share your feedback',
      title: 'How are we doing?',
      subtitle: 'Your feedback helps us serve you better',
      placeholder: 'Tell us your experience… (type or tap the mic)',
      send: 'Send Feedback',
      sending: 'Sending…',
      thanks: 'Thank you! We read every message.',
      sentiment_question: 'How was your experience today?',
      ratingLabels: ['Terrible', 'Bad', 'Okay', 'Good', 'Excellent'],
      voiceHint: 'Tap mic and speak in any language — we understand you',
      selectLang: 'Your language',
    },
  },
  tw: {
    label: 'Twi',
    native: 'Twi',
    strings: {
      trigger: 'Ka wo adwene',
      title: 'Yɛde wo ho te sɛn?',
      subtitle: 'Wo adwene bo yɛn mmoa na yɛnsoma wo yiye',
      placeholder: 'Ka amanneɛ a wo wɔ ho… (kyerɛw anaasɛ kasa wɔ microphone mu)',
      send: 'Fa wo adwene kɔ',
      sending: 'Rekyerɛkyerɛ…',
      thanks: 'Meda wo ase! Yɛkenkan nsɛm biara.',
      sentiment_question: 'Ɛnnɛ asɛm no tee wo sɛn?',
      ratingLabels: ['Dɛn', 'Nso', 'Saa', 'Papa', 'Papaapa'],
      voiceHint: 'Kasa wɔ kasa biara mu — yɛte wo',
      selectLang: 'Wo kasa',
    },
  },
  ga: {
    label: 'Ga',
    native: 'Gã',
    strings: {
      trigger: 'Hɛ wo shia',
      title: 'Mli niŋ yɛ bo?',
      subtitle: 'Wo shia ko yɛ ji bo wolo',
      placeholder: 'Hɛ ŋmɛi ni wolo…',
      send: 'Tɔŋ wo shia',
      sending: 'Tɔŋŋ…',
      thanks: 'Oyiwaladon! Yɛ bɛ wolo ŋmɛi.',
      sentiment_question: 'Mli niŋ yɛ bo gbɔ?',
      ratingLabels: ['Gbɛɛ', 'Ŋmɛi', 'Kɛŋ', 'Feo', 'Feo pɔŋ'],
      voiceHint: 'Hɛ kɛ kɔba — yɛ tee wo',
      selectLang: 'Wo kɔba',
    },
  },
  dag: {
    label: 'Dagbani',
    native: 'Dagbani',
    strings: {
      trigger: 'Pihi n nyɛ ni fɔŋ',
      title: 'A be di wula?',
      subtitle: 'A fɔŋ saa yi ka yi daa ti',
      placeholder: 'Pihi n nyɛ a fɔŋ…',
      send: 'Di a fɔŋ kɔ',
      sending: 'Di yɛ…',
      thanks: 'Naa, ti pam! Ti kuli a nyɛri biɛlim.',
      sentiment_question: 'A ni yuli wɔli n bi?',
      ratingLabels: ['Ku', 'Ni', 'Sɔŋ', 'Naa', 'Naa pam'],
      voiceHint: 'Kɔ kuli yaɣa — ti nini a',
      selectLang: 'A nyɛri',
    },
  },
  ee: {
    label: 'Ewe',
    native: 'Eʋegbe',
    strings: {
      trigger: 'Na wò susu',
      title: 'Aleke míle miɖo ŋu?',
      subtitle: 'Wò susu na mí ɖe mía dɔwɔwɔ ŋu',
      placeholder: 'Gblɔ wò susu…',
      send: 'Ɖo wò susu',
      sending: 'Ɖo la…',
      thanks: 'Akpe! Míle dea nudowo to ŋu.',
      sentiment_question: 'Aleke wò ʋuʋoʋo le egbe?',
      ratingLabels: ['Dzetugbe', 'Katsatsa', 'Ɖo-ɖo', 'Nyo', 'Nyo nyonyo'],
      voiceHint: 'Gblɔ gbe siàwo — míle mía to',
      selectLang: 'Wò gbe',
    },
  },
}

type LangStrings = {
  trigger: string
  title: string
  subtitle: string
  placeholder: string
  send: string
  sending: string
  thanks: string
  sentiment_question: string
  ratingLabels: string[]
  voiceHint: string
  selectLang: string
}

type FeedbackData = {
  rating: number | null
  message: string
  language: string
  page_path: string
  sentiment: 'positive' | 'neutral' | 'negative' | null
  voice_used: boolean
}

// ─── Star Rating ─────────────────────────────────────────────────────────────
function StarRating({ value, onChange, labels }: { value: number | null; onChange: (n: number) => void; labels: string[] }) {
  const [hovered, setHovered] = useState<number | null>(null)
  return (
    <div className="flex gap-1 justify-center">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          title={labels[n - 1]}
          onMouseEnter={() => setHovered(n)}
          onMouseLeave={() => setHovered(null)}
          onClick={() => onChange(n)}
          className="transition-transform hover:scale-110"
        >
          <Star
            size={28}
            className={`transition-colors ${(hovered ?? value ?? 0) >= n ? 'fill-brand-gold-500 text-brand-gold-500' : 'text-gray-300'}`}
          />
        </button>
      ))}
    </div>
  )
}

// ─── Quick sentiment buttons ──────────────────────────────────────────────────
const SENTIMENTS = [
  { key: 'negative' as const, Icon: ThumbsDown, label: '👎', color: 'text-red-500 hover:bg-red-50' },
  { key: 'neutral' as const, Icon: Meh, label: '😐', color: 'text-amber-500 hover:bg-amber-50' },
  { key: 'positive' as const, Icon: ThumbsUp, label: '👍', color: 'text-green-500 hover:bg-green-50' },
]

// ─── Main Widget ─────────────────────────────────────────────────────────────
export function FeedbackWidget() {
  const [open, setOpen] = useState(false)
  const [lang, setLang] = useState<keyof typeof LANGUAGES>('en')
  const [showLangPicker, setShowLangPicker] = useState(false)
  const [rating, setRating] = useState<number | null>(null)
  const [sentiment, setSentiment] = useState<FeedbackData['sentiment']>(null)
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [recording, setRecording] = useState(false)
  const [voiceUsed, setVoiceUsed] = useState(false)
  const recognitionRef = useRef<any>(null)
  const t = LANGUAGES[lang].strings

  // Detect browser language on mount and set closest match
  useEffect(() => {
    const browserLang = navigator.language?.toLowerCase() ?? ''
    if (browserLang.startsWith('tw') || browserLang.includes('twi')) setLang('tw')
    else if (browserLang.startsWith('ee') || browserLang.includes('ewe')) setLang('ee')
    else if (browserLang.startsWith('dag')) setLang('dag')
    else if (browserLang.startsWith('gaa') || browserLang.startsWith('gag')) setLang('ga')
    // default: English
  }, [])

  const startVoice = useCallback(() => {
    const w = window as any
    const SpeechRecognition = w.SpeechRecognition ?? w.webkitSpeechRecognition

    if (!SpeechRecognition) {
      toast.error('Voice input not supported in this browser.')
      return
    }
    const recognition = new SpeechRecognition()
    // Use multilingual recognition — browser attempts all configured languages
    recognition.lang = lang === 'en' ? 'en-GH' : lang === 'tw' ? 'ak-GH' : 'en-GH'
    recognition.continuous = false
    recognition.interimResults = true

    recognition.onresult = (e: any) => {
      const transcript = Array.from(e.results as ArrayLike<any>)
        .map((r: any) => r[0].transcript)
        .join('')
      setMessage(transcript)
    }
    recognition.onend = () => setRecording(false)
    recognition.onerror = () => {
      setRecording(false)
      toast.error('Could not capture voice. Please type your message.')
    }

    recognition.start()
    recognitionRef.current = recognition
    setRecording(true)
    setVoiceUsed(true)
  }, [lang])

  const stopVoice = useCallback(() => {
    recognitionRef.current?.stop()
    setRecording(false)
  }, [])

  const reset = useCallback(() => {
    setRating(null)
    setSentiment(null)
    setMessage('')
    setSent(false)
    setVoiceUsed(false)
  }, [])

  const submit = useCallback(async () => {
    if (!rating && !message.trim() && !sentiment) {
      toast.error('Please share at least a rating or a message')
      return
    }
    setSending(true)
    try {
      const supabase = createClient()
      const { error } = await supabase.from('feedback').insert({
        rating,
        message: message.trim() || null,
        language: lang,
        page_path: window.location.pathname,
        sentiment,
        voice_used: voiceUsed,
      })
      if (error) throw error
      setSent(true)
      setTimeout(() => { setOpen(false); reset() }, 3000)
    } catch {
      toast.error('Could not save feedback. Please try again.')
    } finally {
      setSending(false)
    }
  }, [rating, message, lang, sentiment, voiceUsed, reset])

  return (
    <>
      {/* Floating trigger button */}
      <AnimatePresence>
        {!open && (
          <motion.button
            key="fab"
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            onClick={() => setOpen(true)}
            className="fixed bottom-6 right-6 z-50 flex items-center gap-2 bg-brand-green-900 text-white px-4 py-3 rounded-full shadow-xl hover:bg-brand-green-700 transition-all group"
          >
            <MessageCircle size={18} />
            <span className="text-sm font-medium max-w-0 overflow-hidden group-hover:max-w-xs transition-all duration-300 whitespace-nowrap">
              {t.trigger}
            </span>
          </motion.button>
        )}
      </AnimatePresence>

      {/* Feedback panel */}
      <AnimatePresence>
        {open && (
          <motion.div
            key="panel"
            initial={{ opacity: 0, y: 40, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 40, scale: 0.95 }}
            className="fixed bottom-6 right-6 z-50 w-[340px] max-w-[calc(100vw-2rem)] bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden"
          >
            {/* Header */}
            <div className="bg-brand-green-900 px-5 py-4 flex items-start justify-between">
              <div>
                <h3 className="text-white font-bold text-base">{t.title}</h3>
                <p className="text-green-200 text-xs mt-0.5">{t.subtitle}</p>
              </div>
              <button onClick={() => { setOpen(false); reset() }} className="text-green-300 hover:text-white transition-colors ml-3 mt-0.5">
                <X size={18} />
              </button>
            </div>

            {sent ? (
              <div className="p-8 text-center">
                <div className="text-4xl mb-3">🙏</div>
                <p className="font-semibold text-brand-green-900 text-lg">{t.thanks}</p>
              </div>
            ) : (
              <div className="p-5 space-y-4">
                {/* Language picker */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setShowLangPicker((v) => !v)}
                    className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-brand-green-700 transition-colors"
                  >
                    <Globe size={13} />
                    <span>{t.selectLang}: <strong>{LANGUAGES[lang].native}</strong></span>
                    <ChevronDown size={12} className={`transition-transform ${showLangPicker ? 'rotate-180' : ''}`} />
                  </button>
                  <AnimatePresence>
                    {showLangPicker && (
                      <motion.div
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        className="absolute top-full mt-1 left-0 bg-white border border-gray-200 rounded-xl shadow-lg z-10 overflow-hidden"
                      >
                        {Object.entries(LANGUAGES).map(([code, { native, label }]) => (
                          <button
                            key={code}
                            type="button"
                            onClick={() => { setLang(code as keyof typeof LANGUAGES); setShowLangPicker(false) }}
                            className={`w-full text-left px-4 py-2.5 text-sm hover:bg-brand-cream transition-colors flex items-center gap-2
                              ${lang === code ? 'bg-brand-green-50 text-brand-green-900 font-medium' : 'text-gray-700'}`}
                          >
                            <span>{native}</span>
                            {lang !== code && <span className="text-gray-400 text-xs">({label})</span>}
                          </button>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Quick sentiment */}
                <div>
                  <p className="text-xs text-gray-500 mb-2 font-medium">{t.sentiment_question}</p>
                  <div className="flex gap-2">
                    {SENTIMENTS.map(({ key, Icon, color }) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setSentiment(key)}
                        className={`flex-1 py-2 rounded-xl border-2 transition-all flex items-center justify-center
                          ${sentiment === key ? 'border-brand-green-900 bg-brand-green-50' : 'border-gray-100 bg-gray-50 ' + color}`}
                      >
                        <Icon size={20} className={sentiment === key ? 'text-brand-green-900' : ''} />
                      </button>
                    ))}
                  </div>
                </div>

                {/* Star rating */}
                <div>
                  <StarRating value={rating} onChange={setRating} labels={t.ratingLabels} />
                  {rating && (
                    <p className="text-center text-xs text-brand-green-700 mt-1 font-medium">{t.ratingLabels[rating - 1]}</p>
                  )}
                </div>

                {/* Text / Voice input */}
                <div className="relative">
                  <textarea
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder={t.placeholder}
                    rows={3}
                    className="w-full text-sm border border-gray-200 rounded-xl p-3 pr-10 resize-none focus:outline-none focus:ring-2 focus:ring-brand-green-200 focus:border-brand-green-500 transition-all placeholder:text-gray-300"
                  />
                  <button
                    type="button"
                    onClick={recording ? stopVoice : startVoice}
                    title={t.voiceHint}
                    className={`absolute right-2.5 bottom-2.5 p-1.5 rounded-lg transition-all
                      ${recording ? 'bg-red-500 text-white animate-pulse' : 'text-gray-400 hover:text-brand-green-700 hover:bg-brand-green-50'}`}
                  >
                    {recording ? <MicOff size={15} /> : <Mic size={15} />}
                  </button>
                </div>
                {recording && (
                  <p className="text-xs text-red-500 flex items-center gap-1">
                    <span className="inline-block w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                    Listening… speak now
                  </p>
                )}

                <button
                  type="button"
                  onClick={submit}
                  disabled={sending}
                  className="btn-primary w-full flex items-center justify-center gap-2 text-sm"
                >
                  {sending ? t.sending : <><Send size={14} /> {t.send}</>}
                </button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
