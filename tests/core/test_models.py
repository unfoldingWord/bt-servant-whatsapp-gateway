"""Tests for core models."""

import time

from whatsapp_gateway.core.models import IncomingMessage, MessageType


class TestMessageType:
    """Tests for MessageType enum."""

    def test_from_str_text(self) -> None:
        """Text type should parse correctly."""
        assert MessageType.from_str("text") == MessageType.TEXT

    def test_from_str_audio(self) -> None:
        """Audio type should parse correctly."""
        assert MessageType.from_str("audio") == MessageType.AUDIO

    def test_from_str_unknown(self) -> None:
        """Unknown type should return UNKNOWN."""
        assert MessageType.from_str("video") == MessageType.UNKNOWN
        assert MessageType.from_str("invalid") == MessageType.UNKNOWN

    def test_from_str_case_insensitive(self) -> None:
        """Type parsing should be case insensitive."""
        assert MessageType.from_str("TEXT") == MessageType.TEXT
        assert MessageType.from_str("Audio") == MessageType.AUDIO


class TestIncomingMessage:
    """Tests for IncomingMessage model."""

    def test_from_webhook_data_text(self) -> None:
        """Text message should parse correctly."""
        current_time = int(time.time())
        data = {
            "user_id": "1234567890",
            "message": {
                "id": "msg_123",
                "type": "text",
                "timestamp": str(current_time),
                "text": {"body": "Hello, world!"},
            },
        }
        msg = IncomingMessage.from_webhook_data(data)
        assert msg.user_id == "1234567890"
        assert msg.message_id == "msg_123"
        assert msg.message_type == MessageType.TEXT
        assert msg.text == "Hello, world!"
        assert msg.media_id is None

    def test_from_webhook_data_audio(self) -> None:
        """Audio message should parse correctly."""
        current_time = int(time.time())
        data = {
            "user_id": "1234567890",
            "message": {
                "id": "msg_456",
                "type": "audio",
                "timestamp": str(current_time),
                "audio": {"id": "media_789"},
            },
        }
        msg = IncomingMessage.from_webhook_data(data)
        assert msg.message_type == MessageType.AUDIO
        assert msg.media_id == "media_789"
        assert msg.text == ""

    def test_is_supported_type(self) -> None:
        """Supported types should return True."""
        current_time = int(time.time())
        text_data = {
            "user_id": "123",
            "message": {"id": "1", "type": "text", "timestamp": str(current_time), "text": {"body": "hi"}},
        }
        audio_data = {
            "user_id": "123",
            "message": {"id": "2", "type": "audio", "timestamp": str(current_time), "audio": {"id": "m1"}},
        }
        image_data = {
            "user_id": "123",
            "message": {"id": "3", "type": "image", "timestamp": str(current_time)},
        }

        assert IncomingMessage.from_webhook_data(text_data).is_supported_type() is True
        assert IncomingMessage.from_webhook_data(audio_data).is_supported_type() is True
        assert IncomingMessage.from_webhook_data(image_data).is_supported_type() is False

    def test_too_old(self) -> None:
        """Old messages should be detected."""
        old_time = int(time.time()) - 7200  # 2 hours ago
        recent_time = int(time.time()) - 60  # 1 minute ago

        old_data = {
            "user_id": "123",
            "message": {"id": "1", "type": "text", "timestamp": str(old_time), "text": {"body": "hi"}},
        }
        recent_data = {
            "user_id": "123",
            "message": {"id": "2", "type": "text", "timestamp": str(recent_time), "text": {"body": "hi"}},
        }

        assert IncomingMessage.from_webhook_data(old_data, message_age_cutoff=3600).too_old() is True
        assert IncomingMessage.from_webhook_data(recent_data, message_age_cutoff=3600).too_old() is False

    def test_interactive_button_reply(self) -> None:
        """Interactive button reply should parse correctly."""
        current_time = int(time.time())
        data = {
            "user_id": "123",
            "message": {
                "id": "1",
                "type": "interactive",
                "timestamp": str(current_time),
                "interactive": {"button_reply": {"title": "Yes, continue"}},
            },
        }
        msg = IncomingMessage.from_webhook_data(data)
        assert msg.message_type == MessageType.INTERACTIVE
        assert msg.text == "Yes, continue"
