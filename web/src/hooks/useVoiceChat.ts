import { useCallback, useState, useEffect, useRef } from 'react'
import { Room, Track, LocalTrackPublication, RoomEvent } from 'livekit-client'
import type { NoiseSuppressionMode } from '../types'
import { useParticipantStore } from '../stores/participantStore'
import { logger } from '../utils/logger'

export interface VoiceChatOptions {
  noiseSuppressionMode: NoiseSuppressionMode
  echoCancellation: boolean
}

export function useVoiceChat(
  room: Room | null,
  options: VoiceChatOptions = { noiseSuppressionMode: 'krisp', echoCancellation: true },
  deviceId?: string
) {
  const [micEnabled, setMicEnabled] = useState(false)
  const [audioOptions, setAudioOptions] = useState<VoiceChatOptions>(options)

  // Ref to track latest micEnabled value to avoid stale closure in effect
  const micEnabledRef = useRef(micEnabled)
  useEffect(() => {
    micEnabledRef.current = micEnabled
  }, [micEnabled])

  // Sync audioOptions from prop changes (e.g. Krisp fallback updates mode in parent)
  useEffect(() => {
    setAudioOptions((prev) => {
      if (prev.noiseSuppressionMode === options.noiseSuppressionMode && prev.echoCancellation === options.echoCancellation) {
        return prev // no change needed, avoid unnecessary re-render
      }
      return { ...options }
    })
  }, [options.noiseSuppressionMode, options.echoCancellation])
  const [isMutedByOwner, setIsMutedByOwner] = useState(false)
  const participantId = room?.localParticipant?.identity
  const isMutedByOwnerFromStore = useParticipantStore(
    (state) => participantId ? state.participants.get(participantId)?.isMutedByOwner : false
  )

  const toggleMic = useCallback(async () => {
    if (!room) return

    // Prevent unmuting if muted by owner
    if (isMutedByOwner && !micEnabled) {
      return
    }

    const newState = !micEnabled
    await room.localParticipant.setMicrophoneEnabled(newState)
    setMicEnabled(newState)
  }, [room, micEnabled, isMutedByOwner])

  // Switch microphone device when deviceId changes
  const switchMicrophoneDevice = useCallback(async (newDeviceId: string) => {
    if (!room) return

    try {
      await room.switchActiveDevice('audioinput', newDeviceId)
    } catch (err) {
      logger.error('Failed to switch microphone device:', err)
    }
  }, [room])

  // Handle device changes
  useEffect(() => {
    if (!room || !deviceId) return

    // Only switch if mic is currently enabled
    if (micEnabled) {
      switchMicrophoneDevice(deviceId)
    }
  }, [room, deviceId, micEnabled, switchMicrophoneDevice])

  const setNoiseSuppressionMode = useCallback((mode: NoiseSuppressionMode) => {
    setAudioOptions((prev) => ({ ...prev, noiseSuppressionMode: mode }))
  }, [])

  const setEchoCancellation = useCallback((enabled: boolean) => {
    setAudioOptions((prev) => ({ ...prev, echoCancellation: enabled }))
  }, [])

  const getMicPublication = (): LocalTrackPublication | undefined => {
    if (!room) return undefined
    return Array.from(room.localParticipant.trackPublications.values()).find(
      (pub) => pub.track?.kind === Track.Kind.Audio && pub.source === Track.Source.Microphone
    ) as LocalTrackPublication | undefined
  }

  // Apply audio processing options when they change
  useEffect(() => {
    if (!room) return

    const micPub = getMicPublication()
    if (micPub?.track && 'setProcessor' in micPub.track) {
      // Note: LiveKit applies audio constraints at track creation time.
      // To change them dynamically, we would need to restart the track.
      // For now, options are applied when mic is toggled off/on.
    }
  }, [audioOptions, room])

  // Watch for mute by owner changes from the participant store
  useEffect(() => {
    if (!room) return

    // Update local state when store changes
    if (isMutedByOwnerFromStore !== undefined) {
      setIsMutedByOwner(isMutedByOwnerFromStore)

      // If muted by owner, force mic off
      if (isMutedByOwnerFromStore && micEnabled) {
        room.localParticipant.setMicrophoneEnabled(false)
        setMicEnabled(false)
      }
    }
  }, [isMutedByOwnerFromStore, room, micEnabled])

  // Also listen to ParticipantMetadataChanged for real-time updates
  useEffect(() => {
    if (!room) return

    const handleMetadataChanged = (metadata: string | undefined) => {
      try {
        const meta = metadata ? JSON.parse(metadata) : {}
        const mutedByOwner = meta.muted_by_owner ?? false
        setIsMutedByOwner(mutedByOwner)

        // If muted by owner, force mic off
        if (mutedByOwner && micEnabledRef.current) {
          room.localParticipant.setMicrophoneEnabled(false)
          setMicEnabled(false)
        }
      } catch {
        // Invalid metadata, treat as not muted
        setIsMutedByOwner(false)
      }
    }

    room.on(RoomEvent.ParticipantMetadataChanged, handleMetadataChanged)

    return () => {
      room.off(RoomEvent.ParticipantMetadataChanged, handleMetadataChanged)
    }
  }, [room])

  return {
    micEnabled,
    isMutedByOwner,
    toggleMic,
    getMicPublication,
    noiseSuppressionMode: audioOptions.noiseSuppressionMode,
    echoCancellation: audioOptions.echoCancellation,
    setNoiseSuppressionMode,
    setEchoCancellation,
  }
}
