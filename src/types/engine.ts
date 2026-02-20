/**
 * Types for communicating with the BT Servant Engine API.
 */

/** Request body for the /api/v1/message endpoint */
export interface MessageRequest {
  client_id: string;
  user_id: string;
  org_id: string;
  message: string;
  message_type: 'text' | 'audio';
  callback_url: string;
  progress_callback_url?: string;
  progress_throttle_seconds?: number;
  audio_base64?: string;
  audio_format?: string;
}

/** Response from the /api/v1/message endpoint */
export interface QueuedResponse {
  message_id: string;
  queue_position: number;
}

/** Payload received from engine completion callbacks */
export interface CompletionCallback {
  message_id: string;
  user_id: string;
  status: 'completed' | 'error';
  responses?: string[];
  response_language?: string;
  voice_audio_base64?: string;
  error?: string;
}

/** Payload received from engine progress callbacks */
export interface ProgressCallback {
  user_id: string;
  message_key: string;
  text: string;
  timestamp: number;
}
