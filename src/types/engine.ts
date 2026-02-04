/**
 * Types for communicating with the BT Servant Engine API.
 */

/** Request body for the /api/v1/chat endpoint */
export interface ChatRequest {
  client_id: string;
  user_id: string;
  message: string;
  message_type: 'text' | 'audio';
  message_key?: string;
  progress_callback_url?: string;
  progress_throttle_seconds?: number;
}

/** Response from the /api/v1/chat endpoint */
export interface ChatResponse {
  responses: string[];
  response_language: string;
  voice_audio_base64: string | null;
}

/** Payload received from engine progress callbacks */
export interface ProgressCallback {
  user_id: string;
  message_key: string;
  text: string;
  timestamp: number;
}
