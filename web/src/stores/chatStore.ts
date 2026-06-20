import { create } from 'zustand'
import type { ChatMessage } from '../types'

interface ChatStore {
  messages: ChatMessage[]
  historyLoaded: boolean
  addMessage: (msg: ChatMessage) => void
  loadMessages: (msgs: ChatMessage[]) => void
  markPersisted: (clientMessageId: string) => void
  reset: () => void
}

export const useChatStore = create<ChatStore>((set) => ({
  messages: [],
  historyLoaded: false,
  addMessage: (msg) =>
    set((state) => {
      // Deduplicate by client_message_id
      if (state.messages.some((m) => m.client_message_id === msg.client_message_id)) {
        return state
      }
      return { messages: [...state.messages, msg] }
    }),
  loadMessages: (msgs) =>
    set({
      messages: msgs.slice().reverse(), // API returns DESC, we need ASC
      historyLoaded: true,
    }),
  markPersisted: (clientMessageId) =>
    set((state) => ({
      messages: state.messages.map((m) =>
        m.client_message_id === clientMessageId ? { ...m, not_persisted: false } : m
      ),
    })),
  reset: () => set({ messages: [], historyLoaded: false }),
}))
