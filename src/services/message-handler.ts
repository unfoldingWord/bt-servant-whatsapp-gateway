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
import type { EngineCallback } from '../types/engine';
import { sendTextMessage as sendToWhatsApp, sendTypingIndicator } from './meta-api/client';
import { sendMessage as sendToEngine } from './engine-client';
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
 * Get the progress callback URL.
 * GATEWAY_PUBLIC_URL is validated in the route handler before this is called.
 */
function getProgressCallbackUrl(env: Env): string {
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
 * Validate an incoming message. Returns the message if valid, undefined if it should be skipped.
 */
async function validateMessage(message: IncomingMessage, env: Env): Promise<boolean> {
  const cutoffSeconds = parseInt(env.MESSAGE_AGE_CUTOFF_SECONDS, 10);

  if (!isSupportedType(message.messageType)) {
    logger.warn('Unsupported message type', { type: message.messageType });
    return false;
  }

  if (isMessageTooOld(message.timestamp, cutoffSeconds)) {
    const age = Math.floor(Date.now() / 1000) - message.timestamp;
    logger.warn('Message too old, dropping', { age, cutoff: cutoffSeconds });
    return false;
  }

  if (message.messageType === 'audio') {
    await sendToWhatsApp(
      message.userId,
      'Voice messages are temporarily unavailable. Please send a text message.',
      env
    );
    return false;
  }

  return true;
}

/**
 * Process a single incoming message.
 */
async function processMessage(raw: RawMessage, contacts: Contact[], env: Env): Promise<void> {
  const message = parseMessage(raw, contacts);

  logger.info('Received message', {
    type: message.messageType,
    messageId: message.messageId,
    userId: message.userId.slice(0, 8) + '...',
  });

  if (!(await validateMessage(message, env))) return;

  await sendTypingIndicator(message.messageId, env);

  const result = await sendToEngine(
    message.userId,
    message.text,
    env,
    message.messageId,
    getProgressCallbackUrl(env)
  );

  if (!result) {
    logger.error('Failed to queue message with engine');
    await sendToWhatsApp(
      message.userId,
      'Sorry, I encountered an error processing your message. Please try again.',
      env
    );
    return;
  }

  logger.info('Message queued', {
    messageId: result.message_id,
    queuePosition: result.queue_position,
  });
}

/**
 * Send response(s) back to the user.
 */
export async function sendResponses(userId: string, responses: string[], env: Env): Promise<void> {
  const chunkSize = parseInt(env.CHUNK_SIZE, 10);

  for (const text of responses) {
    const chunks = chunkMessage(text, chunkSize);
    for (const chunk of chunks) {
      const sent = await sendToWhatsApp(userId, chunk, env);
      if (!sent) {
        throw new Error(`Failed to send WhatsApp message to ${userId.slice(0, 8)}...`);
      }
    }
  }
}

function isNonEmptyString(value: unknown): boolean {
  return typeof value === 'string' && value.length > 0;
}

const VALID_CALLBACK_TYPES = ['status', 'progress', 'complete', 'error'];

/**
 * Validate type-specific required fields on a callback payload.
 * Returns an error string if invalid, null if valid.
 */
function validateCallbackFields(type: string, p: Record<string, unknown>): string | null {
  if ((type === 'progress' || type === 'complete') && !isNonEmptyString(p.text)) {
    return `Missing or invalid text for ${type} callback`;
  }
  if (type === 'error' && !isNonEmptyString(p.error)) {
    return 'Missing or invalid error for error callback';
  }
  return null;
}

/**
 * Validate an engine callback payload has the required shape.
 * Returns an error string if invalid, null if valid.
 */
export function validateEngineCallback(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) {
    return 'Payload must be an object';
  }

  const p = payload as Record<string, unknown>;

  if (!isNonEmptyString(p.type) || !VALID_CALLBACK_TYPES.includes(p.type as string)) {
    return 'Missing or invalid type';
  }
  if (!isNonEmptyString(p.user_id)) return 'Missing or invalid user_id';
  if (!isNonEmptyString(p.message_key)) return 'Missing or invalid message_key';

  return validateCallbackFields(p.type as string, p);
}

/**
 * Handle an engine callback, dispatching by type.
 */
export async function handleEngineCallback(callback: EngineCallback, env: Env): Promise<void> {
  logger.info('Engine callback received', {
    type: callback.type,
    userId: callback.user_id.slice(0, 8) + '...',
    messageKey: callback.message_key,
  });

  if (callback.type === 'progress') {
    if (callback.text) {
      await sendToWhatsApp(callback.user_id, callback.text, env);
    }
  } else if (callback.type === 'complete') {
    if (callback.text) {
      await sendResponses(callback.user_id, [callback.text], env);
    }
  } else if (callback.type === 'error') {
    const errorMsg = callback.error ?? 'Unknown error';
    logger.error('Engine reported error', { error: errorMsg });
    const sent = await sendToWhatsApp(
      callback.user_id,
      'Sorry, I encountered an error processing your message. Please try again.',
      env
    );
    if (!sent) {
      throw new Error(`Failed to send error message to ${callback.user_id.slice(0, 8)}...`);
    }
  } else {
    logger.info('Status callback', { message: callback.message });
  }
}
