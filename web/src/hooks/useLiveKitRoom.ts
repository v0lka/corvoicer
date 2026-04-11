import { useEffect, useRef, useState, useCallback } from 'react'
import { Room, RoomEvent, Track, RemoteTrack, RemoteTrackPublication, RemoteParticipant, Participant, LocalTrackPublication, ParticipantEvent } from 'livekit-client'
import type { NoiseSuppressionMode } from '../types'
import { useRoomStore } from '../stores/roomStore'
import { useStreamStore } from '../stores/streamStore'
import { useParticipantStore, type Participant as StoredParticipant } from '../stores/participantStore'
import { logger } from '../utils/logger'
import { playJoinSound, playLeaveSound } from '../utils/sounds'

interface ParticipantMetadata {
  muted_by_owner?: boolean
}

export interface AudioProcessingOptions {
  noiseSuppressionMode: NoiseSuppressionMode
  echoCancellation: boolean
}

export function useLiveKitRoom(
  params: { url: string; token: string; room_id: string } | null,
  audioProcessing: AudioProcessingOptions = { noiseSuppressionMode: 'krisp', echoCancellation: true },
  onNoiseSuppressionFallback?: (mode: NoiseSuppressionMode) => void
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
  // Store Krisp processor for cleanup
  const krispProcessorRef = useRef<{ destroy: () => void } | null>(null)
  // Ref to track latest audioProcessing values to avoid stale closure
  const audioProcessingRef = useRef(audioProcessing)
  useEffect(() => {
    audioProcessingRef.current = audioProcessing
  }, [audioProcessing])

  const participantToStored = useCallback((p: Participant, isLocal: boolean): StoredParticipant => {
    // Parse metadata to get initial muted_by_owner state
    let isMutedByOwner = false
    if (p.metadata) {
      try {
        const meta = JSON.parse(p.metadata) as ParticipantMetadata
        isMutedByOwner = meta.muted_by_owner ?? false
      } catch {
        // Invalid metadata, treat as not muted
      }
    }
    return {
      identity: p.identity,
      displayName: p.name || p.identity.slice(0, 8),
      isSpeaking: false,
      isLocal,
      isMutedByOwner,
    }
  }, [])

  const connect = useCallback(async () => {
    if (!params || roomRef.current) return

    const room = new Room({
      // Enable audio processing options
      audioCaptureDefaults: {
        // Krisp handles noise suppression itself, standard uses browser NS, off disables it
        noiseSuppression: audioProcessing.noiseSuppressionMode === 'standard',
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
      // Clean up Krisp processor
      if (krispProcessorRef.current) {
        krispProcessorRef.current.destroy()
        krispProcessorRef.current = null
      }
      roomRef.current = null
    })

    const parseParticipantMetadata = (metadata: string | undefined): ParticipantMetadata => {
      if (!metadata) return {}
      try {
        return JSON.parse(metadata) as ParticipantMetadata
      } catch {
        return {}
      }
    }

    const handleParticipantMetadata = (participant: Participant) => {
      const meta = parseParticipantMetadata(participant.metadata)
      const mutedByOwner = meta.muted_by_owner ?? false
      useParticipantStore.getState().setMutedByOwner(participant.identity, mutedByOwner)
    }

    room.on(RoomEvent.ParticipantConnected, (participant: RemoteParticipant) => {
      console.log('[LiveKit] ParticipantConnected:', participant.identity)
      addParticipant(participantToStored(participant, false))

      // Handle initial metadata for the joining participant
      handleParticipantMetadata(participant)

      // Play join sound for non-stream participants
      if (!participant.identity.startsWith('stream:')) {
        playJoinSound()
      }

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

    room.on(RoomEvent.ParticipantMetadataChanged, (metadata: string | undefined, participant: Participant) => {
      console.log('[LiveKit] ParticipantMetadataChanged:', participant.identity, metadata)
      const meta = parseParticipantMetadata(metadata)
      const mutedByOwner = meta.muted_by_owner ?? false
      useParticipantStore.getState().setMutedByOwner(participant.identity, mutedByOwner)
    })

    room.on(RoomEvent.ParticipantDisconnected, (participant: RemoteParticipant) => {
      removeParticipant(participant.identity)

      // Play leave sound for non-stream participants
      if (!participant.identity.startsWith('stream:')) {
        playLeaveSound()
      }
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

    // Set up Krisp processor when local audio track is published
    const setupKrispProcessor = async (targetRoom: Room, targetTrack?: LocalTrackPublication['track']) => {
      if (audioProcessingRef.current.noiseSuppressionMode !== 'krisp') return

      try {
        const { KrispNoiseFilter, isKrispNoiseFilterSupported } = await import('@livekit/krisp-noise-filter')

        if (!isKrispNoiseFilterSupported()) {
          logger.warn('Krisp noise filter is not supported in this browser')
          onNoiseSuppressionFallback?.('standard')
          return
        }

        const processor = KrispNoiseFilter()
        krispProcessorRef.current = processor

        // Find the local audio track if not provided
        const track = targetTrack || (() => {
          const audioPub = Array.from(targetRoom.localParticipant.trackPublications.values()).find(
            (pub): pub is LocalTrackPublication => pub.track?.kind === Track.Kind.Audio && pub.source === Track.Source.Microphone
          )
          return audioPub?.track
        })()

        if (track && 'setProcessor' in track) {
          // Cast processor to any to handle type mismatch between Krisp and LiveKit types
          await track.setProcessor(processor as any)
          logger.warn('Krisp noise filter applied to local audio track')
        }
      } catch (err) {
        logger.warn('Failed to initialize Krisp noise filter:', err)
        onNoiseSuppressionFallback?.('standard')
      }
    }

    room.on(ParticipantEvent.LocalTrackPublished, (pub: LocalTrackPublication) => {
      if (pub.track?.kind === Track.Kind.Audio && pub.source === Track.Source.Microphone) {
        // Apply Krisp processor if in krisp mode (use ref to get latest value)
        if (audioProcessingRef.current.noiseSuppressionMode === 'krisp') {
          setupKrispProcessor(room, pub.track)
        }
      }
    })

    try {
      await room.connect(getLiveKitUrl(params.url), params.token)
      console.log('[LiveKit] Connected to room, remote participants:',
        Array.from(room.remoteParticipants.values()).map(p => p.identity)
      )
      setConnected(true)
      setReconnecting(false)

      // Check if there's already a local audio track published and apply Krisp
      if (audioProcessingRef.current.noiseSuppressionMode === 'krisp') {
        await setupKrispProcessor(room)
      }

      // Initialize participants list
      const initial: StoredParticipant[] = [
        participantToStored(room.localParticipant, true),
        ...Array.from(room.remoteParticipants.values()).map((p) => participantToStored(p, false)),
      ]
      setParticipants(initial)

      // Handle initial metadata for all participants
      handleParticipantMetadata(room.localParticipant)
      room.remoteParticipants.forEach((p) => handleParticipantMetadata(p))

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

  // Handle noise suppression mode changes when room is already connected
  useEffect(() => {
    const room = roomRef.current
    if (!room || !connected) return

    const handleModeChange = async () => {
      // Find the local audio track
      const audioPub = Array.from(room.localParticipant.trackPublications.values()).find(
        (pub): pub is LocalTrackPublication => pub.track?.kind === Track.Kind.Audio && pub.source === Track.Source.Microphone
      )
      const track = audioPub?.track

      if (audioProcessing.noiseSuppressionMode === 'krisp') {
        // Switching TO krisp mode - set up processor if there's an active audio track
        if (track) {
          const { KrispNoiseFilter, isKrispNoiseFilterSupported } = await import('@livekit/krisp-noise-filter')

          if (!isKrispNoiseFilterSupported()) {
            logger.warn('Krisp noise filter is not supported in this browser')
            onNoiseSuppressionFallback?.('standard')
            return
          }

          try {
            const processor = KrispNoiseFilter()
            krispProcessorRef.current = processor

            if ('setProcessor' in track) {
              await track.setProcessor(processor as any)
              logger.warn('Krisp noise filter applied to local audio track')
            }
          } catch (err) {
            logger.warn('Failed to initialize Krisp noise filter:', err)
            onNoiseSuppressionFallback?.('standard')
          }
        }
      } else {
        // Switching AWAY FROM krisp - clean up existing processor
        if (krispProcessorRef.current && track && 'stopProcessor' in track) {
          await (track as any).stopProcessor()
          krispProcessorRef.current.destroy()
          krispProcessorRef.current = null
        }
      }
    }

    handleModeChange()
  }, [audioProcessing.noiseSuppressionMode, connected, onNoiseSuppressionFallback])

  return { room: roomRef.current, streamTrack, streamAudioTrack, connected }
}
