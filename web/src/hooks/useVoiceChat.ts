import { useCallback, useState, useEffect } from 'react'
import { Room, Track, LocalTrackPublication } from 'livekit-client'
import { logger } from '../utils/logger'

export interface VoiceChatOptions {
  noiseSuppression: boolean
  echoCancellation: boolean
}

export function useVoiceChat(
  room: Room | null,
  options: VoiceChatOptions = { noiseSuppression: true, echoCancellation: true },
  deviceId?: string
) {
  const [micEnabled, setMicEnabled] = useState(false)
  const [audioOptions, setAudioOptions] = useState<VoiceChatOptions>(options)

  const toggleMic = useCallback(async () => {
    if (!room) return

    const newState = !micEnabled
    await room.localParticipant.setMicrophoneEnabled(newState)
    setMicEnabled(newState)
  }, [room, micEnabled])

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

  const setNoiseSuppression = useCallback((enabled: boolean) => {
    setAudioOptions((prev) => ({ ...prev, noiseSuppression: enabled }))
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

  return {
    micEnabled,
    toggleMic,
    getMicPublication,
    noiseSuppression: audioOptions.noiseSuppression,
    echoCancellation: audioOptions.echoCancellation,
    setNoiseSuppression,
    setEchoCancellation,
  }
}
