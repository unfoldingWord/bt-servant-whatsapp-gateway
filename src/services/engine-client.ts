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

/**
 * Send a message to the engine for queued processing.
 */
export async function sendMessage(
  userId: string,
  message: string,
  env: Env,
  callbackUrl: string,
  progressCallbackUrl?: string
): Promise<QueuedResponse | null> {
  const url = `${env.ENGINE_BASE_URL}/api/v1/message`;

  const payload: MessageRequest = {
    client_id: CLIENT_ID,
    user_id: userId,
    org_id: env.ENGINE_ORG,
    message,
    message_type: 'text',
    callback_url: callbackUrl,
  };

  if (progressCallbackUrl) {
    payload.progress_callback_url = progressCallbackUrl;
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
      logger.error('Engine API error', { status: response.status, error: errorText });
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
