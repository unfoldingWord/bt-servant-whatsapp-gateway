"""HTTP client for communicating with the BT Servant Engine API."""

from __future__ import annotations

import asyncio
import base64
import logging
from dataclasses import dataclass
from typing import Any, cast

import httpx

from whatsapp_gateway.config import config

logger = logging.getLogger(__name__)

# Client identifier for this gateway
CLIENT_ID = "whatsapp"

# HTTP timeout settings (seconds)
DEFAULT_TIMEOUT = 120.0  # 2 minutes for AI processing

# HTTP status codes
HTTP_NOT_FOUND = 404
HTTP_TOO_MANY_REQUESTS = 429

# Retry settings for 429 responses
MAX_RETRIES = 5
BASE_DELAY_SECONDS = 2.0
RETRY_MULTIPLIER = 1.5


@dataclass
class ChatResponse:
    """Response from the engine chat endpoint."""

    responses: list[str]
    response_language: str
    voice_audio_base64: str | None

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> ChatResponse:
        """Create ChatResponse from API response dict."""
        return cls(
            responses=cast(list[str], data.get("responses", [])),
            response_language=cast(str, data.get("response_language", "en")),
            voice_audio_base64=cast(str | None, data.get("voice_audio_base64")),
        )


@dataclass
class UserPreferences:
    """User preferences from the engine."""

    response_language: str | None = None

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> UserPreferences:
        """Create UserPreferences from API response dict."""
        return cls(
            response_language=cast(str | None, data.get("response_language")),
        )


def _get_auth_headers() -> dict[str, str]:
    """Return authorization headers for engine API."""
    return {
        "Authorization": f"Bearer {config.ENGINE_API_KEY}",
        "Content-Type": "application/json",
    }


async def _request_with_retry(
    client: httpx.AsyncClient,
    method: str,
    url: str,
    **kwargs: Any,
) -> httpx.Response:
    """
    Make HTTP request with retry on 429 (Too Many Requests).

    The worker returns 429 when a user's request is already being processed.
    This function retries with exponential backoff.

    Args:
        client: The HTTP client to use
        method: HTTP method (GET, POST, PUT, etc.)
        url: Request URL
        **kwargs: Additional arguments passed to client.request()

    Returns:
        The HTTP response (may be 429 if all retries exhausted)
    """
    response = await client.request(method, url, **kwargs)

    for attempt in range(MAX_RETRIES):
        if response.status_code != HTTP_TOO_MANY_REQUESTS:
            return response

        # Get retry delay from header or use exponential backoff
        retry_after = response.headers.get("Retry-After")
        if retry_after:
            delay = float(retry_after)
        else:
            delay = BASE_DELAY_SECONDS * (RETRY_MULTIPLIER**attempt)

        logger.info(
            "User request already processing (429), retrying in %.1fs (attempt %d/%d)",
            delay,
            attempt + 1,
            MAX_RETRIES,
        )
        await asyncio.sleep(delay)
        response = await client.request(method, url, **kwargs)

    # Return last response (may be 429 if all retries exhausted)
    return response


async def send_text_message(
    user_id: str,
    message: str,
    progress_callback_url: str | None = None,
    progress_throttle_seconds: float = 3.0,
) -> ChatResponse | None:
    """
    Send a text message to the engine for processing.

    Args:
        user_id: The user's identifier
        message: The text message content
        progress_callback_url: URL for engine to POST progress updates (optional)
        progress_throttle_seconds: Min seconds between progress messages

    Returns:
        ChatResponse if successful, None otherwise
    """
    url = f"{config.ENGINE_BASE_URL}/api/v1/chat"
    payload: dict[str, Any] = {
        "client_id": CLIENT_ID,
        "user_id": user_id,
        "message": message,
        "message_type": "text",
    }

    # Add progress callback if provided
    if progress_callback_url:
        payload["progress_callback_url"] = progress_callback_url
        payload["progress_throttle_seconds"] = progress_throttle_seconds

    async with httpx.AsyncClient(timeout=DEFAULT_TIMEOUT) as client:
        try:
            response = await _request_with_retry(
                client, "POST", url, headers=_get_auth_headers(), json=payload
            )
            response.raise_for_status()
            return ChatResponse.from_dict(response.json())
        except httpx.HTTPStatusError as e:
            logger.exception("Engine API error: %s - %s", e.response.status_code, e.response.text)
            return None
        except httpx.RequestError:
            logger.exception("Engine connection error")
            return None


