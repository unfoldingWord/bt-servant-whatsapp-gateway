"""Tests for engine client."""
# pylint: disable=redefined-outer-name

from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from whatsapp_gateway.services import engine_client
from whatsapp_gateway.services.engine_client import (
    ChatResponse,
    UserPreferences,
    _request_with_retry,
)


class TestChatResponse:
    """Tests for ChatResponse dataclass."""

    def test_from_dict_full(self) -> None:
        """Test from_dict with all fields."""
        data = {
            "responses": ["Hello", "World"],
            "response_language": "en",
            "voice_audio_base64": "base64data",
        }
        response = ChatResponse.from_dict(data)
        assert response.responses == ["Hello", "World"]
        assert response.response_language == "en"
        assert response.voice_audio_base64 == "base64data"

    def test_from_dict_minimal(self) -> None:
        """Test from_dict with minimal fields."""
        data: dict[str, object] = {}
        response = ChatResponse.from_dict(data)
        assert not response.responses
        assert response.response_language == "en"
        assert response.voice_audio_base64 is None


class TestUserPreferences:
    """Tests for UserPreferences dataclass."""

    def test_from_dict_with_language(self) -> None:
        """Test from_dict with response_language."""
        data = {"response_language": "es"}
        prefs = UserPreferences.from_dict(data)
        assert prefs.response_language == "es"

    def test_from_dict_empty(self) -> None:
        """Test from_dict with empty dict."""
        prefs = UserPreferences.from_dict({})
        assert prefs.response_language is None

    def test_defaults(self) -> None:
        """Test default values."""
        prefs = UserPreferences()
        assert prefs.response_language is None


class TestRequestWithRetry:
    """Tests for _request_with_retry function."""

    @pytest.mark.asyncio
    async def test_success_no_retry(self) -> None:
        """Test successful request without retry."""
        mock_response = AsyncMock(spec=httpx.Response)
        mock_response.status_code = 200

        mock_client = AsyncMock(spec=httpx.AsyncClient)
        mock_client.request.return_value = mock_response

        response = await _request_with_retry(
            mock_client, "POST", "http://example.com/api"
        )

        assert response.status_code == 200
        assert mock_client.request.call_count == 1

    @pytest.mark.asyncio
    async def test_retry_on_429_then_success(self) -> None:
        """Test retry on 429 that eventually succeeds."""
        mock_429_response = AsyncMock(spec=httpx.Response)
        mock_429_response.status_code = 429
        mock_429_response.headers = {"Retry-After": "0.01"}

        mock_200_response = AsyncMock(spec=httpx.Response)
        mock_200_response.status_code = 200

        mock_client = AsyncMock(spec=httpx.AsyncClient)
        mock_client.request.side_effect = [mock_429_response, mock_200_response]

        with patch.object(engine_client, "BASE_DELAY_SECONDS", 0.01):
            response = await _request_with_retry(
                mock_client, "POST", "http://example.com/api"
            )

        assert response.status_code == 200
        assert mock_client.request.call_count == 2

    @pytest.mark.asyncio
    async def test_max_retries_exhausted(self) -> None:
        """Test that max retries returns last 429 response."""
        mock_429_response = AsyncMock(spec=httpx.Response)
        mock_429_response.status_code = 429
        mock_429_response.headers = {"Retry-After": "0.01"}

        mock_client = AsyncMock(spec=httpx.AsyncClient)
        mock_client.request.return_value = mock_429_response

        with (
            patch.object(engine_client, "MAX_RETRIES", 3),
            patch.object(engine_client, "BASE_DELAY_SECONDS", 0.01),
        ):
            response = await _request_with_retry(
                mock_client, "POST", "http://example.com/api"
            )

        assert response.status_code == 429
        # 1 initial request + 3 retry attempts = 4 total
        assert mock_client.request.call_count == 4

    @pytest.mark.asyncio
    async def test_exponential_backoff_without_retry_header(self) -> None:
        """Test exponential backoff when no Retry-After header."""
        mock_429_response = AsyncMock(spec=httpx.Response)
        mock_429_response.status_code = 429
        mock_429_response.headers = {}  # No Retry-After header

        mock_200_response = AsyncMock(spec=httpx.Response)
        mock_200_response.status_code = 200

        mock_client = AsyncMock(spec=httpx.AsyncClient)
        mock_client.request.side_effect = [mock_429_response, mock_200_response]

        with (
            patch.object(engine_client, "BASE_DELAY_SECONDS", 0.01),
            patch.object(engine_client, "RETRY_MULTIPLIER", 1.5),
        ):
            response = await _request_with_retry(
                mock_client, "POST", "http://example.com/api"
            )

        assert response.status_code == 200
        assert mock_client.request.call_count == 2


class TestSendTextMessage:
    """Tests for send_text_message function."""

    @pytest.mark.asyncio
    async def test_success(self) -> None:
        """Test successful text message send."""
        mock_response = MagicMock(spec=httpx.Response)
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "responses": ["Hello!"],
            "response_language": "en",
            "voice_audio_base64": None,
        }

        with patch(
            "whatsapp_gateway.services.engine_client._request_with_retry",
            new_callable=AsyncMock,
            return_value=mock_response,
        ):
            result = await engine_client.send_text_message("user123", "Hello")

        assert result is not None
        assert result.responses == ["Hello!"]
        assert result.response_language == "en"

    @pytest.mark.asyncio
    async def test_http_error(self) -> None:
        """Test HTTP error handling."""
        mock_response = MagicMock(spec=httpx.Response)
        mock_response.status_code = 500
        mock_response.text = "Internal Server Error"
        mock_response.raise_for_status.side_effect = httpx.HTTPStatusError(
            "Error", request=MagicMock(), response=mock_response
        )

        with patch(
            "whatsapp_gateway.services.engine_client._request_with_retry",
            new_callable=AsyncMock,
            return_value=mock_response,
        ):
            result = await engine_client.send_text_message("user123", "Hello")

        assert result is None
