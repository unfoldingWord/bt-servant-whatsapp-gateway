/**
 * WhatsApp Gateway - Cloudflare Worker
 *
 * Receives webhook events from Meta (WhatsApp messages), validates signatures,
 * and forwards messages to the BT Servant Engine API.
 *
 * Uses waitUntil() pattern to return 200 immediately and process in background.
 */

import { Hono } from 'hono';
import type { Env } from './config/types';
import type { WebhookPayload } from './types/meta';
import type { EngineCallback } from './types/engine';
import { verifyFacebookSignature } from './services/meta-api/signature';
import { sendTextMessage } from './services/meta-api/client';
import {
  handleWebhook,
  handleEngineCallback,
  validateEngineCallback,
} from './services/message-handler';
import { processStatusEntries } from './services/meta-api/status-webhook';
import { logger } from './utils/logger';

function hasStatusEntries(payload: WebhookPayload): boolean {
  for (const entry of payload.entry) {
    for (const change of entry.changes) {
      if (change.value.statuses && change.value.statuses.length > 0) return true;
    }
  }
  return false;
}

function hasInboundMessages(payload: WebhookPayload): boolean {
  for (const entry of payload.entry) {
    for (const change of entry.changes) {
      if (change.value.messages && change.value.messages.length > 0) return true;
    }
  }
  return false;
}

