import { useState, useEffect, useCallback, useRef } from 'react'
import { logger } from '../utils/logger'

export interface AudioDevice {
    deviceId: string
    label: string
    kind: 'audioinput' | 'audiooutput'
}

export function useAudioDevices() {
    const [inputDevices, setInputDevices] = useState<AudioDevice[]>([])
    const [selectedDeviceId, setSelectedDeviceId] = useState<string>('')
    const [permissionState, setPermissionState] = useState<PermissionState | null>(null)
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const permissionRef = useRef<PermissionStatus | null>(null)

    const enumerateDevices = useCallback(async () => {
        try {
            setIsLoading(true)
            setError(null)

            if (!navigator.mediaDevices) {
                setError('Audio devices not available - ensure you are using HTTPS or localhost')
                setIsLoading(false)
                return
            }

            const devices = await navigator.mediaDevices.enumerateDevices()
            const audioInputs = devices
                .filter((d) => d.kind === 'audioinput')
                .map((d) => ({
                    deviceId: d.deviceId,
                    label: d.label || `Microphone ${d.deviceId.slice(0, 8)}...`,
                    kind: 'audioinput' as const,
                }))

            setInputDevices(audioInputs)

            // If no device is selected and we have devices, select the default one
            if (!selectedDeviceId && audioInputs.length > 0) {
                const defaultDevice = audioInputs.find((d) => d.deviceId === 'default') || audioInputs[0]
                setSelectedDeviceId(defaultDevice.deviceId)
            }
        } catch (err) {
            logger.error('Failed to enumerate audio devices:', err)
            setError('Failed to list audio devices')
        } finally {
            setIsLoading(false)
        }
    }, [selectedDeviceId])

    const requestPermission = useCallback(async () => {
        try {
            setIsLoading(true)
            setError(null)

            if (!navigator.mediaDevices) {
                setError('Microphone access not available - ensure you are using HTTPS or localhost')
                setPermissionState('denied' as PermissionState)
                setIsLoading(false)
                return
            }

            // Request microphone access to get device labels
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true })

            // Stop all tracks immediately - we just needed permission
            stream.getTracks().forEach((track) => track.stop())

            // Now enumerate devices to get labels
            await enumerateDevices()
        } catch (err) {
            logger.error('Failed to get microphone permission:', err)
            setError('Microphone permission denied')
            setPermissionState('denied' as PermissionState)
        } finally {
            setIsLoading(false)
        }
    }, [enumerateDevices])

    // Check permission state and enumerate devices on mount
    useEffect(() => {
        const checkPermission = async () => {
            try {
                if ('permissions' in navigator) {
                    const permission = await navigator.permissions.query({ name: 'microphone' as PermissionName })
                    permissionRef.current = permission
                    setPermissionState(permission.state)

                    if (permission.state === 'granted') {
                        await enumerateDevices()
                    } else if (permission.state === 'prompt') {
                        // Will need to request permission when user tries to use mic
                        // Still enumerate to show device IDs (labels will be empty)
                        await enumerateDevices()
                    }

                    // Listen for permission changes
                    permission.addEventListener('change', () => {
                        setPermissionState(permission.state)
                        if (permission.state === 'granted') {
                            enumerateDevices()
                        }
                    })
                } else {
                    // Fallback: just try to enumerate
                    await enumerateDevices()
                }
            } catch {
                // Some browsers don't support querying microphone permission
                await enumerateDevices()
            }
        }

        checkPermission()
    }, [enumerateDevices])

    // Listen for device changes (plug/unplug)
    useEffect(() => {
        if (!navigator.mediaDevices) return

        const handleDeviceChange = () => {
            enumerateDevices()
        }

        navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange)
        return () => {
            navigator.mediaDevices.removeEventListener('devicechange', handleDeviceChange)
        }
    }, [enumerateDevices])

    const selectDevice = useCallback((deviceId: string) => {
        setSelectedDeviceId(deviceId)
    }, [])

    return {
        inputDevices,
        selectedDeviceId,
        permissionState,
        isLoading,
        error,
        selectDevice,
        requestPermission,
        refreshDevices: enumerateDevices,
    }
}
