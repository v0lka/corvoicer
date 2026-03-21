import { useEffect, useCallback, useRef, useState } from 'react'
import { Room, RoomEvent, type ChatMessage as LKChatMessage } from 'livekit-client'
import type { RemoteParticipant, LocalParticipant } from 'livekit-client'
import { useChatStore } from '../stores/chatStore'
import { useRoomStore } from '../stores/roomStore'
import { api } from '../services/api'
import type { ChatMessage } from '../types'
import { logger } from '../utils/logger'

export function useChat(room: Room | null) {
  const addMessage = useChatStore((s) => s.addMessage)
  const loadMessages = useChatStore((s) => s.loadMessages)
  const historyLoaded = useChatStore((s) => s.historyLoaded)
  const subscribedRef = useRef(false)
  const [loadingHistory, setLoadingHistory] = useState(false)

  useEffect(() => {
    if (!room || subscribedRef.current) return

    const handleChatMessage = (lkMsg: LKChatMessage, participant?: RemoteParticipant | LocalParticipant) => {
      // Skip messages from local participant (we add those optimistically)
      if (participant && participant.identity === room.localParticipant.identity) return

      const msg: ChatMessage = {
        message_id: lkMsg.id,
        participant_session_id: participant?.identity ?? 'unknown',
        client_message_id: lkMsg.id,
        text: lkMsg.message,
        created_at: new Date(lkMsg.timestamp).toISOString(),
        display_name: participant?.name || undefined,
      }
      addMessage(msg)
    }

    room.on(RoomEvent.ChatMessage, handleChatMessage)
    subscribedRef.current = true

    return () => {
      room.off(RoomEvent.ChatMessage, handleChatMessage)
      subscribedRef.current = false
    }
  }, [room, addMessage])

  const loadHistory = useCallback(async () => {
    if (historyLoaded || loadingHistory) return
    const roomId = useRoomStore.getState().roomId
    if (!roomId) return
    setLoadingHistory(true)
    try {
      const result = await api.getChatHistory(roomId)
      loadMessages(result.messages || [])
    } catch (err) {
      logger.error('Failed to load chat history:', err)
    } finally {
      setLoadingHistory(false)
    }
  }, [historyLoaded, loadingHistory, loadMessages])

  const sendMessage = useCallback(async (text: string) => {
    if (!room || !text.trim()) return

    const clientMessageId = crypto.randomUUID()

    // Add to local store immediately (optimistic)
    const localMsg: ChatMessage = {
      message_id: clientMessageId,
      participant_session_id: room.localParticipant.identity,
      client_message_id: clientMessageId,
      text,
      created_at: new Date().toISOString(),
      not_persisted: true,
      display_name: room.localParticipant.name || undefined,
    }
    addMessage(localMsg)

    try {
      await room.localParticipant.sendChatMessage(text)
    } catch (err) {
      logger.error('Failed to send chat message:', err)
    }
  }, [room, addMessage])

  return { sendMessage, loadHistory, loadingHistory }
}
