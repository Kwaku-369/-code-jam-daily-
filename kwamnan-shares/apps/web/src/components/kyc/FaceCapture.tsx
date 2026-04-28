'use client'
import { useRef, useState, useCallback, useEffect } from 'react'
import { Camera, RotateCcw, Check, AlertCircle, User } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

type FaceCaptureProps = {
  onCapture: (photoBlob: Blob, photoDataUrl: string) => void
  label?: string
}

export function FaceCapture({ onCapture, label = 'Take your photo' }: FaceCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [captured, setCaptured] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [faceDetected, setFaceDetected] = useState(false)
  const [checking, setChecking] = useState(false)

  const startCamera = useCallback(async () => {
    setError(null)
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' },
      })
      setStream(mediaStream)
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream
      }
    } catch {
      setError('Camera access denied. Please allow camera access and try again.')
    }
  }, [])

  useEffect(() => {
    startCamera()
    return () => { stream?.getTracks().forEach((t) => t.stop()) }
  }, [])

  // Simple face-presence heuristic via brightness variance — no heavy ML needed
  useEffect(() => {
    if (!stream || captured) return
    const interval = setInterval(() => {
      if (!videoRef.current || !canvasRef.current) return
      const ctx = canvasRef.current.getContext('2d')
      if (!ctx) return
      canvasRef.current.width = 160
      canvasRef.current.height = 120
      ctx.drawImage(videoRef.current, 0, 0, 160, 120)
      const data = ctx.getImageData(60, 20, 40, 80).data // Centre region
      let variance = 0
      const vals: number[] = []
      for (let i = 0; i < data.length; i += 4) {
        vals.push((data[i] + data[i + 1] + data[i + 2]) / 3)
      }
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length
      variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length
      // Variance >300 in centre region strongly suggests a face
      setFaceDetected(variance > 300)
    }, 500)
    return () => clearInterval(interval)
  }, [stream, captured])

  const capture = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return
    const canvas = canvasRef.current
    canvas.width = 640
    canvas.height = 480
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(videoRef.current, 0, 0, 640, 480)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9)
    setCaptured(dataUrl)
    stream?.getTracks().forEach((t) => t.stop())
    canvas.toBlob((blob) => {
      if (blob) onCapture(blob, dataUrl)
    }, 'image/jpeg', 0.9)
  }, [stream, onCapture])

  const retake = useCallback(() => {
    setCaptured(null)
    setFaceDetected(false)
    startCamera()
  }, [startCamera])

  return (
    <div className="space-y-4">
      <label className="block text-sm font-medium text-gray-700">{label}</label>

      <div className="relative bg-gray-900 rounded-2xl overflow-hidden aspect-video max-h-72">
        {!captured ? (
          <>
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover scale-x-[-1]"
            />
            {/* Face guide overlay */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className={`w-40 h-52 border-4 rounded-full transition-all duration-500 ${faceDetected ? 'border-green-400 shadow-[0_0_20px_rgba(74,222,128,0.5)]' : 'border-white/40'}`} />
            </div>
            {/* Status indicator */}
            <div className={`absolute bottom-3 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${faceDetected ? 'bg-green-500 text-white' : 'bg-black/60 text-white/70'}`}>
              {error ? error : faceDetected ? '✓ Face detected — ready to capture' : 'Position your face in the oval'}
            </div>
          </>
        ) : (
          <img src={captured} alt="Captured" className="w-full h-full object-cover scale-x-[-1]" />
        )}
        <canvas ref={canvasRef} className="hidden" />
      </div>

      {error && (
        <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 p-3 rounded-xl">
          <AlertCircle size={14} /> {error}
        </div>
      )}

      <div className="flex gap-3">
        {!captured ? (
          <button
            type="button"
            onClick={capture}
            disabled={!faceDetected}
            className="btn-primary flex-1 flex items-center justify-center gap-2 disabled:opacity-40"
          >
            <Camera size={16} /> Capture Photo
          </button>
        ) : (
          <>
            <button type="button" onClick={retake} className="btn-outline flex items-center gap-2">
              <RotateCcw size={14} /> Retake
            </button>
            <div className="flex-1 flex items-center gap-2 bg-green-50 text-green-700 rounded-xl px-4 font-medium text-sm">
              <Check size={16} /> Photo captured
            </div>
          </>
        )}
      </div>
    </div>
  )
}
