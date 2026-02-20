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
import type { CompletionCallback, ProgressCallback } from './types/engine';
import { verifyFacebookSignature } from './services/meta-api/signature';
import {
  handleWebhook,
  handleCompletionCallback,
  handleProgressCallback,
} from './services/message-handler';
import { logger } from './utils/logger';

const app = new Hono<{ Bindings: Env }>();

// Health check endpoints
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
app.post('/meta-whatsapp', async (c) => {
  const sig256 = c.req.header('X-Hub-Signature-256') ?? null;
  const sig1 = c.req.header('X-Hub-Signature') ?? null;
  const userAgent = c.req.header('User-Agent');
  const body = await c.req.text();

  // Verify request signature
  const isValid = await verifyFacebookSignature(body, sig256, sig1, c.env.META_APP_SECRET);
  if (!isValid) {
    logger.error('Invalid webhook signature');
    return c.text('Unauthorized', 401);
  }

  // Validate user agent
  if (userAgent?.trim() !== c.env.FACEBOOK_USER_AGENT) {
    logger.error('Invalid user agent', { userAgent, expected: c.env.FACEBOOK_USER_AGENT });
    return c.text('Unauthorized', 401);
  }

  // Parse payload
  let payload: WebhookPayload;
  try {
    payload = JSON.parse(body) as WebhookPayload;
  } catch {
    logger.error('Invalid JSON in webhook');
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  // Return 200 immediately, process in background
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
 * Completion callback from engine.
 *
 * The engine POSTs here when a user's queued message has been fully processed.
 * The response is forwarded to the user via WhatsApp.
 */
app.post('/completion-callback', async (c) => {
  const token = c.req.header('X-Engine-Token');

  // Verify the callback is from our engine using the shared API key
  if (token !== c.env.ENGINE_API_KEY) {
    logger.warn('Invalid engine callback token');
    return c.text('Unauthorized', 401);
  }

  let callback: CompletionCallback;
  try {
    callback = await c.req.json();
  } catch {
    logger.error('Invalid JSON in completion callback');
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  // Process in background
  c.executionCtx.waitUntil(
    handleCompletionCallback(callback, c.env).catch((error) => {
      logger.error('Error processing completion callback', {
        error: error instanceof Error ? error.message : String(error),
      });
    })
  );

  return c.text('OK', 200);
});

/**
 * Progress callback from engine.
 *
 * The engine POSTs here when a user's request is being processed and
 * a status update is available. The progress text is forwarded to the
 * user via WhatsApp.
 */
app.post('/progress-callback', async (c) => {
  const token = c.req.header('X-Engine-Token');

  // Verify the callback is from our engine using the shared API key
  if (token !== c.env.ENGINE_API_KEY) {
    logger.warn('Invalid engine callback token');
    return c.text('Unauthorized', 401);
  }

  let callback: ProgressCallback;
  try {
    callback = await c.req.json();
  } catch {
    logger.error('Invalid JSON in progress callback');
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  // Process in background
  c.executionCtx.waitUntil(
    handleProgressCallback(callback, c.env).catch((error) => {
      logger.error('Error processing progress callback', {
        error: error instanceof Error ? error.message : String(error),
      });
    })
  );

  return c.text('OK', 200);
});

export default app;
