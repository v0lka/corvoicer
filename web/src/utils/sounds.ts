// Sound notification utilities using Web Audio API
// Generates pleasant notification tones programmatically

let audioContext: AudioContext | null = null

function getAudioContext(): AudioContext {
  if (!audioContext) {
    audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
  }
  return audioContext
}

interface ToneConfig {
  frequency: number
  duration: number
  gain: number
}

function playTone(config: ToneConfig): void {
  try {
    const ctx = getAudioContext()
    const oscillator = ctx.createOscillator()
    const gainNode = ctx.createGain()

    oscillator.connect(gainNode)
    gainNode.connect(ctx.destination)

    oscillator.frequency.value = config.frequency
    oscillator.type = 'sine'

    // Quick attack, short decay envelope
    const now = ctx.currentTime
    gainNode.gain.setValueAtTime(0, now)
    gainNode.gain.linearRampToValueAtTime(config.gain, now + 0.01)
    gainNode.gain.exponentialRampToValueAtTime(0.001, now + config.duration / 1000)

    oscillator.start(now)
    oscillator.stop(now + config.duration / 1000)
  } catch (err) {
    console.warn('Failed to play sound:', err)
  }
}

function playTwoTone(first: ToneConfig, second: ToneConfig): void {
  try {
    const ctx = getAudioContext()

    // First tone
    const osc1 = ctx.createOscillator()
    const gain1 = ctx.createGain()
    osc1.connect(gain1)
    gain1.connect(ctx.destination)
    osc1.frequency.value = first.frequency
    osc1.type = 'sine'

    const now = ctx.currentTime
    gain1.gain.setValueAtTime(0, now)
    gain1.gain.linearRampToValueAtTime(first.gain, now + 0.01)
    gain1.gain.exponentialRampToValueAtTime(0.001, now + first.duration / 1000)

    osc1.start(now)
    osc1.stop(now + first.duration / 1000)

    // Second tone (overlapping slightly)
    const osc2 = ctx.createOscillator()
    const gain2 = ctx.createGain()
    osc2.connect(gain2)
    gain2.connect(ctx.destination)
    osc2.frequency.value = second.frequency
    osc2.type = 'sine'

    const secondStart = now + first.duration / 1000 * 0.7
    gain2.gain.setValueAtTime(0, secondStart)
    gain2.gain.linearRampToValueAtTime(second.gain, secondStart + 0.01)
    gain2.gain.exponentialRampToValueAtTime(0.001, secondStart + second.duration / 1000)

    osc2.start(secondStart)
    osc2.stop(secondStart + second.duration / 1000)
  } catch (err) {
    console.warn('Failed to play sound:', err)
  }
}

/**
 * Play ascending two-tone chime for participant join
 * C5 (523.25Hz) → E5 (659.25Hz), ~150ms each
 */
export function playJoinSound(): void {
  playTwoTone(
    { frequency: 523.25, duration: 150, gain: 0.15 },
    { frequency: 659.25, duration: 150, gain: 0.15 }
  )
}

/**
 * Play descending two-tone chime for participant leave
 * E5 (659.25Hz) → C5 (523.25Hz), ~150ms each
 */
export function playLeaveSound(): void {
  playTwoTone(
    { frequency: 659.25, duration: 150, gain: 0.15 },
    { frequency: 523.25, duration: 150, gain: 0.15 }
  )
}

/**
 * Play single short ping for new chat message
 * A5 (880Hz), ~100ms with quick fade
 */
export function playChatSound(): void {
  playTone({ frequency: 880, duration: 100, gain: 0.2 })
}
