import { create } from 'zustand'
import type { RoomState, WhipInfo } from '../types'

interface RoomStore {
  state: RoomState
  roomId: string | null
  participantId: string | null
  inviteToken: string | null
  role: 'owner' | 'member' | null
  reconnecting: boolean
  setState: (state: RoomState) => void
  setRoomInfo: (roomId: string, participantId: string, role: 'owner' | 'member', inviteToken?: string) => void
  setReconnecting: (status: boolean) => void
  setRole: (role: string) => void
  reset: () => void
}

const STORAGE_KEY = 'corvoicer_session'

interface StoredSession {
  roomId: string
  participantId: string
  inviteToken: string | null
  role: 'owner' | 'member'
  whipInfo: WhipInfo | null
  streamSessionId: string | null
}

export const saveSessionToStorage = (session: StoredSession) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
  } catch {
    // Ignore storage errors
  }
}

export const loadSessionFromStorage = (): StoredSession | null => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      return JSON.parse(stored) as StoredSession
    }
  } catch {
    // Ignore storage errors
  }
  return null
}

export const clearSessionStorage = () => {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Ignore storage errors
  }
}

export const useRoomStore = create<RoomStore>((set) => ({
  state: 'NOT_CONNECTED',
  roomId: null,
  participantId: null,
  inviteToken: null,
  role: null,
  reconnecting: false,
  setState: (state) => set({ state }),
  setRoomInfo: (roomId, participantId, role, inviteToken) => {
    // Persist to localStorage for reconnection on refresh
    saveSessionToStorage({ roomId, participantId, role, inviteToken: inviteToken ?? null, whipInfo: null, streamSessionId: null })
    set({ roomId, participantId, role, inviteToken: inviteToken ?? null })
  },
  setReconnecting: (status) => set({ reconnecting: status }),
  setRole: (role) => set({ role: role as 'owner' | 'member' | null }),
  reset: () => {
    clearSessionStorage()
    set({ state: 'NOT_CONNECTED', roomId: null, participantId: null, inviteToken: null, role: null, reconnecting: false })
  },
}))
