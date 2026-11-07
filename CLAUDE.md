# Claude Instructions - bt-servant-whatsapp-gateway

## CRITICAL: Branching Model (develop → main)

Two long-lived branches:

- **`develop`** is the integration branch and the default branch. Every feature branch and every PR targets `develop`. Staging deploys automatically after CI passes on a push to `develop`. Bot review plus CI is enough to merge there.
- **`main`** is the release branch. It only ever receives `develop` (a release PR, "Release vX.Y.Z: develop → main") or a `hotfix/*` branch. Only the repo owner can merge to `main` (branch protection restricts pushes and requires a code-owner review). Production deploys from `main` by tag.
- **Rule: `develop` is always releasable.** Work that is not ready to ship stays on its feature branch, or merges behind a flag that is off in production. Never cherry-pick into `main`; if something on `develop` must not ship, revert it on `develop` or flag it off, then release.
- **Hotfix:** branch from `main` as `hotfix/<name>`, PR into `main`, then open a PR from `main` into `develop` the same day so `develop` stays ahead of `main`.
- **Release:** merge the release PR, tag `v<version>` on the resulting `main` commit, dispatch the production deploy on that tag (`gh workflow run deploy.yml --ref v<version>`).
- **Merge methods:** feature PRs into `develop` are **squash**-merged. Release and hotfix PRs into `main` use a **merge commit**, never squash or rebase. A squash would copy `develop`'s work into a new commit that `develop` never contains, so the branches would diverge and every later release PR would re-list already-shipped commits. With merge commits, the next release PR shows only what is new, and `git log --first-parent main` lists one commit per release. Never delete `develop` when merging a release PR.

CI's `Release Source` job refuses a PR into `main` from any other branch. The production deploy (`deploy.yml`) refuses to run on anything but a `v*` tag that is on `main`. `tests/unit/workflows-branching.test.ts` pins these triggers and guards.

## CRITICAL: Ask Before Pushing

**ALWAYS ask the user before pushing changes.** Always create a feature branch and a PR against `develop`. Never push to `develop` or `main` directly; that bypasses review.

## CRITICAL: Never Deploy Directly

**NEVER run `wrangler deploy` directly.** All deployments go through CI/CD:

1. Commit changes on a feature branch and push it
2. Create a PR against `develop`, wait for CI to pass, get approval and merge
3. CI deploys `develop` to staging automatically
4. Production: the owner merges a release PR (`develop` → `main`), tags it, and dispatches the production deploy on the tag

The ONLY exception is if the user explicitly asks you to deploy directly for an emergency hotfix.

## CRITICAL: Never Merge Without Permission

**NEVER merge a PR without explicit user approval.**

## CRITICAL: Version Bumping

**Every PR MUST include a version bump** in `package.json` (the single source of truth):

- **Patch** (`pnpm version patch --no-git-tag-version`): bug fixes, documentation and CI changes, minor tweaks
- **Minor** (`pnpm version minor --no-git-tag-version`): new features, behavioral changes

Use `--no-git-tag-version` on branches so no tag is created before merge. Feature PRs into `develop` are not tagged; after a release PR (`develop` → `main`) is merged, tag the release on `main`:

```bash
git checkout main && git pull
git tag v<version>
git push --tags
```

The release tag covers every PR since the previous release. Tags are created on `main` after a release merge, never on `develop`.

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
