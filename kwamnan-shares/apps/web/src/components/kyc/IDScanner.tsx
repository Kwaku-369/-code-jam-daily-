'use client'
import { useRef, useState, useCallback } from 'react'
import { ScanLine, Upload, CheckCircle2, Loader2, RefreshCw } from 'lucide-react'
import { motion } from 'framer-motion'

export type ExtractedIDData = {
  full_name?: string
  id_number?: string
  date_of_birth?: string
  expiry_date?: string
  nationality?: string
  raw_text?: string
}

type IDScannerProps = {
  onExtract: (data: ExtractedIDData, imageUrl: string) => void
}

// Ghana Card patterns
const PATTERNS = {
  ghana_card: /GHA-\d{9}-\d/,
  passport: /[A-Z]{1,2}\d{7}/,
  voters_id: /\d{10}/,
  dob: /\b(0[1-9]|[12]\d|3[01])[\/\-\.](0[1-9]|1[0-2])[\/\-\.](19|20)\d{2}\b/,
  expiry: /\b(0[1-9]|1[0-2])[\/\-\.](20)\d{2}\b/,
}

function extractIDData(text: string): ExtractedIDData {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  const fullText = text.toUpperCase()

  let id_number: string | undefined
  const ghanaMatch = text.match(PATTERNS.ghana_card)
  const passportMatch = text.match(PATTERNS.passport)
  if (ghanaMatch) id_number = ghanaMatch[0]
  else if (passportMatch) id_number = passportMatch[0]
  else {
    const votersMatch = text.match(PATTERNS.voters_id)
    if (votersMatch) id_number = votersMatch[0]
  }

  const dobMatch = text.match(PATTERNS.dob)
  const expiryMatch = text.match(PATTERNS.expiry)

  // Try to find name — usually the longest all-caps line on Ghana Card
  let full_name: string | undefined
  const nameLines = lines.filter((l) => /^[A-Z\s]{4,}$/.test(l) && l.split(' ').length >= 2)
  if (nameLines.length > 0) full_name = nameLines[0]

  return {
    full_name,
    id_number,
    date_of_birth: dobMatch ? dobMatch[0] : undefined,
    expiry_date: expiryMatch ? expiryMatch[0] : undefined,
    nationality: fullText.includes('GHANA') ? 'Ghanaian' : undefined,
    raw_text: text,
  }
}

export function IDScanner({ onExtract }: IDScannerProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [scanning, setScanning] = useState(false)
  const [extracted, setExtracted] = useState<ExtractedIDData | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const processImage = useCallback(async (file: File) => {
    setScanning(true)
    setError(null)
    setExtracted(null)

    const url = URL.createObjectURL(file)
    setImagePreview(url)

    try {
      // Dynamic import tesseract to keep bundle lean
      const { createWorker } = await import('tesseract.js')
      const worker = await createWorker('eng', 1, {
        logger: () => {}, // Suppress verbose logs
      })

      const { data: { text } } = await worker.recognize(file)
      await worker.terminate()

      const data = extractIDData(text)
      setExtracted(data)
      onExtract(data, url)
    } catch (err) {
      setError('Could not read ID. Please try a clearer photo with good lighting.')
    } finally {
      setScanning(false)
    }
  }, [onExtract])

  const handleFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) processImage(file)
  }, [processImage])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file?.type.startsWith('image/')) processImage(file)
  }, [processImage])

  return (
    <div className="space-y-4">
      <label className="block text-sm font-medium text-gray-700">Scan ID Document</label>
      <p className="text-xs text-gray-400">
        Upload a clear photo of your Ghana Card, Passport, or Voter's ID.
        We'll automatically extract your details.
      </p>

      {/* Drop zone */}
      <div
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        onClick={() => fileInputRef.current?.click()}
        className="border-2 border-dashed border-brand-green-200 rounded-2xl p-6 text-center cursor-pointer hover:border-brand-green-500 hover:bg-brand-green-50/30 transition-all"
      >
        {imagePreview ? (
          <img src={imagePreview} alt="ID" className="max-h-40 mx-auto rounded-xl object-cover" />
        ) : (
          <div>
            <ScanLine size={32} className="text-brand-green-300 mx-auto mb-2" />
            <p className="text-sm text-gray-500">Click or drag your ID photo here</p>
            <p className="text-xs text-gray-400 mt-1">JPG, PNG — max 10MB</p>
          </div>
        )}
        <input ref={fileInputRef} type="file" accept="image/*" capture="environment" onChange={handleFile} className="hidden" />
      </div>

      {scanning && (
        <div className="flex items-center gap-3 text-brand-green-700 bg-brand-green-50 p-3 rounded-xl">
          <Loader2 size={16} className="animate-spin" />
          <span className="text-sm">Scanning ID document... this may take a few seconds</span>
        </div>
      )}

      {error && (
        <div className="bg-red-50 text-red-600 text-sm p-3 rounded-xl">{error}</div>
      )}

      {extracted && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-green-50 border border-green-200 rounded-xl p-4"
        >
          <p className="text-green-700 font-medium text-sm flex items-center gap-2 mb-3">
            <CheckCircle2 size={16} /> Information extracted — please verify
          </p>
          <div className="grid grid-cols-2 gap-3 text-sm">
            {[
              ['Full Name', extracted.full_name],
              ['ID Number', extracted.id_number],
              ['Date of Birth', extracted.date_of_birth],
              ['Expiry', extracted.expiry_date],
              ['Nationality', extracted.nationality],
            ].filter(([, v]) => v).map(([k, v]) => (
              <div key={k}>
                <p className="text-xs text-gray-500">{k}</p>
                <p className="font-medium text-brand-charcoal">{v}</p>
              </div>
            ))}
          </div>
          <button type="button" onClick={() => fileInputRef.current?.click()}
            className="mt-3 text-xs text-brand-green-700 flex items-center gap-1 hover:underline">
            <RefreshCw size={11} /> Re-scan if incorrect
          </button>
        </motion.div>
      )}
    </div>
  )
}
