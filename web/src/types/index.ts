export type RoomState = 'NOT_CONNECTED' | 'CONNECTING' | 'CONNECTED' | 'DISCONNECTED'
export type StreamState = 'IDLE' | 'PROVISIONING' | 'AWAITING_STREAM' | 'LIVE' | 'STOPPING' | 'FAILED'
export type NoiseSuppressionMode = 'krisp' | 'standard' | 'off'

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

export interface RoomStatus {
  room_id: string
  status: string
  active_stream: boolean
  active_broadcaster_session_id: string | null
  participant_count: number
}

export interface JoinResult {
  room_id: string
  participant_session_id: string
  livekit_token: string
  livekit_url: string
  role: string
  muted_by_owner: boolean
  active_stream?: {
    stream_session_id: string
    state: string
  }
}

export interface RejoinResult {
  room_id: string
  participant_session_id: string
  livekit_token: string
  livekit_url: string
  role: string
  display_name: string
  muted_by_owner: boolean
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