function processStatusesIfPresent(payload: WebhookPayload): void {
  if (!hasStatusEntries(payload)) return;
  try {
    processStatusEntries(payload);
  } catch (error) {
    logger.error('Error processing status entries', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Extract the first sender's phone number from a webhook payload.
 * Returns undefined if no sender can be identified.
 */
function extractFirstSender(payload: WebhookPayload): string | undefined {
  for (const entry of payload.entry) {
    for (const change of entry.changes) {
      const contacts = change.value.contacts;
      if (contacts?.[0]?.wa_id) return contacts[0].wa_id;
      const messages = change.value.messages;
      if (messages?.[0]?.from) return messages[0].from;
    }
  }
  return undefined;
}

/** Cooldown map to avoid spamming users with misconfig messages on retries. */
const misconfigNotified = new Map<string, number>();
const MISCONFIG_COOLDOWN_MS = 300_000; // 5 minutes

/**
 * Best-effort notify the sender that the service is misconfigured.
 * Deduplicates by sender so Meta retries don't spam the user.
 * Returns the Promise to pass to waitUntil, or undefined if skipped.
 */
function notifyMisconfigOnce(payload: WebhookPayload, env: Env): Promise<boolean> | undefined {
  const sender = extractFirstSender(payload);
  if (!sender) return undefined;

  const now = Date.now();

  // Sweep expired entries to bound map size
  for (const [key, expiresAt] of misconfigNotified) {
    if (expiresAt < now) misconfigNotified.delete(key);
  }

  const notifiedUntil = misconfigNotified.get(sender);
  if (notifiedUntil !== undefined && notifiedUntil > now) return undefined;

  misconfigNotified.set(sender, now + MISCONFIG_COOLDOWN_MS);
  return sendTextMessage(
    sender,
    'Sorry, the service is temporarily misconfigured. Please try again later.',
    env
  ).catch(() => false as const);
}

const app = new Hono<{ Bindings: Env }>();

// Health check endpoints (always available, even if misconfigured)
app.get('/health', (c) => c.json({ status: 'healthy' }));
app.get('/', (c) => c.json({ service: 'whatsapp-gateway', status: 'running' }));

/**
 * Webhook verification (GET).
 *
 * Meta sends a GET request with hub.mode, hub.verify_token, and hub.challenge
 * to verify the webhook URL during setup.
 */
app.get('/meta-whatsapp', (c) => {
  const mode = c.req.query('hub.mode');
  const token = c.req.query('hub.verify_token');
  const challenge = c.req.query('hub.challenge');

  if (mode === 'subscribe' && token === c.env.META_VERIFY_TOKEN) {
    logger.info('Webhook verified successfully');
    return c.text(challenge ?? '', 200);
  }

  logger.warn('Webhook verification failed', { mode, tokenProvided: !!token });
  return c.text('Forbidden', 403);
});

/**
 * Webhook handler (POST) - uses waitUntil pattern.
 *
 * Returns 200 immediately to Meta, then processes the webhook in the background.
 * This prevents Meta from timing out and retrying during long AI processing.
 */
async function authenticateWebhookRequest(
  body: string,
  sig256: string | null,
  sig1: string | null,
  userAgent: string | undefined,
  env: Env
): Promise<{ ok: true } | { ok: false; status: 401; reason: string }> {
  const isValid = await verifyFacebookSignature(body, sig256, sig1, env.META_APP_SECRET);
  if (!isValid) return { ok: false, status: 401, reason: 'Invalid webhook signature' };
  if (userAgent?.trim() !== env.FACEBOOK_USER_AGENT) {
    return { ok: false, status: 401, reason: 'Invalid user agent' };
  }
  return { ok: true };
}

app.post('/meta-whatsapp', async (c) => {
  const sig256 = c.req.header('X-Hub-Signature-256') ?? null;
  const sig1 = c.req.header('X-Hub-Signature') ?? null;
  const userAgent = c.req.header('User-Agent');
  const body = await c.req.text();

  const auth = await authenticateWebhookRequest(body, sig256, sig1, userAgent, c.env);
  if (!auth.ok) {
    logger.error(auth.reason);
    return c.text('Unauthorized', auth.status);
  }

  let payload: WebhookPayload;
  try {
    payload = JSON.parse(body) as WebhookPayload;
  } catch {
    logger.error('Invalid JSON in webhook');
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  // Status logging runs ahead of the misconfig gate — most valuable when
  // delivery-side config is broken.
  processStatusesIfPresent(payload);

  if (!hasInboundMessages(payload)) {
    return c.text('OK', 200);
  }

  if (!c.env.GATEWAY_PUBLIC_URL) {
    logger.error('GATEWAY_PUBLIC_URL not configured — cannot deliver responses');
    const notify = notifyMisconfigOnce(payload, c.env);
    if (notify) c.executionCtx.waitUntil(notify);
    return c.text('Service misconfigured', 503);
  }

  c.executionCtx.waitUntil(
    handleWebhook(payload, c.env).catch((error) => {
      logger.error('Error processing webhook', {
        error: error instanceof Error ? error.message : String(error),
      });
    })
  );

  return c.text('OK', 200);
});

/**
 * In-memory map for atomic complete-callback deduplication.
 *
 * Because JS is single-threaded, the synchronous get()+set() below is atomic
 * within an isolate — no concurrent request can interleave between check and
 * mark. Cross-isolate dedup is handled by the worker's UserDO which
 * serializes processing per-user. Expired entries are swept periodically
 * (at most once per SWEEP_INTERVAL_MS) so the map doesn't grow unbounded.
 */
const completedKeys = new Map<string, number>();
const DEDUP_TTL_MS = 3_600_000; // 1 hour
const SWEEP_INTERVAL_MS = 60_000; // sweep at most once per 60s
let lastSweepAt = 0;

function sweepExpiredKeys(): void {
  const now = Date.now();
  if (now - lastSweepAt < SWEEP_INTERVAL_MS) return;
  lastSweepAt = now;
  for (const [key, expiresAt] of completedKeys) {
    if (expiresAt < now) completedKeys.delete(key);
  }
}

function handleCompleteWithDedup(
  callback: EngineCallback,
  env: Env,
  ctx: ExecutionContext
): Response {
  sweepExpiredKeys();

  const key = callback.message_key;
  const existing = completedKeys.get(key);

  if (existing !== undefined && existing > Date.now()) {
    logger.info('Duplicate complete callback, skipping', { messageKey: key });
    return new Response('OK', { status: 200, headers: { 'X-Deduplicated': 'true' } });
  }

  // Atomic within the isolate: synchronous set before any await
  completedKeys.set(key, Date.now() + DEDUP_TTL_MS);

  ctx.waitUntil(
    handleEngineCallback(callback, env).catch((error) => {
      logger.error('Error processing complete callback', {
        error: error instanceof Error ? error.message : String(error),
      });
      completedKeys.delete(key);
    })
  );

  return new Response('OK', { status: 200 });
}

/**
 * Engine callback handler (POST).
 *
 * The engine POSTs here for all callback types: status, progress, complete, error.
 * Dispatches by type and applies deduplication for 'complete' callbacks.
 */
app.post('/progress-callback', async (c) => {
  const token = c.req.header('X-Engine-Token');

  if (token !== c.env.ENGINE_API_KEY) {
    logger.warn('Invalid engine callback token');
    return c.text('Unauthorized', 401);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    logger.error('Invalid JSON in engine callback');
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  const validationError = validateEngineCallback(body);
  if (validationError) {
    logger.error('Invalid engine callback payload', { error: validationError });
    return c.json({ error: validationError }, 400);
  }

  const callback = body as EngineCallback;

  if (callback.type === 'complete') {
    return handleCompleteWithDedup(callback, c.env, c.executionCtx);
  }

  c.executionCtx.waitUntil(
    handleEngineCallback(callback, c.env).catch((error) => {
      logger.error('Error processing engine callback', {
        error: error instanceof Error ? error.message : String(error),
      });
    })
  );

  return c.text('OK', 200);
});

export default app;
