# bt-servant-whatsapp-gateway

A Cloudflare Worker gateway service that handles Meta/WhatsApp webhook integration for the [bt-servant-worker](https://github.com/unfoldingWord/bt-servant-worker).

## Overview

This gateway acts as a bridge between WhatsApp (via Meta's Cloud API) and the BT Servant Worker. It:

- Receives incoming WhatsApp messages via Meta webhooks
- Validates request signatures and authenticates requests
- Forwards messages to the worker's REST API for processing
- Sends responses back to users via WhatsApp
- Handles message chunking for WhatsApp's character limits

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

The gateway uses Cloudflare's `waitUntil()` pattern to return 200 immediately to Meta, then process the webhook in the background. This prevents Meta from timing out and retrying during long AI processing.

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

# Progress Callbacks (optional)
GATEWAY_PUBLIC_URL=https://your-gateway.example.com
```

Variables in `wrangler.toml`:

```toml
[vars]
ENGINE_BASE_URL = "https://api.btservant.ai"
ENGINE_ORG = "unfoldingWord"
CHUNK_SIZE = "1500"
MESSAGE_AGE_CUTOFF_SECONDS = "3600"
PROGRESS_THROTTLE_SECONDS = "3.0"
```

### Running

```bash
# Development
pnpm dev

# Deploy
pnpm deploy
```

### Setting Secrets

```bash
wrangler secret put META_VERIFY_TOKEN
wrangler secret put META_WHATSAPP_TOKEN
wrangler secret put META_PHONE_NUMBER_ID
wrangler secret put META_APP_SECRET
wrangler secret put ENGINE_API_KEY
wrangler secret put GATEWAY_PUBLIC_URL  # Optional
```

### Webhook Setup

Configure your Meta webhook to point to:

- **Verify endpoint**: `GET https://your-worker.workers.dev/meta-whatsapp`
- **Webhook endpoint**: `POST https://your-worker.workers.dev/meta-whatsapp`

## API Endpoints

| Endpoint             | Method | Description                          |
| -------------------- | ------ | ------------------------------------ |
| `/meta-whatsapp`     | GET    | Meta webhook verification            |
| `/meta-whatsapp`     | POST   | Receive WhatsApp messages            |
| `/progress-callback` | POST   | Receive progress updates from engine |
| `/health`            | GET    | Health check                         |
| `/`                  | GET    | Service info                         |

## Development

### Code Quality

```bash
# Linting
pnpm lint

# Format
pnpm format

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

### Pre-commit Hooks

Hooks are installed automatically via husky when you run `pnpm install`.

## Project Structure

```
bt-servant-whatsapp-gateway/
├── src/
│   ├── index.ts                 # Main Worker entry (Hono app)
│   ├── config/
│   │   └── types.ts             # Env interface
│   ├── types/
│   │   ├── meta.ts              # Meta webhook types
│   │   └── engine.ts            # Engine API types
│   ├── services/
│   │   ├── meta-api/
│   │   │   ├── client.ts        # Send messages to WhatsApp
│   │   │   └── signature.ts     # HMAC verification
│   │   ├── engine-client.ts     # Call bt-servant-worker API
│   │   ├── message-handler.ts   # Orchestration logic
│   │   └── chunking.ts          # Message chunking
│   └── utils/
│       ├── crypto.ts            # Constant-time compare
│       └── logger.ts            # Structured logging
├── tests/
│   ├── unit/
│   └── e2e/
├── package.json
├── wrangler.toml
├── tsconfig.json
├── vitest.config.ts
├── eslint.config.js
├── CLAUDE.md                    # AI coding guidelines
└── README.md
```

## How It Works

1. **Webhook Received**: Meta sends a POST request when a user sends a WhatsApp message
2. **Immediate Response**: Gateway returns 200 immediately (waitUntil pattern)
3. **Validation**: In background, verifies the signature and user agent
4. **Message Parsing**: Extracts message content (text only; voice temporarily disabled)
5. **Engine Request**: Sends message to engine's `/api/v1/chat` endpoint with callback URL
6. **Progress Updates**: Engine sends progress updates to `/progress-callback` during processing
7. **Response Processing**: Engine returns text response
8. **Chunking**: Long responses are split into WhatsApp-friendly chunks (≤1500 chars)
9. **Send Response**: Gateway sends response(s) back via WhatsApp API

## Related Projects

- [bt-servant-worker](https://github.com/unfoldingWord/bt-servant-worker) - The core AI worker for Bible translation assistance

## License

See [LICENSE](LICENSE) for details.
