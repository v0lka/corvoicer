export const api = {
  async validateAdminToken(adminToken: string) {
    const response = await fetch('/api/v1/auth/validate-admin-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ admin_token: adminToken })
    })
    if (!response.ok) throw new Error(`Validate admin token failed: ${response.statusText}`)
    return await response.json() as { valid: boolean }
  },

  async createRoom(displayName: string, adminToken: string) {
    const response = await fetch('/api/v1/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ owner_display_name: displayName, admin_token: adminToken })
    })
    if (!response.ok) throw new Error(`Create room failed: ${response.statusText}`)
    return await response.json()
  },

  async joinRoom(inviteToken: string, displayName: string) {
    const response = await fetch('/api/v1/rooms/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ invite_token: inviteToken, display_name: displayName })
    })
    if (!response.ok) throw new Error(`Join room failed: ${response.statusText}`)
    return await response.json()
  },

  async rejoinRoom(participantSessionId: string) {
    const response = await fetch('/api/v1/rooms/rejoin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ participant_session_id: participantSessionId })
    })
    if (!response.ok) throw new Error(`Rejoin room failed: ${response.statusText}`)
    return await response.json()
  },

  async leaveRoom(roomId: string, participantSessionId: string) {
    const response = await fetch(`/api/v1/rooms/${roomId}/leave`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ participant_session_id: participantSessionId })
    })
    if (!response.ok) throw new Error(`Leave room failed: ${response.statusText}`)
    return await response.json()
  },

  async startStream(roomId: string, participantSessionId: string) {
    const response = await fetch(`/api/v1/rooms/${roomId}/stream/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ participant_session_id: participantSessionId })
    })
    if (!response.ok) throw new Error(`Start stream failed: ${response.statusText}`)
    return await response.json()
  },

  async stopStream(roomId: string, participantSessionId: string, streamSessionId: string) {
    const response = await fetch(`/api/v1/rooms/${roomId}/stream/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        participant_session_id: participantSessionId,
        stream_session_id: streamSessionId
      })
    })
    if (!response.ok) throw new Error(`Stop stream failed: ${response.statusText}`)
    return await response.json()
  },

  async sendChatMessage(roomId: string, participantSessionId: string, clientMessageId: string, text: string) {
    const response = await fetch(`/api/v1/rooms/${roomId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        participant_session_id: participantSessionId,
        client_message_id: clientMessageId,
        text
      })
    })
    if (!response.ok) throw new Error(`Send message failed: ${response.statusText}`)
    return await response.json()
  },

  async getChatHistory(roomId: string) {
    const response = await fetch(`/api/v1/rooms/${roomId}/messages`)
    if (!response.ok) throw new Error(`Get chat history failed: ${response.statusText}`)
    return await response.json()
  },
}
