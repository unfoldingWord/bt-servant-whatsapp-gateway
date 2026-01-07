# Claude Instructions - bt-servant-whatsapp-gateway

## System Context

**BT Servant** is an AI-powered Bible translation assistant developed by unfoldingWord. The system helps Bible translators by providing AI-assisted drafting, checking, and guidance in multiple languages.

The system consists of two main components:

1. **bt-servant-engine** (`../bt-servant-engine`) - The core AI engine that handles:
   - Language model interactions (OpenAI, Claude, etc.)
   - Audio transcription (speech-to-text)
   - Text-to-speech generation
   - User preferences and session management
   - Intent processing and agentic workflows
   - All the "brains" of the system

2. **bt-servant-whatsapp-gateway** (this repo) - A thin relay/bridge that:
   - Receives WhatsApp messages from Meta's Cloud API
   - Forwards them to the engine for processing
   - Sends responses back through WhatsApp

The gateway is intentionally "dumb" - it does NO AI processing itself. This separation allows:
- The engine to serve multiple channels (web, WhatsApp, future platforms)
- Each gateway to focus purely on protocol translation
- Clear security boundaries (gateway handles Meta auth, engine handles AI)

## Project Overview

WhatsApp Gateway is a service that handles Meta/WhatsApp webhook integration for the BT Servant Engine. It:
- Receives webhook events from Meta (WhatsApp messages)
- Validates signatures and user agents
- Forwards messages to the BT Servant Engine API
- Sends responses back to users via WhatsApp

**Important**: This gateway has ZERO OpenAI dependency. All AI processing (transcription, language models, TTS) happens in the engine.

## Architecture

Strict onion/hexagonal architecture enforced by import-linter:

```
routes/ → services/ → core/
    ↓         ↓         ↑
       meta_api/ --------↑
```

**Dependency Rules:**
- **routes**: Can import from services (NOT meta_api directly)
- **services**: Can import from core and meta_api
- **meta_api**: Can import from core
- **core**: Imports from nothing (innermost layer)

## Quick Start

```bash
# Create virtual environment
python -m venv .venv
source .venv/bin/activate  # or .venv\Scripts\activate on Windows

# Install dependencies
pip install -r requirements.txt
pip install -e ".[dev]"

# Copy and configure environment
cp .env.example .env
# Edit .env with your settings

# Run the server
uvicorn whatsapp_gateway.main:app --reload
```

## Coding Standards

### Style & Naming
- **Python 3.12+**, 4-space indentation, UTF-8 encoding
- `snake_case` for functions/variables
- `PascalCase` for classes
- `UPPER_SNAKE_CASE` for constants
- Keep functions small (≤50-60 lines)

### Linting & Type Checking
Run before committing:
```bash
ruff check .              # Linting
ruff format .             # Formatting
mypy .                    # Type checking
pyright                   # Strict type checking
lint-imports              # Architecture compliance
```

### Testing
```bash
pytest                                    # Run all tests
pytest --cov=whatsapp_gateway            # With coverage
pytest --cov=whatsapp_gateway --cov-fail-under=65  # Enforce 65% min
```

### Commit Conventions
- **Subject format**: `(Claude) <concise subject>` (keep under 72 chars)
- Always include a body describing changes
- **Author identity**: Set to "Claude Assistant" for AI commits

## Pre-commit Hooks

Setup:
```bash
pre-commit install
pre-commit install --hook-type pre-push
```

### CRITICAL: Pre-commit is Mandatory

**NEVER commit code unless ALL pre-commit checks pass.** This is non-negotiable.

Before ANY commit, you MUST run:
```bash
python -m pre_commit run --all-files
```

If any check fails:
1. Fix the issue
2. Re-run until all checks pass
3. Only then commit

**NEVER use `--no-verify` or any flag to bypass hooks.** If a check is failing, the code is not ready to commit. Period.

## Environment Variables

Required (see `.env.example`):
```
META_VERIFY_TOKEN         # Meta webhook verification token
META_WHATSAPP_TOKEN       # WhatsApp API token
META_PHONE_NUMBER_ID      # WhatsApp phone number ID
META_APP_SECRET           # Meta app secret for signature verification
ENGINE_BASE_URL           # URL to BT Servant Engine (e.g., http://localhost:8000)
ENGINE_API_KEY            # API key for engine (ADMIN_API_TOKEN)
```

## Key Files

- `whatsapp_gateway/main.py` - FastAPI app factory
- `whatsapp_gateway/config.py` - Configuration settings
- `whatsapp_gateway/routes/webhooks.py` - Meta webhook handlers
- `whatsapp_gateway/services/engine_client.py` - HTTP client for engine API
- `whatsapp_gateway/services/message_handler.py` - Message processing orchestration
- `whatsapp_gateway/meta_api/client.py` - WhatsApp message sending
- `whatsapp_gateway/meta_api/signature.py` - Signature verification
- `whatsapp_gateway/services/chunking.py` - Message chunking for WhatsApp limits
