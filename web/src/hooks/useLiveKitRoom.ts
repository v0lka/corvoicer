import { useEffect, useRef, useState, useCallback } from 'react'
import { Room, RoomEvent, Track, RemoteTrack, RemoteTrackPublication, RemoteParticipant, Participant, AudioPresets } from 'livekit-client'
import { useRoomStore } from '../stores/roomStore'
import { useStreamStore } from '../stores/streamStore'
import { useParticipantStore, type Participant as StoredParticipant } from '../stores/participantStore'
import { logger } from '../utils/logger'

export interface AudioProcessingOptions {
  noiseSuppression: boolean
  echoCancellation: boolean
}

export function useLiveKitRoom(
  params: { url: string; token: string; room_id: string } | null,
  audioProcessing: AudioProcessingOptions = { noiseSuppression: true, echoCancellation: true }
) {
  const roomState = useRoomStore((s) => s.state)
  const setReconnecting = useRoomStore((s) => s.setReconnecting)
  const { setParticipants, addParticipant, removeParticipant, updateSpeaking, reset: resetParticipants } = useParticipantStore()
  const roomRef = useRef<Room | null>(null)
  const [streamTrack, setStreamTrack] = useState<RemoteTrack | null>(null)
  const [streamAudioTrack, setStreamAudioTrack] = useState<RemoteTrack | null>(null)
  const [connected, setConnected] = useState(false)
  // Store remote participant voice audio elements
  const voiceAudioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map())

  const participantToStored = useCallback((p: Participant, isLocal: boolean): StoredParticipant => ({
    identity: p.identity,
    displayName: p.name || p.identity.slice(0, 8),
    isSpeaking: false,
    isLocal,
  }), [])

  const connect = useCallback(async () => {
    if (!params || roomRef.current) return

    const room = new Room({
      // Enable audio processing options
      audioCaptureDefaults: {
        noiseSuppression: audioProcessing.noiseSuppression,
        echoCancellation: audioProcessing.echoCancellation,
        autoGainControl: true,
      },
      // Optimize for voice chat
      adaptiveStream: true,
      dynacast: true,
    })
    roomRef.current = room

    room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, pub: RemoteTrackPublication, participant: RemoteParticipant) => {
      console.log('[LiveKit] TrackSubscribed:', {
        participantIdentity: participant.identity,
        trackKind: track.kind,
        trackSource: pub.source,
        isStream: participant.identity.startsWith('stream:')
      })
      if (participant.identity.startsWith('stream:')) {
        // Handle OBS stream tracks (ingress)
        if (track.kind === Track.Kind.Video) {
          console.log('[LiveKit] Setting stream video track')
          setStreamTrack(track)
        } else if (track.kind === Track.Kind.Audio) {
          console.log('[LiveKit] Setting stream audio track')
          setStreamAudioTrack(track)
        }
      } else if (track.kind === Track.Kind.Audio && pub.source === Track.Source.Microphone) {
        // Handle voice chat audio from other participants
        const audioEl = track.attach() as HTMLAudioElement
        audioEl.autoplay = true
        voiceAudioElementsRef.current.set(participant.identity, audioEl)
      }
    })

    room.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack, pub: RemoteTrackPublication, participant: RemoteParticipant) => {
      if (track === streamTrack) {
        setStreamTrack(null)
      } else if (track === streamAudioTrack) {
        setStreamAudioTrack(null)
      } else if (track.kind === Track.Kind.Audio && pub.source === Track.Source.Microphone && !participant.identity.startsWith('stream:')) {
        // Clean up voice audio element
        const audioEl = voiceAudioElementsRef.current.get(participant.identity)
        if (audioEl) {
          track.detach(audioEl)
          voiceAudioElementsRef.current.delete(participant.identity)
        }
      }
    })

    room.on(RoomEvent.Reconnecting, () => {
      setReconnecting(true)
    })

    room.on(RoomEvent.Reconnected, () => {
      setReconnecting(false)
    })

    room.on(RoomEvent.Disconnected, () => {
      setConnected(false)
      setStreamTrack(null)
      setStreamAudioTrack(null)
      setReconnecting(false)
      resetParticipants()
      // Clean up all voice audio elements
      voiceAudioElementsRef.current.forEach((audioEl) => {
        audioEl.remove()
      })
      voiceAudioElementsRef.current.clear()
      roomRef.current = null
    })

    room.on(RoomEvent.ParticipantConnected, (participant: RemoteParticipant) => {
      console.log('[LiveKit] ParticipantConnected:', participant.identity)
      addParticipant(participantToStored(participant, false))

      // Detect ingress participant joining -> stream is LIVE
      if (participant.identity.startsWith('stream:')) {
        console.log('[LiveKit] Stream participant detected, checking tracks:',
          Array.from(participant.trackPublications.values()).map(pub => ({
            kind: pub.kind,
            source: pub.source,
            subscribed: pub.isSubscribed
          }))
        )
        const { state } = useStreamStore.getState()
        // Set state to LIVE if we're awaiting stream (broadcaster) or if we're a viewer (IDLE state)
        if (state === 'AWAITING_STREAM' || state === 'IDLE') {
          useStreamStore.getState().setState('LIVE')
        }
      }
    })

    room.on(RoomEvent.ParticipantDisconnected, (participant: RemoteParticipant) => {
      removeParticipant(participant.identity)
    })

    room.on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) => {
      updateSpeaking(speakers.map((s) => s.identity))
    })

    // Use Vite's WSS proxy when frontend is on HTTPS, otherwise use server-provided URL
    const getLiveKitUrl = (serverUrl: string): string => {
      if (window.location.protocol === 'https:') {
        return `wss://${window.location.host}/livekit`
      }
      return serverUrl
    }

    try {
      await room.connect(getLiveKitUrl(params.url), params.token)
      console.log('[LiveKit] Connected to room, remote participants:',
        Array.from(room.remoteParticipants.values()).map(p => p.identity)
      )
      setConnected(true)
      setReconnecting(false)

      // Initialize participants list
      const initial: StoredParticipant[] = [
        participantToStored(room.localParticipant, true),
        ...Array.from(room.remoteParticipants.values()).map((p) => participantToStored(p, false)),
      ]
      setParticipants(initial)

      // Check if ingress participant is already in the room with tracks
      for (const p of room.remoteParticipants.values()) {
        if (p.identity.startsWith('stream:')) {
          console.log('[LiveKit] Found existing stream participant:', p.identity)
          console.log('[LiveKit] Track publications:',
            Array.from(p.trackPublications.values()).map(pub => ({
              trackSid: pub.trackSid,
              kind: pub.kind,
              source: pub.source,
              isSubscribed: pub.isSubscribed,
              hasTrack: !!pub.track
            }))
          )
          const { state } = useStreamStore.getState()
          // Set state to LIVE if we're awaiting stream (broadcaster) or if we're a viewer (IDLE state)
          if (state === 'AWAITING_STREAM' || state === 'IDLE') {
            useStreamStore.getState().setState('LIVE')
          }

          // Check for existing tracks that might have been missed during reconnection
          p.trackPublications.forEach((pub) => {
            if (pub.track) {
              const track = pub.track as RemoteTrack
              if (track.kind === Track.Kind.Video) {
                setStreamTrack(track)
              } else if (track.kind === Track.Kind.Audio) {
                setStreamAudioTrack(track)
              }
            }
          })

          // Also set up listener for tracks that might subscribe later
          p.on('trackSubscribed', (track: RemoteTrack, pub: RemoteTrackPublication) => {
            if (track.kind === Track.Kind.Video) {
              setStreamTrack(track)
            } else if (track.kind === Track.Kind.Audio) {
              setStreamAudioTrack(track)
            }
          })

          break
        }
      }
    } catch (err) {
      logger.error('LiveKit connect failed:', err)
      roomRef.current = null
    }
  }, [params, setReconnecting, participantToStored, setParticipants, addParticipant, removeParticipant, updateSpeaking, resetParticipants])

  const disconnect = useCallback(() => {
    if (roomRef.current) {
      roomRef.current.disconnect()
      roomRef.current = null
      setConnected(false)
      setStreamTrack(null)
      setReconnecting(false)
      resetParticipants()
    }
  }, [setReconnecting, resetParticipants])

  useEffect(() => {
    if (roomState === 'CONNECTED' && params && !roomRef.current) {
      connect()
    } else if (roomState !== 'CONNECTED' && roomRef.current) {
      disconnect()
    }
  }, [roomState, params, connect, disconnect])

  useEffect(() => {
    return () => {
      disconnect()
    }
  }, [disconnect])

  return { room: roomRef.current, streamTrack, streamAudioTrack, connected }
}
