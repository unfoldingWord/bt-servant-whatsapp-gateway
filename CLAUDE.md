# Claude Instructions - bt-servant-whatsapp-gateway

## System Context

**BT Servant** is an AI-powered Bible translation assistant developed by unfoldingWord. The system helps Bible translators by providing AI-assisted drafting, checking, and guidance in multiple languages.

The system consists of two main components:

1. **bt-servant-worker** (`../bt-servant-worker`) - The core AI worker that handles:
   - Language model interactions (Claude)
   - User preferences and session management
   - MCP tool orchestration
   - All the "brains" of the system

2. **bt-servant-whatsapp-gateway** (this repo) - A thin relay/bridge that:
   - Receives WhatsApp messages from Meta's Cloud API
   - Forwards them to the worker for processing
   - Sends responses back through WhatsApp

The gateway is intentionally "dumb" - it does NO AI processing itself. This separation allows:

- The worker to serve multiple channels (web, WhatsApp, future platforms)
- Each gateway to focus purely on protocol translation
- Clear security boundaries (gateway handles Meta auth, worker handles AI)

## Project Overview

WhatsApp Gateway is a Cloudflare Worker that handles Meta/WhatsApp webhook integration for the BT Servant Worker. It:

- Receives webhook events from Meta (WhatsApp messages)
- Validates signatures and user agents
- Forwards messages to the BT Servant Worker API
- Sends responses back to users via WhatsApp
- Uses `waitUntil()` pattern to return 200 immediately and process in background

**Important**: This gateway has ZERO AI dependency. All AI processing happens in the worker.

## Architecture

```
src/
├── index.ts              # Main Hono app with routes
├── config/
│   └── types.ts          # Env interface
├── types/
│   ├── meta.ts           # Meta webhook types
│   └── engine.ts         # Engine API types
├── services/
│   ├── meta-api/
│   │   ├── client.ts     # WhatsApp message sending
│   │   └── signature.ts  # HMAC verification
│   ├── engine-client.ts  # HTTP client for worker API
│   ├── message-handler.ts # Orchestration logic
│   └── chunking.ts       # Message chunking
└── utils/
    ├── crypto.ts         # Constant-time compare
    └── logger.ts         # Structured logging
```

**Dependency Rules (ESLint enforced):**

- **types/**: No internal dependencies
- **utils/**: No internal dependencies except types
- **services/**: Can import from types and utils
- **index.ts**: Can import from all

## Quick Start

```bash
# Install dependencies
pnpm install

# Create local secrets file
cp .dev.vars.example .dev.vars
# Edit .dev.vars with your settings

# Run development server
pnpm dev
```

## Coding Standards

### Style & Naming

- **TypeScript**, 2-space indentation, UTF-8 encoding
- `camelCase` for functions/variables
- `PascalCase` for types/interfaces
- `UPPER_SNAKE_CASE` for constants
- Keep functions small (≤50 lines, ESLint enforced)

### Linting & Type Checking

Run before committing:

```bash
pnpm lint                 # ESLint
pnpm format               # Prettier
pnpm check                # TypeScript type checking
```

### Testing

```bash
pnpm test                 # Run all tests
pnpm test:watch           # Watch mode
```

### Commit Conventions

- **Subject format**: `(Claude) <concise subject>` (keep under 72 chars)
- Always include a body describing changes
- **Author identity**: Set to "Claude Assistant" for AI commits

## Pre-commit Hooks

Hooks are installed automatically via husky when you run `pnpm install`.

### CRITICAL: Linting is Mandatory

**NEVER commit code unless ALL lint checks pass.** This is non-negotiable.

Before ANY commit, you MUST run:

```bash
pnpm lint && pnpm check && pnpm test
```

If any check fails:

1. Fix the issue
2. Re-run until all checks pass
3. Only then commit

**NEVER use `--no-verify` or any flag to bypass hooks.** If a check is failing, the code is not ready to commit. Period.

## Environment Variables

Secrets (set via `wrangler secret put`):

```
META_VERIFY_TOKEN         # Meta webhook verification token
META_WHATSAPP_TOKEN       # WhatsApp API token
META_PHONE_NUMBER_ID      # WhatsApp phone number ID
META_APP_SECRET           # Meta app secret for signature verification
ENGINE_API_KEY            # API key for worker
GATEWAY_PUBLIC_URL        # (optional) For progress callbacks
```

Variables (in wrangler.toml):

```
ENGINE_BASE_URL           # URL to BT Servant Worker
ENGINE_ORG                # Organization for user scoping
CHUNK_SIZE                # Message chunk size (default: 1500)
MESSAGE_AGE_CUTOFF_SECONDS # Max message age (default: 3600)
PROGRESS_THROTTLE_SECONDS # Progress callback throttle (default: 3.0)
```

## Key Files

- `src/index.ts` - Hono app with all routes
- `src/config/types.ts` - Env interface
- `src/services/meta-api/signature.ts` - HMAC signature verification
- `src/services/meta-api/client.ts` - WhatsApp message sending
- `src/services/engine-client.ts` - HTTP client for worker API (with 429 retry)
- `src/services/message-handler.ts` - Message processing orchestration
- `src/services/chunking.ts` - Message chunking for WhatsApp limits
