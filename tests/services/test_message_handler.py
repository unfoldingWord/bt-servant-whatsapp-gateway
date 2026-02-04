"""Tests for message handler."""
# pylint: disable=redefined-outer-name

from unittest.mock import AsyncMock, patch

import pytest

from whatsapp_gateway.core.models import IncomingMessage, MessageType
from whatsapp_gateway.services.message_handler import handle_incoming_message


class TestHandleIncomingMessage:
    """Tests for handle_incoming_message function."""

    @pytest.mark.asyncio
    async def test_voice_message_rejected(self) -> None:
        """Test that voice messages are rejected with helpful message."""
        message = IncomingMessage(
            user_id="1234567890",
            message_id="msg123",
            message_type=MessageType.AUDIO,
            timestamp=1234567890,
            text="",
            media_id="media123",
            message_age_cutoff=3600,
        )

        with (
            patch(
                "whatsapp_gateway.services.message_handler.meta_client.send_typing_indicator",
                new_callable=AsyncMock,
            ) as mock_typing,
            patch(
                "whatsapp_gateway.services.message_handler.meta_client.send_text_message",
                new_callable=AsyncMock,
            ) as mock_send,
        ):
            await handle_incoming_message(message)

            # Should send typing indicator
            mock_typing.assert_called_once_with("msg123")

            # Should send rejection message
            mock_send.assert_called_once_with(
                "1234567890",
                "Voice messages are temporarily unavailable. Please send a text message.",
            )

    @pytest.mark.asyncio
    async def test_text_message_processed(self) -> None:
        """Test that text messages are processed normally."""
        message = IncomingMessage(
            user_id="1234567890",
            message_id="msg123",
            message_type=MessageType.TEXT,
            timestamp=1234567890,
            text="Hello, world!",
            media_id=None,
            message_age_cutoff=3600,
        )

        mock_response = AsyncMock()
        mock_response.responses = ["Hello back!"]
        mock_response.voice_audio_base64 = None

        with (
            patch(
                "whatsapp_gateway.services.message_handler.meta_client.send_typing_indicator",
                new_callable=AsyncMock,
            ) as mock_typing,
            patch(
                "whatsapp_gateway.services.message_handler.engine_client.send_text_message",
                new_callable=AsyncMock,
                return_value=mock_response,
            ) as mock_engine,
            patch(
                "whatsapp_gateway.services.message_handler.meta_client.send_text_message",
                new_callable=AsyncMock,
            ) as mock_send,
        ):
            await handle_incoming_message(message)

            # Should send typing indicator
            mock_typing.assert_called_once_with("msg123")

            # Should call engine
            mock_engine.assert_called_once()

            # Should send response (not rejection message)
            mock_send.assert_called_once_with("1234567890", "Hello back!")

    @pytest.mark.asyncio
    async def test_engine_error_sends_error_message(self) -> None:
        """Test that engine errors result in error message to user."""
        message = IncomingMessage(
            user_id="1234567890",
            message_id="msg123",
            message_type=MessageType.TEXT,
            timestamp=1234567890,
            text="Hello",
            media_id=None,
            message_age_cutoff=3600,
        )

        with (
            patch(
                "whatsapp_gateway.services.message_handler.meta_client.send_typing_indicator",
                new_callable=AsyncMock,
            ),
            patch(
                "whatsapp_gateway.services.message_handler.engine_client.send_text_message",
                new_callable=AsyncMock,
                return_value=None,  # Engine error
            ),
            patch(
                "whatsapp_gateway.services.message_handler.meta_client.send_text_message",
                new_callable=AsyncMock,
            ) as mock_send,
        ):
            await handle_incoming_message(message)

            # Should send error message
            mock_send.assert_called_once()
            call_args = mock_send.call_args[0]
            assert call_args[0] == "1234567890"
            assert "error" in call_args[1].lower()
