import { create } from 'zustand'
import type { StreamState, WhipInfo } from '../types'
import { saveSessionToStorage, loadSessionFromStorage } from './roomStore'

interface StreamStore {
  state: StreamState
  error: string | null
  whipInfo: WhipInfo | null
  streamSessionId: string | null
  setState: (state: StreamState) => void
  setError: (error: string | null) => void
  setWhipInfo: (info: WhipInfo | null) => void
  setStreamSessionId: (id: string | null) => void
  reset: () => void
}

// Persist stream info to storage for reconnection
const persistStreamInfo = (whipInfo: WhipInfo | null, streamSessionId: string | null) => {
  const session = loadSessionFromStorage()
  if (session) {
    saveSessionToStorage({ ...session, whipInfo, streamSessionId })
  }
}

export const useStreamStore = create<StreamStore>((set) => ({
  state: 'IDLE',
  error: null,
  whipInfo: null,
  streamSessionId: null,
  setState: (state) => set({ state, error: state === 'IDLE' ? null : undefined }),
  setError: (error) => set({ error }),
  setWhipInfo: (whipInfo) => {
    const { streamSessionId } = useStreamStore.getState()
    persistStreamInfo(whipInfo, streamSessionId)
    set({ whipInfo })
  },
  setStreamSessionId: (streamSessionId) => {
    const { whipInfo } = useStreamStore.getState()
    persistStreamInfo(whipInfo, streamSessionId)
    set({ streamSessionId })
  },
  reset: () => {
    const session = loadSessionFromStorage()
    if (session) {
      saveSessionToStorage({ ...session, whipInfo: null, streamSessionId: null })
    }
    set({ state: 'IDLE', error: null, whipInfo: null, streamSessionId: null })
  },
}))
