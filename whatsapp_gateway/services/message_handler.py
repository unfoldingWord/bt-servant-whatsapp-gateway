"""Message handling service - orchestrates message processing."""

from __future__ import annotations

import logging

from whatsapp_gateway.config import config
from whatsapp_gateway.core.models import IncomingMessage, MessageType
from whatsapp_gateway.meta_api import client as meta_client
from whatsapp_gateway.services import engine_client
from whatsapp_gateway.services.chunking import chunk_message

logger = logging.getLogger(__name__)


def _get_progress_callback_url() -> str | None:
    """Get the progress callback URL if configured."""
    if not config.GATEWAY_PUBLIC_URL:
        return None
    return f"{config.GATEWAY_PUBLIC_URL.rstrip('/')}/progress-callback"


async def handle_incoming_message(message: IncomingMessage) -> None:
    """
    Handle an incoming WhatsApp message.

    1. Send typing indicator
    2. Reject voice messages (temporarily unsupported)
    3. Call engine API
    4. Send response(s) back to user

    Args:
        message: The parsed incoming message
    """
    # Send typing indicator
    await meta_client.send_typing_indicator(message.message_id)

    # Reject voice messages (worker doesn't support STT)
    if message.message_type == MessageType.AUDIO:
        await meta_client.send_text_message(
            message.user_id,
            "Voice messages are temporarily unavailable. Please send a text message.",
        )
        return

    # Get engine response for text messages
    response = await _handle_text_message(message)

    if response is None:
        logger.error("Failed to get response from engine")
        await meta_client.send_text_message(
            message.user_id,
            "Sorry, I encountered an error processing your message. Please try again.",
        )
        return

    # Send responses back to user
    await _send_responses(message.user_id, response)


async def _handle_text_message(message: IncomingMessage) -> engine_client.ChatResponse | None:
    """Handle a text message by sending to engine."""
    logger.info("Processing text message: %s", message.text[:50] if message.text else "(empty)")
    return await engine_client.send_text_message(
        user_id=message.user_id,
        message=message.text,
        progress_callback_url=_get_progress_callback_url(),
        progress_throttle_seconds=config.PROGRESS_THROTTLE_SECONDS,
    )


async def _handle_audio_message(message: IncomingMessage) -> engine_client.ChatResponse | None:
    """Handle an audio message by downloading and sending to engine."""
    if not message.media_id:
        logger.error("Audio message missing media_id")
        return None

    # Download audio from Meta
    logger.info("Downloading audio from Meta (media_id=%s)", message.media_id)
    audio_bytes = await meta_client.download_media(message.media_id)
    if audio_bytes is None:
        logger.error("Failed to download audio")
        return None

    logger.info("Downloaded %d bytes of audio", len(audio_bytes))

    # Send to engine for processing (engine will transcribe)
    return await engine_client.send_audio_message(
        user_id=message.user_id,
        audio_bytes=audio_bytes,
        audio_format="ogg",
        progress_callback_url=_get_progress_callback_url(),
        progress_throttle_seconds=config.PROGRESS_THROTTLE_SECONDS,
    )


async def _send_responses(user_id: str, response: engine_client.ChatResponse) -> None:
    """
    Send response(s) back to the user.

    Handles both text and voice responses, chunking as needed.

    Args:
        user_id: The user's WhatsApp ID
        response: The response from the engine
    """
    # Send voice response if available
    if response.voice_audio_base64:
        logger.info("Sending voice response")
        success = await meta_client.send_audio_message(user_id, response.voice_audio_base64)
        if not success:
            logger.warning("Failed to send voice response, falling back to text")
        else:
            # If voice was sent successfully, we're done (text is just transcript)
            return

    # Send text responses (may need chunking)
    for text in response.responses:
        chunks = chunk_message(text)
        for chunk in chunks:
            await meta_client.send_text_message(user_id, chunk)


async def send_progress_message(user_id: str, text: str) -> None:
    """
    Send a progress message to a user.

    Used by the progress callback endpoint to forward engine progress
    updates to WhatsApp users.

    Args:
        user_id: The user's WhatsApp ID
        text: The progress message text
    """
    await meta_client.send_text_message(user_id, text)
