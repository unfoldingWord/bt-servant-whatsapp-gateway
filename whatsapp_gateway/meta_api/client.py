"""Meta/WhatsApp API client for sending and receiving messages."""

from __future__ import annotations

import base64
import logging
import os
import tempfile
from collections.abc import Mapping, Sequence
from http import HTTPStatus
from typing import IO

import httpx

from whatsapp_gateway.config import config

logger = logging.getLogger(__name__)

# Graph API version
META_API_VERSION = "v23.0"

# HTTP error threshold
HTTP_ERROR_THRESHOLD = HTTPStatus.BAD_REQUEST

# Type alias for httpx files parameter
FileItem = tuple[
    str,
    tuple[str | None, IO[bytes] | bytes | str] | tuple[str | None, IO[bytes], str | None],
]
FilesParam = Sequence[FileItem]


def _get_base_url() -> str:
    """Return the Meta Graph API base URL."""
    return f"https://graph.facebook.com/{META_API_VERSION}"


def _get_auth_headers() -> dict[str, str]:
    """Return common authorization headers for Meta API."""
    return {
        "Authorization": f"Bearer {config.META_WHATSAPP_TOKEN}",
        "Content-Type": "application/json",
    }


async def send_text_message(user_id: str, text: str) -> bool:
    """
    Send a plain text WhatsApp message to a user.

    Args:
        user_id: The WhatsApp user ID (phone number)
        text: The message text to send

    Returns:
        True if message was sent successfully, False otherwise
    """
    url = f"{_get_base_url()}/{config.META_PHONE_NUMBER_ID}/messages"
    payload = {
        "messaging_product": "whatsapp",
        "to": user_id,
        "type": "text",
        "text": {"body": text},
    }

    async with httpx.AsyncClient() as client:
        response = await client.post(url, headers=_get_auth_headers(), json=payload)
        if response.status_code >= HTTP_ERROR_THRESHOLD:
            logger.error("Failed to send Meta message: %s", response.text)
            return False
        logger.info("Sent text message to user")
        return True


async def send_audio_message(user_id: str, audio_base64: str) -> bool:
    """
    Send an audio message to a WhatsApp user.

    The audio is expected as base64-encoded MP3 data.

    Args:
        user_id: The WhatsApp user ID (phone number)
        audio_base64: Base64-encoded audio data (MP3 format)

    Returns:
        True if message was sent successfully, False otherwise
    """
    # Decode base64 to bytes
    try:
        audio_bytes = base64.b64decode(audio_base64)
    except (ValueError, TypeError):
        logger.exception("Failed to decode audio base64")
        return False

    # Write to temp file
    temp_path = os.path.join(tempfile.gettempdir(), "gateway_audio.mp3")
    try:
        with open(temp_path, "wb") as f:
            f.write(audio_bytes)

        # Upload to Meta and get media ID
        media_id = await _upload_media(temp_path, "audio/mpeg")
        if not media_id:
            return False

        # Send the audio message
        url = f"{_get_base_url()}/{config.META_PHONE_NUMBER_ID}/messages"
        payload = {
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": user_id,
            "type": "audio",
            "audio": {"id": media_id},
        }

        async with httpx.AsyncClient() as client:
            response = await client.post(url, headers=_get_auth_headers(), json=payload)
            if response.status_code >= HTTP_ERROR_THRESHOLD:
                logger.error("Failed to send audio message: %s", response.text)
                return False
            logger.info("Sent audio message to user")
            return True
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)


async def send_typing_indicator(message_id: str) -> bool:
    """
    Send a typing indicator for a message.

    Args:
        message_id: The message ID to mark as read and show typing

    Returns:
        True if indicator was sent successfully, False otherwise
    """
    url = f"{_get_base_url()}/{config.META_PHONE_NUMBER_ID}/messages"
    payload = {
        "messaging_product": "whatsapp",
        "status": "read",
        "message_id": message_id,
        "typing_indicator": {"type": "text"},
    }

    async with httpx.AsyncClient() as client:
        response = await client.post(url, headers=_get_auth_headers(), json=payload)
        if response.status_code >= HTTP_ERROR_THRESHOLD:
            logger.error("Failed to send typing indicator: %s", response.text)
            return False
        logger.debug("Sent typing indicator for message %s", message_id)
        return True


async def download_media(media_id: str) -> bytes | None:
    """
    Download media content from Meta by media ID.

    Args:
        media_id: The Meta media ID

    Returns:
        The media content as bytes, or None if download failed
    """
    # First get the download URL
    url = f"{_get_base_url()}/{media_id}"
    headers = {"Authorization": f"Bearer {config.META_WHATSAPP_TOKEN}"}

    async with httpx.AsyncClient() as client:
        response = await client.get(url, headers=headers)
        if response.status_code >= HTTP_ERROR_THRESHOLD:
            logger.error("Failed to get media metadata: %s", response.text)
            return None

        media_url = response.json().get("url", "")
        if not media_url:
            logger.error("No URL in media metadata response")
            return None

        # Download the actual media
        media_response = await client.get(media_url, headers=headers)
        if media_response.status_code >= HTTP_ERROR_THRESHOLD:
            logger.error("Failed to download media: %s", media_response.text)
            return None

        return media_response.content


async def _upload_media(file_path: str, content_type: str) -> str | None:
    """
    Upload a media file to Meta.

    Args:
        file_path: Path to the file to upload
        content_type: MIME type of the file

    Returns:
        The media ID if successful, None otherwise
    """
    if not os.path.exists(file_path):
        logger.error("File not found: %s", file_path)
        return None

    url = f"{_get_base_url()}/{config.META_PHONE_NUMBER_ID}/media"
    headers = {"Authorization": f"Bearer {config.META_WHATSAPP_TOKEN}"}

    with open(file_path, "rb") as fh:
        files: FilesParam = [
            ("file", (os.path.basename(file_path), fh, content_type)),
            ("messaging_product", (None, "whatsapp")),
        ]
        response = httpx.post(url, headers=headers, files=files)

    if response.status_code >= HTTP_ERROR_THRESHOLD:
        logger.error("Failed to upload media: %s", response.text)
        return None

    media = response.json()
    media_id = media.get("id") if isinstance(media, Mapping) else None
    if not media_id:
        logger.error("Upload succeeded but response contained no media ID")
        return None

    logger.info("Uploaded media, ID: %s", media_id)
    return media_id
