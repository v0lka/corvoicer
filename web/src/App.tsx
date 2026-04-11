import { useState, useCallback, useEffect, useRef } from 'react'
import type { NoiseSuppressionMode } from './types'
import { useLiveKitRoom } from './hooks/useLiveKitRoom'
import { useVoiceChat } from './hooks/useVoiceChat'
import { useChat } from './hooks/useChat'
import { useAudioDevices } from './hooks/useAudioDevices'
import { useRoomStore, loadSessionFromStorage } from './stores/roomStore'
import { useStreamStore } from './stores/streamStore'
import { useChatStore } from './stores/chatStore'
import { VideoPanel } from './components/VideoPanel'
import { StatusBar } from './components/StatusBar'
import { VoiceControls } from './components/VoiceControls'
import { ChatPanel } from './components/ChatPanel'
import { BroadcastControls } from './components/BroadcastControls'
import { Participants } from './components/Participants'
import { api } from './services/api'
import { logger } from './utils/logger'

function App() {
  const roomState = useRoomStore((s) => s.state)
  const roomId = useRoomStore((s) => s.roomId)
  const participantId = useRoomStore((s) => s.participantId)
  const role = useRoomStore((s) => s.role)
  const streamState = useStreamStore((s) => s.state)
  const whipInfo = useStreamStore((s) => s.whipInfo)
  const streamSessionId = useStreamStore((s) => s.streamSessionId)
  const setWhipInfo = useStreamStore((s) => s.setWhipInfo)
  const setStreamState = useStreamStore((s) => s.setState)
  const setStreamSessionId = useStreamStore((s) => s.setStreamSessionId)
  const setStreamError = useStreamStore((s) => s.setError)
  const setRoomState = useRoomStore((s) => s.setState)
  const setRoomInfo = useRoomStore((s) => s.setRoomInfo)
  const resetRoom = useRoomStore((s) => s.reset)
  const resetChat = useChatStore((s) => s.reset)
  const resetStream = useStreamStore((s) => s.reset)

  const [lkParams, setLkParams] = useState<{ url: string; token: string; room_id: string } | null>(null)
  const [displayName, setDisplayName] = useState('')
  const [inviteToken, setInviteToken] = useState('')
  const [showJoin, setShowJoin] = useState(false)
  const [adminToken, setAdminToken] = useState('')
  const [adminUnlocked, setAdminUnlocked] = useState(false)
  const [showAdminInput, setShowAdminInput] = useState(false)
  const [adminError, setAdminError] = useState('')
  const storedInviteToken = useRoomStore((s) => s.inviteToken)
  const [copied, setCopied] = useState(false)
  const [isRestoringSession, setIsRestoringSession] = useState(false)
  const restoredSessionRef = useRef(false)

  const [audioProcessing, setAudioProcessing] = useState<{ noiseSuppressionMode: NoiseSuppressionMode; echoCancellation: boolean }>({ noiseSuppressionMode: 'krisp', echoCancellation: true })

  // Handle Krisp fallback when not supported
  const handleNoiseSuppressionFallback = useCallback((mode: NoiseSuppressionMode) => {
    setAudioProcessing((prev) => ({ ...prev, noiseSuppressionMode: mode }))
  }, [])

  const { room, streamTrack, streamAudioTrack } = useLiveKitRoom(lkParams, audioProcessing, handleNoiseSuppressionFallback)

  // Audio device management
  const {
    inputDevices,
    selectedDeviceId,
    isLoading: devicesLoading,
    selectDevice,
    requestPermission,
  } = useAudioDevices()

  const {
    micEnabled,
    isMutedByOwner,
    toggleMic,
    noiseSuppressionMode,
    echoCancellation,
    setNoiseSuppressionMode,
    setEchoCancellation,
  } = useVoiceChat(room, audioProcessing, selectedDeviceId)
  const { sendMessage, loadHistory, loadingHistory } = useChat(room)

  // Request microphone permission when user first tries to unmute
  const handleToggleMic = useCallback(async () => {
    // If permission not granted yet, request it first
    if (!micEnabled && inputDevices.length === 0) {
      await requestPermission()
    }
    toggleMic()
  }, [micEnabled, inputDevices.length, requestPermission, toggleMic])

  // Sync audio processing options between hook and room
  useEffect(() => {
    setAudioProcessing({ noiseSuppressionMode, echoCancellation })
  }, [noiseSuppressionMode, echoCancellation])

  // Load chat history when connected to room
  useEffect(() => {
    if (roomState === 'CONNECTED' && lkParams) {
      loadHistory()
    }
  }, [roomState, lkParams, loadHistory])

  // Restore session from localStorage on mount (page refresh/reload)
  useEffect(() => {
    if (restoredSessionRef.current) return
    restoredSessionRef.current = true

    const storedSession = loadSessionFromStorage()
    if (storedSession) {
      setIsRestoringSession(true)
      setRoomState('CONNECTING')
      // Attempt to rejoin with stored participant session
      api.rejoinRoom(storedSession.participantId)
        .then((result) => {
          setRoomInfo(result.room_id, result.participant_session_id, result.role as 'owner' | 'member', storedSession.inviteToken || undefined)
          setDisplayName(result.display_name)
          setLkParams({ url: result.livekit_url, token: result.livekit_token, room_id: result.room_id })

          // If user is the broadcaster of an active stream, restore stream state
          if (result.active_stream) {
            setStreamSessionId(result.active_stream.stream_session_id)
            // Restore WHIP info from storage if available
            if (storedSession.whipInfo) {
              setWhipInfo(storedSession.whipInfo)
            }
            // Map server state to client stream state
            const serverState = result.active_stream.state
            if (serverState === 'starting' || serverState === 'active') {
              // Stream is live - show appropriate state
              setStreamState('LIVE')
            } else {
              setStreamState('IDLE')
            }
          }

          setRoomState('CONNECTED')
        })
        .catch((err) => {
          logger.error('Failed to restore session:', err)
          // Clear invalid session
          resetRoom()
        })
        .finally(() => {
          setIsRestoringSession(false)
        })
    }
  }, [setRoomState, setRoomInfo, resetRoom, setStreamSessionId, setStreamState, setWhipInfo])

  const handleCreate = useCallback(async () => {
    if (!displayName.trim() || !adminToken) return
    try {
      setRoomState('CONNECTING')
      const result = await api.createRoom(displayName, adminToken)
      setRoomInfo(result.room_id, result.owner_session_id, 'owner', result.invite_token)
      setLkParams({ url: result.livekit_url, token: result.livekit_token, room_id: result.room_id })
      setRoomState('CONNECTED')
    } catch (err) {
      logger.error('Create room failed:', err)
      setRoomState('NOT_CONNECTED')
    }
  }, [displayName, adminToken, setRoomInfo, setRoomState])

  const handleJoin = useCallback(async () => {
    if (!inviteToken.trim() || !displayName.trim()) return
    try {
      setRoomState('CONNECTING')
      const result = await api.joinRoom(inviteToken, displayName)
      setRoomInfo(result.room_id, result.participant_session_id, result.role as 'owner' | 'member')
      setLkParams({ url: result.livekit_url, token: result.livekit_token, room_id: result.room_id })

      // If there's an active stream in the room, set the stream state accordingly
      if (result.active_stream) {
        setStreamSessionId(result.active_stream.stream_session_id)
        const serverState = result.active_stream.state
        if (serverState === 'starting' || serverState === 'active') {
          setStreamState('LIVE')
        } else {
          setStreamState('IDLE')
        }
      }

      setRoomState('CONNECTED')
    } catch (err) {
      logger.error('Join room failed:', err)
      setRoomState('NOT_CONNECTED')
    }
  }, [inviteToken, displayName, setRoomInfo, setRoomState, setStreamSessionId, setStreamState])

  const handleUnlockAdmin = useCallback(async () => {
    if (!adminToken.trim()) return
    setAdminError('')
    try {
      const result = await api.validateAdminToken(adminToken)
      if (result.valid) {
        setAdminUnlocked(true)
      } else {
        setAdminError('Invalid admin token')
      }
    } catch (err) {
      logger.error('Validate admin token failed:', err)
      setAdminError('Validation failed')
    }
  }, [adminToken])

  const handleLeave = useCallback(async () => {
    try {
      if (roomId && participantId) {
        // If user is the broadcaster and stream is active, stop the stream first
        // This will end the stream for all users
        if (streamSessionId && (streamState === 'LIVE' || streamState === 'AWAITING_STREAM')) {
          try {
            setStreamState('STOPPING')
            await api.stopStream(roomId, participantId, streamSessionId)
          } catch (err) {
            logger.error('Stop stream on leave failed:', err)
          }
        }
        await api.leaveRoom(roomId, participantId)
      }
    } catch (err) {
      logger.error('Leave room failed:', err)
    }
    setLkParams(null)
    resetRoom()
    resetChat()
    resetStream()
  }, [roomId, participantId, streamSessionId, streamState, setStreamState, resetRoom, resetChat, resetStream])

  const handleCopyInvite = useCallback(() => {
    if (!storedInviteToken) return
    navigator.clipboard.writeText(storedInviteToken).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }, [storedInviteToken])

  const handleStartStream = useCallback(async () => {
    if (!roomId || !participantId) return
    try {
      setStreamState('PROVISIONING')
      const result = await api.startStream(roomId, participantId)
      setStreamSessionId(result.stream_session_id)
      setWhipInfo({ whip_url: result.whip_url, whip_bearer_token: result.whip_bearer_token })
      setStreamState('AWAITING_STREAM')
    } catch (err) {
      logger.error('Start stream failed:', err)
      setStreamError(String(err))
      setStreamState('FAILED')
    }
  }, [roomId, participantId, setStreamState, setStreamSessionId, setWhipInfo, setStreamError])

  const handleStopStream = useCallback(async () => {
    if (!roomId || !participantId || !streamSessionId) return
    try {
      setStreamState('STOPPING')
      await api.stopStream(roomId, participantId, streamSessionId)
    } catch (err) {
      logger.error('Stop stream failed:', err)
    }
    resetStream()
  }, [roomId, participantId, streamSessionId, setStreamState, resetStream])

  const handleSendChat = useCallback(async (text: string) => {
    const clientMsgId = crypto.randomUUID()
    sendMessage(text)
    try {
      if (roomId && participantId) {
        await api.sendChatMessage(roomId, participantId, clientMsgId, text)
      }
    } catch (err) {
      logger.error('Persist chat failed:', err)
    }
  }, [roomId, participantId, sendMessage])

  const isConnected = roomState === 'CONNECTED'

  if (roomState === 'NOT_CONNECTED' || isRestoringSession) {
    return (
      <div className="flex h-screen bg-[#1b2636] text-slate-200 items-center justify-center">
        <div className="w-80 space-y-4">
          <h1 className="text-2xl font-bold text-center mb-6">Corvoicer</h1>
          {isRestoringSession ? (
            <div className="text-center py-4">
              <div className="inline-block animate-spin rounded-full h-6 w-6 border-2 border-slate-600 border-t-blue-500 mb-2"></div>
              <p className="text-slate-400 text-sm">Restoring session...</p>
            </div>
          ) : (
            <>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Your display name"
                className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-slate-400"
              />
              {adminUnlocked ? (
                <button
                  onClick={handleCreate}
                  disabled={!displayName.trim()}
                  className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white rounded font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Create Room
                </button>
              ) : !showAdminInput ? (
                <button
                  onClick={() => setShowAdminInput(true)}
                  className="w-full py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded font-medium text-sm"
                >
                  I have an admin token
                </button>
              ) : (
                <div className="space-y-2">
                  <input
                    type="password"
                    value={adminToken}
                    onChange={(e) => { setAdminToken(e.target.value); setAdminError('') }}
                    placeholder="Enter admin token"
                    className={`w-full bg-slate-800 border rounded px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-slate-400 ${adminError ? 'border-red-500' : 'border-slate-600'}`}
                  />
                  {adminError && <p className="text-red-400 text-xs">{adminError}</p>}
                  <button
                    onClick={handleUnlockAdmin}
                    disabled={!adminToken.trim()}
                    className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white rounded font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Unlock
                  </button>
                </div>
              )}
              <div className="text-center text-slate-500 text-sm">or</div>
              {!showJoin ? (
                <button
                  onClick={() => setShowJoin(true)}
                  className="w-full py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded font-medium"
                >
                  Join with Invite
                </button>
              ) : (
                <div className="space-y-2">
                  <input
                    type="text"
                    value={inviteToken}
                    onChange={(e) => setInviteToken(e.target.value)}
                    placeholder="Paste invite token"
                    className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-slate-400"
                  />
                  <button
                    onClick={handleJoin}
                    disabled={!inviteToken.trim() || !displayName.trim()}
                    className="w-full py-2 bg-green-600 hover:bg-green-700 text-white rounded font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Join Room
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen bg-[#1b2636] text-slate-200">
      <div className="flex-1 flex flex-col">
        <VideoPanel streamTrack={streamTrack} streamAudioTrack={streamAudioTrack} />
        <VoiceControls
          micEnabled={micEnabled}
          onToggleMic={handleToggleMic}
          disabled={!isConnected}
          noiseSuppressionMode={noiseSuppressionMode}
          echoCancellation={echoCancellation}
          onNoiseSuppressionModeChange={setNoiseSuppressionMode}
          onEchoCancellationChange={setEchoCancellation}
          audioDevices={inputDevices}
          selectedDeviceId={selectedDeviceId}
          onDeviceChange={selectDevice}
          devicesLoading={devicesLoading}
          isMutedByOwner={isMutedByOwner}
        />
        <StatusBar />
      </div>
      <div className="w-80 border-l border-slate-700/50 flex flex-col">
        <div className="flex items-center justify-between px-3 py-2 border-b border-slate-700/50">
          <Participants />
          <button
            onClick={handleLeave}
            className="px-2 py-1 bg-red-600/20 hover:bg-red-600/40 text-red-400 text-xs rounded"
          >
            Leave
          </button>
        </div>
        {storedInviteToken && (
          <div className="px-3 py-2 border-b border-slate-700/50 flex items-center gap-2">
            <span className="text-xs text-slate-400 shrink-0">Invite:</span>
            <span className="text-xs font-mono text-slate-300 truncate flex-1" title={storedInviteToken}>
              {storedInviteToken}
            </span>
            <button
              onClick={handleCopyInvite}
              className="px-2 py-0.5 bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs rounded shrink-0"
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
        )}
        <ChatPanel onSend={handleSendChat} disabled={!isConnected} loadingHistory={loadingHistory} />
        <BroadcastControls
          streamState={streamState}
          whipInfo={whipInfo}
          onStartStream={handleStartStream}
          onStopStream={handleStopStream}
          disabled={!isConnected}
          isOwner={role === 'owner'}
        />
      </div>
    </div>
  )
}

export default App
