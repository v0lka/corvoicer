import { useCallback } from 'react'
import { useParticipantStore } from '../stores/participantStore'
import { useRoomStore } from '../stores/roomStore'
import { api } from '../services/api'
import { logger } from '../utils/logger'

// Microphone icon for unmute button
function MicIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2a3 3 0 0 1 3 3v7a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3Z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" x2="12" y1="19" y2="22" />
    </svg>
  )
}

// Microphone slash icon for mute button
function MicSlashIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="2" x2="22" y1="2" y2="22" />
      <path d="M12 2a3 3 0 0 1 3 3v7a3 3 0 0 1-6 0V5" />
      <path d="M19 10v2a7 7 0 0 1-10.9 5.8" />
      <line x1="12" x2="12" y1="19" y2="22" />
    </svg>
  )
}

// X icon for muted indicator
function XIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" x2="6" y1="6" y2="18" />
      <line x1="6" x2="18" y1="6" y2="18" />
    </svg>
  )
}

export function Participants() {
  const roomState = useRoomStore((s) => s.state)
  const roomId = useRoomStore((s) => s.roomId)
  const participantId = useRoomStore((s) => s.participantId)
  const role = useRoomStore((s) => s.role)
  const participants = useParticipantStore((s) => Array.from(s.participants.values()))
  const setMutedByOwner = useParticipantStore((s) => s.setMutedByOwner)

  const isOwner = role === 'owner'

  const handleMuteToggle = useCallback(async (targetSessionId: string, currentMuteState: boolean) => {
    if (!roomId || !participantId) return

    const newMuteState = !currentMuteState
    try {
      await api.muteParticipant(roomId, targetSessionId, newMuteState, participantId)
      // Optimistically update the local store
      setMutedByOwner(targetSessionId, newMuteState)
    } catch (err) {
      logger.error('Failed to toggle mute:', err)
    }
  }, [roomId, participantId, setMutedByOwner])

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

  // Helper to determine if a participant is muted (either by owner or self-muted)
  // Note: For remote participants, we rely on isMutedByOwner from metadata
  // For local participant, we would need mic state from props, but for now we show
  // the owner-mute indicator which is what matters for the UI
  const isParticipantMuted = (p: typeof sorted[0]) => {
    return p.isMutedByOwner
  }

  // Helper to get the indicator dot class
  const getIndicatorClass = (p: typeof sorted[0]) => {
    if (isParticipantMuted(p)) {
      return 'bg-yellow-500'
    }
    if (p.isSpeaking) {
      return 'bg-green-500 animate-pulse'
    }
    return 'bg-slate-600'
  }

  return (
    <div className="flex-1">
      <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">
        Participants ({participants.length})
      </span>
      <ul className="mt-1 space-y-0.5">
        {sorted.map((p) => (
          <li key={p.identity} className="flex items-center gap-1.5 text-xs group">
            <span
              className={`w-1.5 h-1.5 rounded-full flex-shrink-0 relative ${getIndicatorClass(p)}`}
            >
              {isParticipantMuted(p) && (
                <span className="absolute inset-0 flex items-center justify-center">
                  <XIcon className="w-2 h-2 text-black" />
                </span>
              )}
            </span>
            <span className="text-slate-300 truncate flex-1">
              {p.displayName}
              {p.isLocal && <span className="text-slate-500 ml-1">(You)</span>}
            </span>
            {/* Mute button for owner - only show for non-local participants */}
            {isOwner && !p.isLocal && (
              <button
                onClick={() => handleMuteToggle(p.identity, p.isMutedByOwner)}
                className={`p-1 rounded transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100 ${
                  p.isMutedByOwner
                    ? 'text-yellow-500 hover:bg-yellow-500/20'
                    : 'text-slate-400 hover:bg-slate-700 hover:text-slate-200'
                }`}
                title={p.isMutedByOwner ? 'Unmute participant' : 'Mute participant'}
              >
                {p.isMutedByOwner ? (
                  <MicIcon className="w-3 h-3" />
                ) : (
                  <MicSlashIcon className="w-3 h-3" />
                )}
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
