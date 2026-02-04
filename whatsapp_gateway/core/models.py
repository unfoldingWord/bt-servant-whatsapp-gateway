"""Core domain models for the WhatsApp gateway."""

from __future__ import annotations

import time
from dataclasses import dataclass
from enum import StrEnum
from typing import Any


class MessageType(StrEnum):
    """Supported WhatsApp message types."""

    TEXT = "text"
    AUDIO = "audio"
    IMAGE = "image"
    DOCUMENT = "document"
    STICKER = "sticker"
    LOCATION = "location"
    CONTACTS = "contacts"
    INTERACTIVE = "interactive"
    BUTTON = "button"
    UNKNOWN = "unknown"

    @classmethod
    def from_str(cls, value: str) -> MessageType:
        """Convert string to MessageType, defaulting to UNKNOWN."""
        try:
            return cls(value.lower())
        except ValueError:
            return cls.UNKNOWN


@dataclass
class IncomingMessage:
    """Represents an incoming WhatsApp message from a user."""

    user_id: str
    message_id: str
    message_type: MessageType
    timestamp: int
    text: str
    media_id: str | None
    message_age_cutoff: int

    @classmethod
    def from_webhook_data(
        cls,
        data: dict[str, Any],
        *,
        message_age_cutoff: int = 3600,
    ) -> IncomingMessage:
        """
        Parse an incoming message from Meta webhook payload.

        Args:
            data: The message data from the webhook payload
            message_age_cutoff: Maximum age in seconds for a message to be processed

        Returns:
            IncomingMessage instance
        """
        message = data.get("message", {})
        msg_type_str = message.get("type", "unknown")
        msg_type = MessageType.from_str(msg_type_str)

        # Extract text content based on message type
        text = ""
        media_id = None

        if msg_type == MessageType.TEXT:
            text = message.get("text", {}).get("body", "")
        elif msg_type == MessageType.INTERACTIVE:
            interactive = message.get("interactive", {})
            if "button_reply" in interactive:
                text = interactive["button_reply"].get("title", "")
            elif "list_reply" in interactive:
                text = interactive["list_reply"].get("title", "")
        elif msg_type == MessageType.BUTTON:
            text = message.get("button", {}).get("text", "")
        elif msg_type == MessageType.AUDIO:
            media_id = message.get("audio", {}).get("id")

        return cls(
            user_id=data.get("user_id", ""),
            message_id=message.get("id", ""),
            message_type=msg_type,
            timestamp=int(message.get("timestamp", 0)),
            text=text,
            media_id=media_id,
            message_age_cutoff=message_age_cutoff,
        )

    def is_supported_type(self) -> bool:
        """Check if the message type is supported for processing."""
        return self.message_type in {MessageType.TEXT, MessageType.AUDIO}

    def too_old(self) -> bool:
        """Check if the message is older than the cutoff threshold."""
        return self.age() > self.message_age_cutoff

    def age(self) -> int:
        """Return the age of the message in seconds."""
        return int(time.time()) - self.timestamp
