export type WSStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

export interface WSNotification {
  id: number
  type: string
  message: string
  ticket_id?: number | null
}

export interface WSTicketUpdate {
  ticket_id: number
  field: string
  old_value: string | null
  new_value: string | null
  status?: string
  updated_by: string
}

export interface WSComment {
  id: number
  content: string
  is_internal: boolean
  user: { id: number; first_name: string; last_name: string; username: string }
  created_at: string
}

export interface WSMessage {
  id: number
  content: string
  sender_id: number
  receiver_id: number
  sender: { id: number; first_name: string; last_name: string; username: string }
  ticket_id?: number | null
  created_at: string
}

export interface WSEnvelope {
  type: 'connected' | 'pong' | 'subscribed' | 'notification' |
        'ticket_updated' | 'comment_added' | 'message_received' | 'error'
  payload: any
}
