import { create } from 'zustand'

export interface Participant {
  identity: string
  displayName: string
  isSpeaking: boolean
  isLocal: boolean
}

interface ParticipantStore {
  participants: Map<string, Participant>
  setParticipants: (list: Participant[]) => void
  addParticipant: (p: Participant) => void
  removeParticipant: (identity: string) => void
  updateSpeaking: (speakerIdentities: string[]) => void
  reset: () => void
}

export const useParticipantStore = create<ParticipantStore>((set) => ({
  participants: new Map(),
  setParticipants: (list) =>
    set({
      participants: new Map(list.map((p) => [p.identity, p])),
    }),
  addParticipant: (p) =>
    set((state) => {
      const map = new Map(state.participants)
      map.set(p.identity, p)
      return { participants: map }
    }),
  removeParticipant: (identity) =>
    set((state) => {
      const map = new Map(state.participants)
      map.delete(identity)
      return { participants: map }
    }),
  updateSpeaking: (speakerIdentities) =>
    set((state) => {
      const map = new Map(state.participants)
      // Reset all to not speaking
      map.forEach((p, key) => {
        map.set(key, { ...p, isSpeaking: false })
      })
      // Set active speakers
      speakerIdentities.forEach((identity) => {
        const p = map.get(identity)
        if (p) {
          map.set(identity, { ...p, isSpeaking: true })
        }
      })
      return { participants: map }
    }),
  reset: () => set({ participants: new Map() }),
}))
