import { useParticipantStore } from '../stores/participantStore'
import { useRoomStore } from '../stores/roomStore'

export function Participants() {
  const roomState = useRoomStore((s) => s.state)
  const participants = useParticipantStore((s) => Array.from(s.participants.values()))

  if (roomState !== 'CONNECTED') {
    return (
      <div className="flex-1">
        <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">Participants</span>
        <p className="text-slate-600 text-xs mt-1">Not in a room</p>
      </div>
    )
  }

  // Sort: local first, then alphabetical
  const sorted = [...participants].sort((a, b) => {
    if (a.isLocal && !b.isLocal) return -1
    if (!a.isLocal && b.isLocal) return 1
    return a.displayName.localeCompare(b.displayName)
  })

  return (
    <div className="flex-1">
      <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">
        Participants ({participants.length})
      </span>
      <ul className="mt-1 space-y-0.5">
        {sorted.map((p) => (
          <li key={p.identity} className="flex items-center gap-1.5 text-xs">
            <span
              className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                p.isSpeaking ? 'bg-green-500 animate-pulse' : 'bg-slate-600'
              }`}
            />
            <span className="text-slate-300 truncate">
              {p.displayName}
              {p.isLocal && <span className="text-slate-500 ml-1">(You)</span>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
