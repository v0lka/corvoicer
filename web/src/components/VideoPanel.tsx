import { useEffect, useRef, useState } from 'react'
import type { RemoteTrack } from 'livekit-client'
import { logger } from '../utils/logger'

interface Props {
  streamTrack: RemoteTrack | null
  streamAudioTrack?: RemoteTrack | null
}

export function VideoPanel({ streamTrack, streamAudioTrack }: Props) {
  const videoRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [volume, setVolume] = useState(() => {
    const saved = localStorage.getItem('corvoicer-volume')
    return saved ? parseFloat(saved) : 1.0
  })
  const [audioBlocked, setAudioBlocked] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)

  useEffect(() => {
    if (!videoRef.current) return

    // Handle video track
    if (streamTrack) {
      const el = streamTrack.attach()
      el.style.width = '100%'
      el.style.height = '100%'
      el.style.objectFit = 'contain'
      if (el instanceof HTMLVideoElement) {
        el.volume = volume
        // Disable native controls and context menu
        el.controls = false
        el.oncontextmenu = (e) => e.preventDefault()
      }
      videoRef.current.innerHTML = ''
      videoRef.current.appendChild(el)
    } else {
      videoRef.current.innerHTML = ''
    }

    // Handle audio track
    if (streamAudioTrack) {
      const audioEl = streamAudioTrack.attach()
      if (audioEl instanceof HTMLAudioElement) {
        audioEl.volume = volume
        audioEl.autoplay = true
        audioRef.current = audioEl
        // Add to DOM to ensure audio playback works reliably
        audioEl.style.display = 'none'
        document.body.appendChild(audioEl)

        // Try to play - this may fail due to autoplay policies until user interaction
        const tryPlay = () => {
          audioEl.play().then(() => {
            setAudioBlocked(false)
          }).catch(() => {
            setAudioBlocked(true)
          })
        }

        // Try immediately
        tryPlay()

        // Also try on first user interaction (click anywhere)
        const handleInteraction = () => {
          tryPlay()
          document.removeEventListener('click', handleInteraction)
        }
        document.addEventListener('click', handleInteraction, { once: true })
      }
    }

    return () => {
      if (streamTrack) {
        streamTrack.detach()
      }
      if (streamAudioTrack) {
        streamAudioTrack.detach()
        // Remove from DOM if we added it
        if (audioRef.current && audioRef.current.parentNode) {
          audioRef.current.parentNode.removeChild(audioRef.current)
        }
      }
    }
  }, [streamTrack, streamAudioTrack])

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value)
    setVolume(val)
    localStorage.setItem('corvoicer-volume', val.toString())

    // Apply to existing video element
    if (videoRef.current) {
      const video = videoRef.current.querySelector('video')
      if (video) {
        video.volume = val
      }
    }
    // Also update audio element volume
    if (audioRef.current) {
      audioRef.current.volume = val
    }
  }

  const toggleFullscreen = async () => {
    if (!containerRef.current) return

    try {
      if (!document.fullscreenElement) {
        await containerRef.current.requestFullscreen()
        setIsFullscreen(true)
      } else {
        await document.exitFullscreen()
        setIsFullscreen(false)
      }
    } catch (err) {
      logger.error('Fullscreen error:', err)
    }
  }

  // Listen for fullscreen changes (user pressing Esc, etc.)
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement)
    }
    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange)
  }, [])

  return (
    <div ref={containerRef} className="flex-1 flex flex-col bg-black/30 relative min-h-0">
      <div
        className="flex-1 flex items-center justify-center overflow-hidden"
        onContextMenu={(e) => e.preventDefault()}
      >
        {streamTrack ? (
          <div ref={videoRef} className="w-full h-full" />
        ) : (
          <p className="text-slate-500 text-lg">No active stream</p>
        )}
      </div>
      {streamTrack && (
        <div className="flex items-center gap-3 px-4 py-2 bg-black/50">
          <span className="text-slate-400 text-xs">Volume</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={volume}
            onChange={handleVolumeChange}
            className="w-24 h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
          />
          <span className="text-slate-400 text-xs w-8">{Math.round(volume * 100)}%</span>
          {audioBlocked && (
            <span className="text-yellow-400 text-xs ml-2">Click to enable audio</span>
          )}
          <div className="flex-1" />
          <button
            onClick={toggleFullscreen}
            className="text-slate-400 hover:text-white text-xs px-2 py-1 rounded hover:bg-white/10 transition-colors"
            title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
          >
            {isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
          </button>
        </div>
      )}
    </div>
  )
}
