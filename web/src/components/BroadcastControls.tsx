import { useCallback, useState } from 'react'
import type { StreamState, WhipInfo } from '../types'

interface Props {
  streamState: StreamState
  whipInfo: WhipInfo | null
  onStartStream: () => void
  onStopStream: () => void
  disabled: boolean
  isOwner: boolean
}

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }, [value])

  return (
    <div className="space-y-1">
      <label className="text-xs text-slate-400">{label}</label>
      <div className="flex gap-1">
        <input
          readOnly
          value={value}
          className="flex-1 bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200 font-mono select-all"
        />
        <button
          onClick={handleCopy}
          className="px-2 py-1 bg-slate-700 hover:bg-slate-600 text-xs text-slate-300 rounded shrink-0"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  )
}

export function BroadcastControls({ streamState, whipInfo, onStartStream, onStopStream, disabled, isOwner }: Props) {
  const isLive = streamState === 'LIVE'
  const isAwaiting = streamState === 'AWAITING_STREAM'
  const isBusy = streamState === 'PROVISIONING' || streamState === 'STOPPING'
  const isFailed = streamState === 'FAILED'

  // Non-owners only see status when a stream is active
  if (!isOwner && !isLive && !isAwaiting) {
    return (
      <div className="px-3 py-2 border-t border-slate-700/50">
        <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">Broadcast</span>
        <p className="text-xs text-slate-500 mt-1">No active stream</p>
      </div>
    )
  }

  return (
    <div className="px-3 py-2 border-t border-slate-700/50 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">Broadcast</span>
        {isLive && <span className="text-xs text-red-400 font-medium animate-pulse">LIVE</span>}
        {isAwaiting && <span className="text-xs text-yellow-400 font-medium">WAITING</span>}
      </div>

      {isBusy && (
        <p className="text-xs text-slate-400">
          {streamState === 'PROVISIONING' ? 'Setting up stream...' : 'Stopping...'}
        </p>
      )}

      {isAwaiting && whipInfo && (
        <div className="space-y-2">
          <p className="text-xs text-slate-400">Configure OBS with these WHIP settings:</p>
          <CopyField label="WHIP URL" value={whipInfo.whip_url} />
          <CopyField label="Bearer Token" value={whipInfo.whip_bearer_token} />
          <button
            onClick={onStopStream}
            className="w-full py-1.5 rounded text-sm font-medium bg-slate-600 hover:bg-slate-500 text-slate-200"
          >
            Cancel
          </button>
        </div>
      )}

      {isLive && (
        <button
          onClick={onStopStream}
          className="w-full py-1.5 rounded text-sm font-medium bg-red-600 hover:bg-red-700 text-white"
        >
          Stop Stream
        </button>
      )}

      {isFailed && (
        <div className="space-y-1">
          <p className="text-xs text-red-400">Stream failed</p>
          <button
            onClick={onStartStream}
            disabled={disabled}
            className="w-full py-1.5 rounded text-sm font-medium bg-slate-600 hover:bg-slate-500 text-slate-200 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Try Again
          </button>
        </div>
      )}

      {streamState === 'IDLE' && isOwner && (
        <button
          onClick={onStartStream}
          disabled={disabled}
          className="w-full py-1.5 rounded text-sm font-medium bg-green-600 hover:bg-green-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Start Stream
        </button>
      )}
    </div>
  )
}
