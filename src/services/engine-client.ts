/**
 * HTTP client for communicating with the BT Servant Engine API.
 */

import type { Env } from '../config/types';
import type { MessageRequest, QueuedResponse } from '../types/engine';
import { logger } from '../utils/logger';

/** Client identifier for this gateway */
const CLIENT_ID = 'whatsapp';

/**
 * Get authorization headers for engine API.
 */
function getAuthHeaders(env: Env): Record<string, string> {
  return {
    Authorization: `Bearer ${env.ENGINE_API_KEY}`,
    'Content-Type': 'application/json',
  };
}

/** Optional audio payload to attach to an engine message */
export interface AudioPayload {
  audioBase64: string;
  audioFormat: string;
}

/** Optional parameters for sendMessage */
export interface SendMessageOptions {
  progressCallbackUrl?: string;
  audio?: AudioPayload;
}

/**
 * Send a message to the engine for queued processing.
 */
export async function sendMessage(
  userId: string,
  message: string | undefined,
  env: Env,
  messageKey: string,
  options?: SendMessageOptions
): Promise<QueuedResponse | null> {
  const url = `${env.ENGINE_BASE_URL}/api/v1/chat/queue`;
  const { progressCallbackUrl, audio } = options ?? {};

  const payload: MessageRequest = {
    client_id: CLIENT_ID,
    user_id: userId,
    org: env.ENGINE_ORG,
    message_type: audio ? 'audio' : 'text',
    message_key: messageKey,
    ...(message !== undefined ? { message } : {}),
  };

  if (audio) {
    payload.audio_base64 = audio.audioBase64;
    payload.audio_format = audio.audioFormat;
  }

  if (progressCallbackUrl) {
    payload.progress_callback_url = progressCallbackUrl;
    payload.progress_mode = 'iteration';
    payload.progress_throttle_seconds = parseFloat(env.PROGRESS_THROTTLE_SECONDS);
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: getAuthHeaders(env),
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Engine API error', { url, status: response.status, error: errorText });
      return null;
    }

    return (await response.json()) as QueuedResponse;
  } catch (error) {
    logger.error('Engine connection error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
