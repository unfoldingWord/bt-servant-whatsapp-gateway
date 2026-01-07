# bt-servant-whatsapp-gateway

A FastAPI gateway service that handles Meta/WhatsApp webhook integration for the [bt-servant-engine](https://github.com/unfoldingWord/bt-servant-engine).

## Overview

This gateway acts as a bridge between WhatsApp (via Meta's Cloud API) and the BT Servant Engine. It:

- Receives incoming WhatsApp messages via Meta webhooks
- Validates request signatures and authenticates requests
- Forwards messages to the engine's REST API for processing
- Sends responses back to users via WhatsApp
- Handles message chunking for WhatsApp's character limits
- Supports both text and voice messages

**Key Design Principle**: This gateway has **zero OpenAI dependency**. All AI processing (transcription, language models, text-to-speech) happens in the engine.

## Architecture

```
┌─────────────────┐      ┌─────────────────────┐      ┌─────────────────┐
│                 │      │                     │      │                 │
│  Meta/WhatsApp  │─────▶│  WhatsApp Gateway   │─────▶│  BT Servant     │
│  Cloud API      │◀─────│  (this service)     │◀─────│  Engine         │
│                 │      │                     │      │                 │
└─────────────────┘      └─────────────────────┘      └─────────────────┘
```

The gateway follows a strict **onion/hexagonal architecture**:

```
routes/     → HTTP handlers (FastAPI routes)
services/   → Business logic (engine client, message handling, chunking)
meta_api/   → Meta/WhatsApp API client (send messages, verify signatures)
core/       → Domain models (no external dependencies)
```

## Quick Start

### Prerequisites

- Python 3.12+
- Access to Meta WhatsApp Business API
- Running instance of [bt-servant-engine](https://github.com/unfoldingWord/bt-servant-engine)

### Installation

```bash
# Clone the repository
git clone https://github.com/unfoldingWord/bt-servant-whatsapp-gateway.git
cd bt-servant-whatsapp-gateway

# Create virtual environment
python -m venv .venv
source .venv/bin/activate  # or .venv\Scripts\activate on Windows

# Install dependencies
pip install -r requirements.txt
pip install -e ".[dev]"  # Include dev dependencies

# Copy environment template
cp .env.example .env
```

### Configuration

Edit `.env` with your settings:

```bash
# Meta/WhatsApp API
META_VERIFY_TOKEN=your_webhook_verify_token
META_WHATSAPP_TOKEN=your_whatsapp_api_token
META_PHONE_NUMBER_ID=your_phone_number_id
META_APP_SECRET=your_app_secret

# Engine Connection
ENGINE_BASE_URL=http://localhost:8000
ENGINE_API_KEY=your_engine_api_key

# Optional
LOG_LEVEL=INFO
IN_META_SANDBOX_MODE=false
```

### Running

```bash
# Development
uvicorn whatsapp_gateway.main:app --reload

# Production
uvicorn whatsapp_gateway.main:app --host 0.0.0.0 --port 8000
```

### Webhook Setup

Configure your Meta webhook to point to:
- **Verify endpoint**: `GET https://your-domain/meta-whatsapp`
- **Webhook endpoint**: `POST https://your-domain/meta-whatsapp`

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/meta-whatsapp` | GET | Meta webhook verification |
| `/meta-whatsapp` | POST | Receive WhatsApp messages |
| `/health` | GET | Health check |
| `/` | GET | Service info |

## Development

### Code Quality

```bash
# Linting
ruff check .
ruff format .

# Type checking
mypy .
pyright

# Architecture compliance
lint-imports

# Run all checks
pre-commit run --all-files
```

### Testing

```bash
# Run tests
pytest

# With coverage
pytest --cov=whatsapp_gateway --cov-fail-under=65
```

### Pre-commit Hooks

```bash
# Install hooks
pre-commit install
pre-commit install --hook-type pre-push
```

## Project Structure

```
bt-servant-whatsapp-gateway/
├── whatsapp_gateway/
│   ├── __init__.py
│   ├── config.py              # Settings via pydantic-settings
│   ├── main.py                # FastAPI app factory
│   ├── core/
│   │   ├── __init__.py
│   │   └── models.py          # IncomingMessage, MessageType
│   ├── meta_api/
│   │   ├── __init__.py
│   │   ├── client.py          # WhatsApp API client
│   │   └── signature.py       # Webhook signature verification
│   ├── routes/
│   │   ├── __init__.py
│   │   ├── health.py          # Health endpoints
│   │   └── webhooks.py        # Meta webhook handlers
│   └── services/
│       ├── __init__.py
│       ├── chunking.py        # Message chunking (1500 char limit)
│       ├── engine_client.py   # HTTP client for engine API
│       └── message_handler.py # Message processing orchestration
├── tests/
├── .env.example
├── .importlinter              # Architecture rules
├── .pre-commit-config.yaml
├── pyproject.toml
├── requirements.txt
├── CLAUDE.md                  # AI coding guidelines
└── README.md
```

## How It Works

1. **Webhook Received**: Meta sends a POST request when a user sends a WhatsApp message
2. **Validation**: Gateway verifies the signature and user agent
3. **Message Parsing**: Extracts message content (text or audio media ID)
4. **Audio Handling**: If voice message, downloads audio from Meta
5. **Engine Request**: Sends message to engine's `/api/v1/chat` endpoint
6. **Response Processing**: Engine returns text (and optional voice audio)
7. **Chunking**: Long responses are split into WhatsApp-friendly chunks (≤1500 chars)
8. **Send Response**: Gateway sends response(s) back via WhatsApp API

## Related Projects

- [bt-servant-engine](https://github.com/unfoldingWord/bt-servant-engine) - The core AI engine for Bible translation assistance

## License

See [LICENSE](LICENSE) for details.
