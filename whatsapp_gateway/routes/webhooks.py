"""WhatsApp webhook handlers."""

from __future__ import annotations

import json
import logging
from collections.abc import Iterator
from typing import Annotated, Any

from fastapi import APIRouter, Header, HTTPException, Request, Response, status
from fastapi.responses import JSONResponse

from whatsapp_gateway.config import config
from whatsapp_gateway.core.models import IncomingMessage
from whatsapp_gateway.meta_api.signature import verify_facebook_signature
from whatsapp_gateway.services.message_handler import handle_incoming_message

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/meta-whatsapp")
async def verify_webhook(request: Request) -> Response:
    """
    Meta webhook verification endpoint.

    Meta sends a GET request with hub.mode, hub.verify_token, and hub.challenge
    to verify the webhook URL during setup.
    """
    params = dict(request.query_params)
    mode = params.get("hub.mode")
    token = params.get("hub.verify_token")
    challenge = params.get("hub.challenge")

    if mode == "subscribe" and token == config.META_VERIFY_TOKEN:
        logger.info("Webhook verified successfully with Meta.")
        return Response(content=challenge, media_type="text/plain", status_code=200)

    logger.warning("Webhook verification failed.")
    return Response(status_code=403)


@router.post("/meta-whatsapp")
async def handle_meta_webhook(
    request: Request,
    x_hub_signature_256: Annotated[str | None, Header(alias="X-Hub-Signature-256")] = None,
    x_hub_signature: Annotated[str | None, Header(alias="X-Hub-Signature")] = None,
    user_agent: Annotated[str | None, Header(alias="User-Agent")] = None,
) -> Response:
    """
    Process incoming Meta webhook events.

    Validates the signature and user agent, then processes each message.
    """
    try:
        body = await request.body()

        # Verify request signature
        _verify_request_signature(body, x_hub_signature_256, x_hub_signature)

        # Validate user agent
        _validate_user_agent(user_agent)

        # Parse and dispatch messages
        payload = await request.json()
        await _dispatch_meta_payload(payload)

        return Response(status_code=200)

    except json.JSONDecodeError:
        logger.error("Invalid JSON received", exc_info=True)
        return JSONResponse(
            status_code=status.HTTP_400_BAD_REQUEST,
            content={"error": "Invalid JSON"},
        )


def _verify_request_signature(
    body: bytes,
    sig256: str | None,
    sig1: str | None,
) -> None:
    """Verify the Facebook signature on the request."""
    if not verify_facebook_signature(config.META_APP_SECRET, body, sig256, sig1):
        logger.error("Invalid webhook signature")
        raise HTTPException(status_code=401, detail="Invalid signature")


def _validate_user_agent(user_agent: str | None) -> None:
    """Validate the User-Agent header matches expected Facebook UA."""
    if user_agent and user_agent.strip() == config.FACEBOOK_USER_AGENT:
        return
    logger.error(
        "Invalid user agent: %s, expected: %s",
        user_agent,
        config.FACEBOOK_USER_AGENT,
    )
    raise HTTPException(status_code=401, detail="Invalid User Agent")


async def _dispatch_meta_payload(payload: dict[str, Any]) -> None:
    """Process all messages in the webhook payload."""
    for message_data in _iter_meta_messages(payload):
        await _handle_message(message_data)


def _iter_meta_messages(payload: dict[str, Any]) -> Iterator[dict[str, Any]]:
    """Iterate over messages in a Meta webhook payload."""
    for entry in payload.get("entry", []):
        for change in entry.get("changes", []):
            value = change.get("value", {})
            contacts = value.get("contacts", [])
            for msg in value.get("messages", []):
                # Attach user_id from contacts
                if contacts:
                    msg["user_id"] = contacts[0].get("wa_id", "")
                yield msg


async def _handle_message(message_data: dict[str, Any]) -> None:
    """Handle a single incoming message."""
    try:
        message = IncomingMessage.from_webhook_data(
            {"message": message_data, "user_id": message_data.get("user_id", "")},
            message_age_cutoff=config.MESSAGE_AGE_CUTOFF_IN_SECONDS,
        )
    except (ValueError, KeyError) as e:
        logger.error("Error parsing message: %s", e, exc_info=True)
        return

    logger.info(
        "Received %s message (id=%s, age=%ds)",
        message.message_type.value,
        message.message_id,
        message.age(),
    )

    # Skip unsupported message types
    if not message.is_supported_type():
        logger.warning("Unsupported message type: %s", message.message_type)
        return

    # Skip old messages
    if message.too_old():
        logger.warning("Message too old (%ds), dropping", message.age())
        return

    # Check for sandbox mode
    if config.IN_META_SANDBOX_MODE and message.user_id != config.META_SANDBOX_PHONE_NUMBER:
        logger.warning("Sandbox mode: ignoring message from non-sandbox number")
        return

    # Process the message
    await handle_incoming_message(message)