async def send_audio_message(
    user_id: str,
    audio_bytes: bytes,
    audio_format: str = "ogg",
    progress_callback_url: str | None = None,
    progress_throttle_seconds: float = 3.0,
) -> ChatResponse | None:
    """
    Send an audio message to the engine for processing.

    The engine will transcribe the audio and process as text.

    Args:
        user_id: The user's identifier
        audio_bytes: Raw audio data
        audio_format: Audio format (default: ogg for WhatsApp)
        progress_callback_url: URL for engine to POST progress updates (optional)
        progress_throttle_seconds: Min seconds between progress messages

    Returns:
        ChatResponse if successful, None otherwise
    """
    url = f"{config.ENGINE_BASE_URL}/api/v1/chat"
    audio_base64 = base64.b64encode(audio_bytes).decode("ascii")
    payload: dict[str, Any] = {
        "client_id": CLIENT_ID,
        "user_id": user_id,
        "message": "",
        "message_type": "audio",
        "audio_base64": audio_base64,
        "audio_format": audio_format,
    }

    # Add progress callback if provided
    if progress_callback_url:
        payload["progress_callback_url"] = progress_callback_url
        payload["progress_throttle_seconds"] = progress_throttle_seconds

    async with httpx.AsyncClient(timeout=DEFAULT_TIMEOUT) as client:
        try:
            response = await _request_with_retry(
                client, "POST", url, headers=_get_auth_headers(), json=payload
            )
            response.raise_for_status()
            return ChatResponse.from_dict(response.json())
        except httpx.HTTPStatusError as e:
            logger.exception("Engine API error: %s - %s", e.response.status_code, e.response.text)
            return None
        except httpx.RequestError:
            logger.exception("Engine connection error")
            return None


async def get_user_preferences(user_id: str) -> UserPreferences | None:
    """
    Get user preferences from the engine.

    Args:
        user_id: The user's identifier

    Returns:
        UserPreferences if successful, None otherwise
    """
    url = f"{config.ENGINE_BASE_URL}/api/v1/orgs/{config.ENGINE_ORG}/users/{user_id}/preferences"

    async with httpx.AsyncClient(timeout=DEFAULT_TIMEOUT) as client:
        try:
            response = await client.get(url, headers=_get_auth_headers())
            response.raise_for_status()
            return UserPreferences.from_dict(response.json())
        except httpx.HTTPStatusError as e:
            if e.response.status_code == HTTP_NOT_FOUND:
                # User not found, return defaults
                return UserPreferences()
            logger.exception("Engine API error: %s - %s", e.response.status_code, e.response.text)
            return None
        except httpx.RequestError:
            logger.exception("Engine connection error")
            return None


async def update_user_preferences(
    user_id: str, preferences: UserPreferences
) -> UserPreferences | None:
    """
    Update user preferences in the engine.

    Args:
        user_id: The user's identifier
        preferences: The preferences to update

    Returns:
        Updated UserPreferences if successful, None otherwise
    """
    url = f"{config.ENGINE_BASE_URL}/api/v1/orgs/{config.ENGINE_ORG}/users/{user_id}/preferences"
    payload: dict[str, str] = {}
    if preferences.response_language is not None:
        payload["response_language"] = preferences.response_language

    async with httpx.AsyncClient(timeout=DEFAULT_TIMEOUT) as client:
        try:
            response = await client.put(url, headers=_get_auth_headers(), json=payload)
            response.raise_for_status()
            return UserPreferences.from_dict(response.json())
        except httpx.HTTPStatusError as e:
            logger.exception("Engine API error: %s - %s", e.response.status_code, e.response.text)
            return None
        except httpx.RequestError:
            logger.exception("Engine connection error")
            return None
