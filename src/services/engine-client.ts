/**
 * HTTP client for communicating with the BT Servant Engine API.
 */

import type { Env } from '../config/types';
import type { ChatRequest, ChatResponse } from '../types/engine';
import { logger } from '../utils/logger';

/** Client identifier for this gateway */
const CLIENT_ID = 'whatsapp';

/** HTTP status codes */
const HTTP_TOO_MANY_REQUESTS = 429;

/** Retry settings for 429 responses */
const MAX_RETRIES = 5;
const BASE_DELAY_MS = 2000;
const RETRY_MULTIPLIER = 1.5;

/**
 * Sleep for a specified number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
 * Make a request with retry on 429 (Too Many Requests).
 *
 * The worker returns 429 when a user's request is already being processed.
 */
async function fetchWithRetry(url: string, options: RequestInit): Promise<Response> {
  let response = await fetch(url, options);

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (response.status !== HTTP_TOO_MANY_REQUESTS) {
      return response;
    }

    // Get retry delay from header or use exponential backoff
    const retryAfter = response.headers.get('Retry-After');
    const delay = retryAfter
      ? parseFloat(retryAfter) * 1000
      : BASE_DELAY_MS * Math.pow(RETRY_MULTIPLIER, attempt);

    logger.info('User request already processing (429), retrying', {
      delay: `${delay}ms`,
      attempt: attempt + 1,
      maxRetries: MAX_RETRIES,
    });

    await sleep(delay);
    response = await fetch(url, options);
  }

  return response;
}

/**
 * Send a text message to the engine for processing.
 */
export async function sendTextMessage(
  userId: string,
  message: string,
  env: Env,
  progressCallbackUrl?: string,
  messageKey?: string
): Promise<ChatResponse | null> {
  const url = `${env.ENGINE_BASE_URL}/api/v1/chat`;

  const payload: ChatRequest = {
    client_id: CLIENT_ID,
    user_id: userId,
    message,
    message_type: 'text',
  };

  if (progressCallbackUrl && messageKey) {
    payload.progress_callback_url = progressCallbackUrl;
    payload.message_key = messageKey;
    payload.progress_throttle_seconds = parseFloat(env.PROGRESS_THROTTLE_SECONDS);
  }

  try {
    const response = await fetchWithRetry(url, {
      method: 'POST',
      headers: getAuthHeaders(env),
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Engine API error', { status: response.status, error: errorText });
      return null;
    }

    return (await response.json()) as ChatResponse;
  } catch (error) {
    logger.error('Engine connection error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
