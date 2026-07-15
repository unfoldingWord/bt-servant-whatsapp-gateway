# bt-servant-whatsapp-gateway

A Cloudflare Worker gateway service that handles Meta/WhatsApp webhook integration for the [bt-servant-worker](https://github.com/unfoldingWord/bt-servant-worker).

## Overview

This gateway acts as a bridge between WhatsApp (via Meta's Cloud API) and the BT Servant Worker. It:

- Receives incoming WhatsApp messages (text and voice) via Meta webhooks
- Validates request signatures (HMAC) and the Facebook user agent
- Forwards messages to the worker's async callback endpoint (`/api/v1/chat/callback`)
- Receives engine callbacks (`status`, `progress`, `complete`, `error`) on `/progress-callback`
- Delivers responses back to users via WhatsApp: text (chunked), voice audio, inline images/videos, and PDF documents
- Logs Meta delivery-status webhook events for observability

**Key Design Principle**: This gateway has **zero AI dependency**. All AI processing happens in the worker.

## Architecture

```
┌─────────────────┐      ┌─────────────────────┐      ┌─────────────────┐
│                 │      │                     │      │                 │
│  Meta/WhatsApp  │─────▶│  WhatsApp Gateway   │─────▶│  BT Servant     │
│  Cloud API      │◀─────│  (Cloudflare Worker)│◀─────│  Worker         │
│                 │      │                     │      │                 │
└─────────────────┘      └─────────────────────┘      └─────────────────┘
```

### waitUntil Pattern

The gateway uses Cloudflare's `waitUntil()` pattern to return 200 immediately to Meta, then process the webhook in the background. This prevents Meta from timing out and retrying during long AI processing. The same pattern is used for engine callbacks on `/progress-callback`.

### Callback Transport

The gateway uses the worker's **webhook (async) transport**:

1. It POSTs the user's message to `POST {ENGINE_BASE_URL}/api/v1/chat/callback` with `progress_callback_url` (this gateway's `/progress-callback` URL), a `message_key` (the WhatsApp message ID), `progress_mode: "iteration"`, and `progress_throttle_seconds`.
2. The worker replies `202 Accepted` with `{ message_id }` and processes asynchronously.
3. The worker POSTs callback events to `/progress-callback`, authenticated via the `X-Engine-Token` header (must match `ENGINE_API_KEY`).

`complete` callbacks are deduplicated in-memory by `message_key` (1-hour TTL) so engine retries don't double-send responses.

## Features

### Voice Messages (Inbound)

Incoming WhatsApp voice messages are downloaded from Meta's media API, size-checked (max 25 MB), base64-encoded, and forwarded to the engine as `message_type: "audio"` with `audio_base64` and `audio_format: "ogg"`. If the download fails or the audio is too large, the user gets an error message.

### Voice Responses (Outbound)

When a `complete` callback carries voice audio, the gateway prefers `voice_audio_url` (fetched over HTTPS from the worker with a Bearer token, capped at 25 MB) and falls back to `voice_audio_base64`. The audio is uploaded to Meta's media API (OGG/Opus) and sent as a WhatsApp audio message. If audio delivery succeeds, the text response is skipped.

### Inline Media Rendering

Markdown-wrapped image/video links in the response text (`![alt](url)`, `[label](url)`, and Aquifer-style linked thumbnails `[![alt](thumb)](url)` with recognized media extensions: jpg/jpeg/png/webp/gif, mp4/mov/3gp) are extracted and rendered as native WhatsApp image/video messages. The prose is always sent first with URLs preserved inline, so a silently dropped attachment still leaves the user a clickable link; a failed media send additionally falls back to re-sending the URL as text.

### PDF Attachments

`complete` callbacks may include an `attachments` array. Attachments with `type: "pdf"` are sent as WhatsApp document messages (Meta fetches the public HTTPS link directly; the filename shows in the document tile). Failed document sends fall back to sending the URL as text.

### Meta Send Hardening

Meta sometimes returns HTTP 200 with an embedded error body. Media sends parse the response body and classify embedded error codes as permanent, transient, or unclassified (fail-closed) so failures trigger the text-URL fallback instead of being silently dropped.

### Other Behaviors

- **Typing indicator**: inbound messages are marked read with a typing indicator before processing
- **Message age cutoff**: messages older than `MESSAGE_AGE_CUTOFF_SECONDS` are dropped (protects against Meta retry storms)
- **Supported inbound types**: `text` and `audio`; all other types (image, document, sticker, location, interactive, ...) are logged and skipped
- **Delivery-status logging**: Meta `statuses` webhook entries (sent/delivered/read/failed) are logged at info level
- **Misconfiguration guard**: if `GATEWAY_PUBLIC_URL` is unset, inbound messages get a 503 and the sender is notified once per 5 minutes

## Quick Start

### Prerequisites

- Node.js 20+
- pnpm 9+
- Access to Meta WhatsApp Business API
- Running instance of [bt-servant-worker](https://github.com/unfoldingWord/bt-servant-worker)

### Installation

```bash
# Clone the repository
git clone https://github.com/unfoldingWord/bt-servant-whatsapp-gateway.git
cd bt-servant-whatsapp-gateway

# Install dependencies
pnpm install

# Copy environment template
cp .dev.vars.example .dev.vars
```

### Configuration

Create `.dev.vars` with your secrets (for local development):

```bash
# Meta/WhatsApp API
META_VERIFY_TOKEN=your_webhook_verify_token
META_WHATSAPP_TOKEN=your_whatsapp_api_token
META_PHONE_NUMBER_ID=your_phone_number_id
META_APP_SECRET=your_app_secret

# Engine Connection
ENGINE_API_KEY=your_engine_api_key

# Public URL of this gateway — required for the engine to deliver responses
GATEWAY_PUBLIC_URL=https://your-gateway.example.com
```

Variables in `wrangler.toml`:

```toml
[vars]
ENVIRONMENT = "production"
ENGINE_BASE_URL = "https://api.btservant.ai"
ENGINE_ORG = "unfoldingWord"
CHUNK_SIZE = "1500"
MESSAGE_AGE_CUTOFF_SECONDS = "3600"
PROGRESS_THROTTLE_SECONDS = "3.0"
FACEBOOK_USER_AGENT = "facebookexternalua"
```

A staging environment (`bt-servant-whatsapp-gateway-staging`, pointed at `https://staging-api.btservant.ai`) is configured under `[env.staging]`.

### Running

```bash
# Development
pnpm dev
```

### Setting Secrets

```bash
wrangler secret put META_VERIFY_TOKEN
wrangler secret put META_WHATSAPP_TOKEN
wrangler secret put META_PHONE_NUMBER_ID
wrangler secret put META_APP_SECRET
wrangler secret put ENGINE_API_KEY
wrangler secret put GATEWAY_PUBLIC_URL
```

For staging, add `--env staging` to each command.

> **Note**: `GATEWAY_PUBLIC_URL` is required for normal operation. Without it, the gateway cannot receive engine callbacks and will reject inbound messages with a 503.

### Webhook Setup

Configure your Meta webhook to point to:

- **Verify endpoint**: `GET https://your-worker.workers.dev/meta-whatsapp`
- **Webhook endpoint**: `POST https://your-worker.workers.dev/meta-whatsapp`

## API Endpoints

| Endpoint             | Method | Description                                                                                                     |
| -------------------- | ------ | --------------------------------------------------------------------------------------------------------------- |
| `/meta-whatsapp`     | GET    | Meta webhook verification                                                                                       |
| `/meta-whatsapp`     | POST   | Receive WhatsApp messages and delivery statuses                                                                 |
| `/progress-callback` | POST   | Receive engine callbacks (`status`, `progress`, `complete`, `error`); authenticated via `X-Engine-Token` header |
| `/health`            | GET    | Health check                                                                                                    |
| `/`                  | GET    | Service info                                                                                                    |

## Development

### Code Quality

```bash
# Linting
pnpm lint          # or pnpm lint:fix

# Format
pnpm format        # or pnpm format:check

# Type checking
pnpm check

# Run all checks
pnpm lint && pnpm check && pnpm test
```

### Testing

```bash
# Run tests
pnpm test

# Watch mode
pnpm test:watch
```

Tests run in the Workers runtime via `@cloudflare/vitest-pool-workers`.

### CI/CD

- **CI** (`.github/workflows/ci.yml`): format check, lint, typecheck, and tests on every push/PR to `main`
- **Staging deploy** (`.github/workflows/deploy-staging.yml`): automatic after CI passes on `main`
- **Production deploy** (`.github/workflows/deploy.yml`): manual `workflow_dispatch`

## Project Structure

```
bt-servant-whatsapp-gateway/
├── src/
│   ├── index.ts                    # Main Worker entry (Hono app + routes)
│   ├── config/
│   │   └── types.ts                # Env interface
│   ├── types/
│   │   ├── meta.ts                 # Meta webhook types
│   │   └── engine.ts               # Engine API + callback types
│   ├── services/
│   │   ├── meta-api/
│   │   │   ├── client.ts           # Send text/audio/image/video/document to WhatsApp
│   │   │   ├── signature.ts        # HMAC signature verification
│   │   │   ├── status-webhook.ts   # Delivery-status logging
│   │   │   └── error-codes.ts      # Meta error-code classification
│   │   ├── engine-client.ts        # Call bt-servant-worker /api/v1/chat/callback
│   │   ├── message-handler.ts      # Orchestration + callback handling
│   │   ├── media-extractor.ts      # Extract inline media from response text
│   │   └── chunking.ts             # Message chunking
│   └── utils/
│       ├── crypto.ts               # Constant-time compare
│       ├── logger.ts               # Structured logging
│       └── url.ts                  # URL redaction for safe logging
├── tests/
│   ├── unit/
│   └── e2e/
├── .github/workflows/              # CI, staging deploy, production deploy
├── package.json
├── wrangler.toml
├── tsconfig.json
├── vitest.config.ts
├── eslint.config.js
├── CLAUDE.md                       # AI coding guidelines
└── README.md
```

## How It Works

1. **Webhook Received**: Meta sends a POST request when a user sends a WhatsApp message
2. **Validation**: Gateway verifies the HMAC signature (`X-Hub-Signature-256`/`X-Hub-Signature`) and user agent, then returns 200 immediately (waitUntil pattern)
3. **Message Parsing**: Extracts message content; voice messages are downloaded from Meta and base64-encoded
4. **Typing Indicator**: Marks the message read and shows a typing indicator
5. **Engine Request**: POSTs to the worker's `/api/v1/chat/callback` with `progress_callback_url`, `message_key`, and (for voice) `audio_base64`/`audio_format`; worker replies `202 Accepted`
6. **Callbacks**: Worker POSTs `status`/`progress`/`complete`/`error` events to `/progress-callback` (authenticated via `X-Engine-Token`); `progress` text is relayed to the user as it arrives
7. **Complete Delivery**: On `complete`, the gateway sends voice audio if present, otherwise text (with inline images/videos rendered natively), plus any PDF attachments as document messages
8. **Chunking**: Long text responses are split at sentence boundaries into WhatsApp-friendly chunks (≤`CHUNK_SIZE`, default 1500 chars)

## Related Projects

- [bt-servant-worker](https://github.com/unfoldingWord/bt-servant-worker) - The core AI worker for Bible translation assistance

## License

Private
