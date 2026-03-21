import { useRoomStore } from '../stores/roomStore'
import { useStreamStore } from '../stores/streamStore'

export function StatusBar() {
  const roomState = useRoomStore((s) => s.state)
  const reconnecting = useRoomStore((s) => s.reconnecting)
  const streamState = useStreamStore((s) => s.state)
  const streamError = useStreamStore((s) => s.error)

  const roomColor = {
    NOT_CONNECTED: 'bg-slate-500',
    CONNECTING: 'bg-yellow-500',
    CONNECTED: 'bg-green-500',
    DISCONNECTED: 'bg-red-500',
  }[roomState]

  const streamColor = {
    IDLE: 'bg-slate-500',
    PROVISIONING: 'bg-yellow-500',
    AWAITING_STREAM: 'bg-yellow-500',
    LIVE: 'bg-red-500',
    STOPPING: 'bg-yellow-500',
    FAILED: 'bg-red-700',
  }[streamState]

  return (
    <div className="h-10 flex items-center px-4 border-t border-slate-700/50 gap-4 text-sm">
      <span className="text-slate-400">corvoicer</span>
      <div className="flex items-center gap-1.5">
        <span className={`w-2 h-2 rounded-full ${roomColor}`} />
        <span className="text-slate-400">{roomState.toLowerCase().replace('_', ' ')}</span>
      </div>
      {reconnecting && (
        <span className="text-yellow-400 animate-pulse">Reconnecting...</span>
      )}
      {roomState === 'CONNECTED' && streamState !== 'IDLE' && (
        <div className="flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full ${streamColor} ${streamState === 'LIVE' ? 'animate-pulse' : ''}`} />
          <span className="text-slate-400">{streamState.toLowerCase()}</span>
        </div>
      )}
      {streamError && (
        <span className="text-red-400 text-xs ml-2">{streamError}</span>
      )}
    </div>
  )
}
