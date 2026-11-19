/**
 * Types for communicating with the BT Servant Engine API.
 */

/** Request body for the /api/v1/chat endpoint */
export interface MessageRequest {
  client_id: string;
  user_id: string;
  org: string;
  message?: string;
  message_type: 'text' | 'audio';
  message_key: string;
  progress_callback_url?: string;
  progress_mode?: 'complete' | 'iteration' | 'periodic' | 'sentence';
  progress_throttle_seconds?: number;
  audio_base64?: string;
  audio_format?: string;
  /** This gateway sends `share_qr` from complete callbacks (worker#474). */
  accepts_share_qr?: boolean;
}

/** Response from the /api/v1/chat endpoint */
export interface ChatResponse {
  message_id: string;
}

/** Callback type discriminator from the engine */
export type EngineCallbackType = 'status' | 'progress' | 'complete' | 'error';

/** A file attachment delivered alongside a complete callback. */
export interface EngineAttachment {
  type: 'pdf';
  url: string;
  filename: string;
  size_bytes: number;
  mime_type: 'application/pdf';
}

/** One-time share QR image on a complete callback (worker#474). */
export interface ShareQrMedia {
  /** Public HTTPS URL of the PNG (signed by the worker). */
  url: string;
  /** Caption in the user's language, ending with the wa.me link. */
  caption: string;
  /** Mode code the QR opens; null for the bare BT Servant link. */
  code: string | null;
}

/** Unified payload received from engine callbacks */
export interface EngineCallback {
  type: EngineCallbackType;
  user_id: string;
  message_key: string;
  timestamp: string;
  text?: string;
  message?: string;
  error?: string;
  voice_audio_base64?: string;
  voice_audio_url?: string;
  attachments?: EngineAttachment[];
  /** One-time share QR, sent as its own image after the answer (worker#474). */
  share_qr?: ShareQrMedia;
}
