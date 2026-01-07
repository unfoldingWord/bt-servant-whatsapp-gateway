"""HTTP client for communicating with the BT Servant Engine API."""

from __future__ import annotations

import base64
import logging
from dataclasses import dataclass
from typing import Literal

import httpx

from whatsapp_gateway.config import config

logger = logging.getLogger(__name__)

# Client identifier for this gateway
CLIENT_ID = "whatsapp"

# HTTP timeout settings (seconds)
DEFAULT_TIMEOUT = 120.0  # 2 minutes for AI processing

# HTTP status codes
HTTP_NOT_FOUND = 404


@dataclass
class ChatResponse:
    """Response from the engine chat endpoint."""

    responses: list[str]
    response_language: str
    voice_audio_base64: str | None
    intent_processed: str
    has_queued_intents: bool

    @classmethod
    def from_dict(cls, data: dict) -> ChatResponse:
        """Create ChatResponse from API response dict."""
        return cls(
            responses=data.get("responses", []),
            response_language=data.get("response_language", "en"),
            voice_audio_base64=data.get("voice_audio_base64"),
            intent_processed=data.get("intent_processed", ""),
            has_queued_intents=data.get("has_queued_intents", False),
        )


@dataclass
class UserPreferences:
    """User preferences from the engine."""

    response_language: str | None = None
    agentic_strength: Literal["normal", "low", "very_low"] | None = None
    dev_agentic_mcp: bool | None = None

    @classmethod
    def from_dict(cls, data: dict) -> UserPreferences:
        """Create UserPreferences from API response dict."""
        return cls(
            response_language=data.get("response_language"),
            agentic_strength=data.get("agentic_strength"),
            dev_agentic_mcp=data.get("dev_agentic_mcp"),
        )


def _get_auth_headers() -> dict[str, str]:
    """Return authorization headers for engine API."""
    return {
        "Authorization": f"Bearer {config.ENGINE_API_KEY}",
        "Content-Type": "application/json",
    }


async def send_text_message(user_id: str, message: str) -> ChatResponse | None:
    """
    Send a text message to the engine for processing.

    Args:
        user_id: The user's identifier
        message: The text message content

    Returns:
        ChatResponse if successful, None otherwise
    """
    url = f"{config.ENGINE_BASE_URL}/api/v1/chat"
    payload = {
        "client_id": CLIENT_ID,
        "user_id": user_id,
        "message": message,
        "message_type": "text",
    }

    async with httpx.AsyncClient(timeout=DEFAULT_TIMEOUT) as client:
        try:
            response = await client.post(url, headers=_get_auth_headers(), json=payload)
            response.raise_for_status()
            return ChatResponse.from_dict(response.json())
        except httpx.HTTPStatusError as e:
            logger.exception("Engine API error: %s - %s", e.response.status_code, e.response.text)
            return None
        except httpx.RequestError:
            logger.exception("Engine connection error")
            return None


async def send_audio_message(
    user_id: str, audio_bytes: bytes, audio_format: str = "ogg"
) -> ChatResponse | None:
    """
    Send an audio message to the engine for processing.

    The engine will transcribe the audio and process as text.

    Args:
        user_id: The user's identifier
        audio_bytes: Raw audio data
        audio_format: Audio format (default: ogg for WhatsApp)

    Returns:
        ChatResponse if successful, None otherwise
    """
    url = f"{config.ENGINE_BASE_URL}/api/v1/chat"
    audio_base64 = base64.b64encode(audio_bytes).decode("ascii")
    payload = {
        "client_id": CLIENT_ID,
        "user_id": user_id,
        "message": "",
        "message_type": "audio",
        "audio_base64": audio_base64,
        "audio_format": audio_format,
    }

    async with httpx.AsyncClient(timeout=DEFAULT_TIMEOUT) as client:
        try:
            response = await client.post(url, headers=_get_auth_headers(), json=payload)
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
    url = f"{config.ENGINE_BASE_URL}/api/v1/users/{user_id}/preferences"

    async with httpx.AsyncClient(timeout=DEFAULT_TIMEOUT) as client:
        try:
            response = await client.get(url, headers=_get_auth_headers())
            response.raise_for_status()
            return UserPreferences.from_dict(response.json())
        except httpx.HTTPStatusError as e:
            if e.response.status_code == HTTP_NOT_FOUND:
                # User not found, return defaults
                return UserPreferences()
            logger.exception(
                "Engine API error: %s - %s", e.response.status_code, e.response.text
            )
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
    url = f"{config.ENGINE_BASE_URL}/api/v1/users/{user_id}/preferences"
    payload = {}
    if preferences.response_language is not None:
        payload["response_language"] = preferences.response_language
    if preferences.agentic_strength is not None:
        payload["agentic_strength"] = preferences.agentic_strength
    if preferences.dev_agentic_mcp is not None:
        payload["dev_agentic_mcp"] = preferences.dev_agentic_mcp

    async with httpx.AsyncClient(timeout=DEFAULT_TIMEOUT) as client:
        try:
            response = await client.put(url, headers=_get_auth_headers(), json=payload)
            response.raise_for_status()
            return UserPreferences.from_dict(response.json())
        except httpx.HTTPStatusError as e:
            logger.exception(
                "Engine API error: %s - %s", e.response.status_code, e.response.text
            )
            return None
        except httpx.RequestError:
            logger.exception("Engine connection error")
            return None
