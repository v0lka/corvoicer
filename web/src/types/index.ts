export type RoomState = 'NOT_CONNECTED' | 'CONNECTING' | 'CONNECTED' | 'DISCONNECTED'
export type StreamState = 'IDLE' | 'PROVISIONING' | 'AWAITING_STREAM' | 'LIVE' | 'STOPPING' | 'FAILED'

export interface WhipInfo {
  whip_url: string
  whip_bearer_token: string
}

export interface RoomInfo {
  room_id: string
  invite_token: string
  invite_url: string
  owner_session_id: string
  livekit_token: string
  livekit_url: string
}

export interface JoinResult {
  room_id: string
  participant_session_id: string
  livekit_token: string
  livekit_url: string
  role: string
}

export interface RejoinResult {
  room_id: string
  participant_session_id: string
  livekit_token: string
  livekit_url: string
  role: string
  display_name: string
  active_stream?: {
    stream_session_id: string
    state: string
  }
}

export interface ChatMessage {
  message_id: string
  participant_session_id: string
  client_message_id: string
  text: string
  created_at: string
  not_persisted?: boolean
  display_name?: string
}
