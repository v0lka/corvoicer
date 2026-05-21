import { useState, useRef, useEffect, useCallback } from 'react'
import { useChatStore } from '../stores/chatStore'
import Picker from '@emoji-mart/react'
import data from '@emoji-mart/data'

interface Props {
  onSend: (text: string) => void
  disabled: boolean
  loadingHistory?: boolean
}

export function ChatPanel({ onSend, disabled, loadingHistory }: Props) {
  const messages = useChatStore((s) => s.messages)
  const [input, setInput] = useState('')
  const [showEmoji, setShowEmoji] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const emojiRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Scroll to bottom when messages change
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight
    }
  }, [messages])

  useEffect(() => {
    if (!showEmoji) return
    const handleClickOutside = (e: MouseEvent) => {
      if (emojiRef.current && !emojiRef.current.contains(e.target as Node)) {
        setShowEmoji(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showEmoji])

  const handleSend = () => {
    const text = input.trim()
    if (!text) return
    onSend(text)
    setInput('')
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleEmojiSelect = useCallback((emoji: { native: string }) => {
    const el = inputRef.current
    if (el) {
      const start = el.selectionStart ?? input.length
      const end = el.selectionEnd ?? input.length
      const newValue = input.slice(0, start) + emoji.native + input.slice(end)
      setInput(newValue)
      // Restore cursor after emoji
      requestAnimationFrame(() => {
        const pos = start + emoji.native.length
        el.setSelectionRange(pos, pos)
        el.focus()
      })
    } else {
      setInput((prev) => prev + emoji.native)
    }
    setShowEmoji(false)
  }, [input])

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="px-3 py-2 border-b border-slate-700/50 shrink-0">
        <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">Chat</span>
      </div>
      <div
        ref={messagesContainerRef}
        className="flex-1 overflow-y-auto overflow-x-hidden px-3 py-2 space-y-1.5 min-h-0"
      >
        {loadingHistory && (
          <p className="text-slate-500 text-xs text-center mt-4 animate-pulse">Loading messages...</p>
        )}
        {!loadingHistory && messages.length === 0 && (
          <p className="text-slate-600 text-xs text-center mt-4">No messages yet</p>
        )}
        {messages.map((msg) => (
          <div key={msg.client_message_id} className="text-sm break-words overflow-wrap-break-word">
            <span className="text-slate-400 text-xs font-mono">
              {msg.display_name || msg.participant_session_id.slice(0, 6)}
            </span>
            <span className="text-slate-300 ml-1.5 break-words">{msg.text}</span>
            {msg.not_persisted && (
              <span className="text-yellow-500 text-xs ml-1 animate-pulse" title="Saving...">*</span>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <div className="px-3 py-2 border-t border-slate-700/50 shrink-0">
        <div className="relative">
          {showEmoji && (
            <div ref={emojiRef} className="absolute bottom-full mb-2 right-0 z-50">
              <Picker data={data} onEmojiSelect={handleEmojiSelect} theme="dark" previewPosition="none" skinTonePosition="none" />
            </div>
          )}
          <div className="flex gap-2">
            <div className="flex-1 flex items-center bg-slate-800 border border-slate-600 rounded focus-within:border-slate-400">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={disabled}
                placeholder={disabled ? 'Join a room to chat' : 'Type a message...'}
                className="flex-1 bg-transparent px-2 py-1.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none disabled:opacity-50"
              />
              <button
                type="button"
                onClick={() => setShowEmoji((v) => !v)}
                disabled={disabled}
                className="px-1.5 text-slate-400 hover:text-slate-200 disabled:opacity-50"
                title="Emoji"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M8 14s1.5 2 4 2 4-2 4-2" />
                  <line x1="9" y1="9" x2="9.01" y2="9" />
                  <line x1="15" y1="9" x2="15.01" y2="9" />
                </svg>
              </button>
            </div>
            <button
              onClick={handleSend}
              disabled={disabled || !input.trim()}
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
