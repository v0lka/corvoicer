import type { AudioDevice } from '../hooks/useAudioDevices'

interface Props {
  micEnabled: boolean
  onToggleMic: () => void
  disabled: boolean
  noiseSuppression?: boolean
  echoCancellation?: boolean
  onNoiseSuppressionChange?: (enabled: boolean) => void
  onEchoCancellationChange?: (enabled: boolean) => void
  // Microphone device selection
  audioDevices?: AudioDevice[]
  selectedDeviceId?: string
  onDeviceChange?: (deviceId: string) => void
  devicesLoading?: boolean
}

function Checkbox({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
  disabled: boolean
}) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-slate-400 cursor-pointer select-none">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        className="w-3.5 h-3.5 rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/50 focus:ring-1 disabled:opacity-50 cursor-pointer"
      />
      <span className={disabled ? 'opacity-50' : ''}>{label}</span>
    </label>
  )
}

export function VoiceControls({
  micEnabled,
  onToggleMic,
  disabled,
  noiseSuppression = true,
  echoCancellation = true,
  onNoiseSuppressionChange,
  onEchoCancellationChange,
  audioDevices = [],
  selectedDeviceId,
  onDeviceChange,
  devicesLoading = false,
}: Props) {
  const showAudioOptions = onNoiseSuppressionChange || onEchoCancellationChange
  const showDeviceSelector = onDeviceChange && audioDevices.length > 1

  return (
    <div className="flex items-center justify-between px-4 py-2 border-t border-slate-700/50">
      <div className="flex items-center gap-2">
        <button
          onClick={onToggleMic}
          disabled={disabled}
          className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${micEnabled
            ? 'bg-red-600 hover:bg-red-700 text-white'
            : 'bg-slate-600 hover:bg-slate-500 text-slate-200'
            } disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          {micEnabled ? 'Mute' : 'Unmute'}
        </button>

        {showDeviceSelector && (
          <select
            value={selectedDeviceId}
            onChange={(e) => onDeviceChange(e.target.value)}
            disabled={disabled || devicesLoading || micEnabled}
            className="px-2 py-1.5 bg-slate-800 border border-slate-600 rounded text-xs text-slate-200 focus:outline-none focus:border-slate-400 disabled:opacity-50 disabled:cursor-not-allowed max-w-[150px] truncate"
            title={audioDevices.find(d => d.deviceId === selectedDeviceId)?.label || 'Select microphone'}
          >
            {devicesLoading ? (
              <option value="">Loading...</option>
            ) : (
              audioDevices.map((device) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label}
                </option>
              ))
            )}
          </select>
        )}
      </div>

      {showAudioOptions && (
        <div className="flex items-center gap-3">
          {onNoiseSuppressionChange && (
            <Checkbox
              label="Noise Suppression"
              checked={noiseSuppression}
              onChange={onNoiseSuppressionChange}
              disabled={disabled || micEnabled}
            />
          )}
          {onEchoCancellationChange && (
            <Checkbox
              label="Echo Cancellation"
              checked={echoCancellation}
              onChange={onEchoCancellationChange}
              disabled={disabled || micEnabled}
            />
          )}
        </div>
      )}
    </div>
  )
}
