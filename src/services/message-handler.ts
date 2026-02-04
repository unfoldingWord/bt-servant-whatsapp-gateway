/**
 * Message handling service - orchestrates message processing.
 */

import type { Env } from '../config/types';
import type {
  IncomingMessage,
  MessageType,
  RawMessage,
  Contact,
  WebhookPayload,
} from '../types/meta';
import type { ChatResponse, ProgressCallback } from '../types/engine';
import { sendTextMessage as sendToWhatsApp, sendTypingIndicator } from './meta-api/client';
import { sendTextMessage as sendToEngine } from './engine-client';
import { chunkMessage } from './chunking';
import { logger } from '../utils/logger';

/**
 * Parse a raw message from Meta webhook into IncomingMessage.
 */
export function parseMessage(raw: RawMessage, contacts: Contact[]): IncomingMessage {
  const msgType = parseMessageType(raw.type);
  const text = extractText(raw, msgType);
  const mediaId = raw.audio?.id;

  return {
    userId: contacts[0]?.wa_id ?? raw.from,
    messageId: raw.id,
    messageType: msgType,
    timestamp: parseInt(raw.timestamp, 10),
    text,
    mediaId,
  };
}

function parseMessageType(type: string): MessageType {
  const validTypes: MessageType[] = [
    'text',
    'audio',
    'image',
    'document',
    'sticker',
    'location',
    'contacts',
    'interactive',
    'button',
  ];
  if (validTypes.includes(type as MessageType)) {
    return type as MessageType;
  }
  return 'unknown';
}

function extractTextFromText(raw: RawMessage): string {
  return raw.text?.body ?? '';
}

function extractTextFromInteractive(raw: RawMessage): string {
  const interactive = raw.interactive;
  return interactive?.button_reply?.title ?? interactive?.list_reply?.title ?? '';
}

function extractTextFromButton(raw: RawMessage): string {
  return raw.button?.text ?? '';
}

function extractText(raw: RawMessage, type: MessageType): string {
  if (type === 'text') return extractTextFromText(raw);
  if (type === 'interactive') return extractTextFromInteractive(raw);
  if (type === 'button') return extractTextFromButton(raw);
  return '';
}

/**
 * Check if message type is supported for processing.
 */
function isSupportedType(type: MessageType): boolean {
  return type === 'text' || type === 'audio';
}

/**
 * Check if message is older than the cutoff threshold.
 */
function isMessageTooOld(timestamp: number, cutoffSeconds: number): boolean {
  const now = Math.floor(Date.now() / 1000);
  return now - timestamp > cutoffSeconds;
}

/**
 * Get the progress callback URL if configured.
 */
function getProgressCallbackUrl(env: Env): string | undefined {
  if (!env.GATEWAY_PUBLIC_URL) {
    return undefined;
  }
  return `${env.GATEWAY_PUBLIC_URL.replace(/\/$/, '')}/progress-callback`;
}

/**
 * Handle incoming webhook payload from Meta.
 */
export async function handleWebhook(payload: WebhookPayload, env: Env): Promise<void> {
  for (const entry of payload.entry) {
    for (const change of entry.changes) {
      if (change.field !== 'messages') continue;

      const contacts = change.value.contacts ?? [];
      for (const raw of change.value.messages ?? []) {
        await processMessage(raw, contacts, env);
      }
    }
  }
}

/**
 * Process a single incoming message.
 */
async function processMessage(raw: RawMessage, contacts: Contact[], env: Env): Promise<void> {
  const message = parseMessage(raw, contacts);
  const cutoffSeconds = parseInt(env.MESSAGE_AGE_CUTOFF_SECONDS, 10);

  logger.info('Received message', {
    type: message.messageType,
    messageId: message.messageId,
    userId: message.userId.slice(0, 8) + '...',
  });

  // Skip unsupported message types
  if (!isSupportedType(message.messageType)) {
    logger.warn('Unsupported message type', { type: message.messageType });
    return;
  }

  // Skip old messages
  if (isMessageTooOld(message.timestamp, cutoffSeconds)) {
    const age = Math.floor(Date.now() / 1000) - message.timestamp;
    logger.warn('Message too old, dropping', { age, cutoff: cutoffSeconds });
    return;
  }

  // Reject voice messages (worker doesn't support STT)
  if (message.messageType === 'audio') {
    await sendToWhatsApp(
      message.userId,
      'Voice messages are temporarily unavailable. Please send a text message.',
      env
    );
    return;
  }

  // Send typing indicator
  await sendTypingIndicator(message.messageId, env);

  // Call engine (pass messageId as message_key for progress callbacks)
  const response = await sendToEngine(
    message.userId,
    message.text,
    env,
    getProgressCallbackUrl(env),
    message.messageId
  );

  if (!response) {
    logger.error('Failed to get response from engine');
    await sendToWhatsApp(
      message.userId,
      'Sorry, I encountered an error processing your message. Please try again.',
      env
    );
    return;
  }

  // Send responses back to user
  await sendResponses(message.userId, response, env);
}

/**
 * Send response(s) back to the user.
 */
async function sendResponses(userId: string, response: ChatResponse, env: Env): Promise<void> {
  const chunkSize = parseInt(env.CHUNK_SIZE, 10);

  // Send voice response if available (not supported in worker)
  // If voice_audio_base64 is present, we could send it but Workers can't upload media
  // So we always fall back to text

  // Send text responses (may need chunking)
  for (const text of response.responses) {
    const chunks = chunkMessage(text, chunkSize);
    for (const chunk of chunks) {
      await sendToWhatsApp(userId, chunk, env);
    }
  }
}

/**
 * Handle a progress callback from the engine.
 */
export async function handleProgressCallback(callback: ProgressCallback, env: Env): Promise<void> {
  logger.info('Progress callback received', {
    userId: callback.user_id.slice(0, 8) + '...',
    messageKey: callback.message_key,
  });

  await sendToWhatsApp(callback.user_id, callback.text, env);
}
