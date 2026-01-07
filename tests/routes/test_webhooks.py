"""Tests for webhook routes."""
# pylint: disable=redefined-outer-name

import hashlib
import hmac

import pytest
from fastapi.testclient import TestClient

from whatsapp_gateway.config import config
from whatsapp_gateway.main import create_app


@pytest.fixture
def client() -> TestClient:
    """Create test client."""
    app = create_app()
    return TestClient(app)


class TestVerifyWebhook:
    """Tests for webhook verification endpoint."""

    def test_verify_success(self, client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
        """Successful verification returns challenge."""
        monkeypatch.setattr(config, "META_VERIFY_TOKEN", "my_verify_token")

        response = client.get(
            "/meta-whatsapp",
            params={
                "hub.mode": "subscribe",
                "hub.verify_token": "my_verify_token",
                "hub.challenge": "challenge_123",
            },
        )
        assert response.status_code == 200
        assert response.text == "challenge_123"

    def test_verify_wrong_token(self, client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
        """Wrong token returns 403."""
        monkeypatch.setattr(config, "META_VERIFY_TOKEN", "correct_token")

        response = client.get(
            "/meta-whatsapp",
            params={
                "hub.mode": "subscribe",
                "hub.verify_token": "wrong_token",
                "hub.challenge": "challenge_123",
            },
        )
        assert response.status_code == 403

    def test_verify_wrong_mode(self, client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
        """Wrong mode returns 403."""
        monkeypatch.setattr(config, "META_VERIFY_TOKEN", "my_token")

        response = client.get(
            "/meta-whatsapp",
            params={
                "hub.mode": "unsubscribe",
                "hub.verify_token": "my_token",
                "hub.challenge": "challenge_123",
            },
        )
        assert response.status_code == 403


class TestHandleWebhook:
    """Tests for webhook POST handler."""

    def test_invalid_signature(self, client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
        """Invalid signature returns 401."""
        monkeypatch.setattr(config, "META_APP_SECRET", "secret")
        monkeypatch.setattr(config, "FACEBOOK_USER_AGENT", "facebookexternalua")

        response = client.post(
            "/meta-whatsapp",
            json={"entry": []},
            headers={
                "X-Hub-Signature-256": "sha256=invalid",
                "User-Agent": "facebookexternalua",
            },
        )
        assert response.status_code == 401

    def test_invalid_user_agent(self, client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
        """Invalid user agent returns 401."""
        monkeypatch.setattr(config, "META_APP_SECRET", "secret")
        monkeypatch.setattr(config, "FACEBOOK_USER_AGENT", "facebookexternalua")

        payload = b'{"entry": []}'
        valid_sig = "sha256=" + hmac.new(
            b"secret", payload, hashlib.sha256
        ).hexdigest()

        response = client.post(
            "/meta-whatsapp",
            content=payload,
            headers={
                "X-Hub-Signature-256": valid_sig,
                "User-Agent": "wrong_agent",
                "Content-Type": "application/json",
            },
        )
        assert response.status_code == 401

    def test_valid_request_empty_payload(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Valid request with empty payload returns 200."""
        monkeypatch.setattr(config, "META_APP_SECRET", "secret")
        monkeypatch.setattr(config, "FACEBOOK_USER_AGENT", "facebookexternalua")

        payload = b'{"entry": []}'
        valid_sig = "sha256=" + hmac.new(
            b"secret", payload, hashlib.sha256
        ).hexdigest()

        response = client.post(
            "/meta-whatsapp",
            content=payload,
            headers={
                "X-Hub-Signature-256": valid_sig,
                "User-Agent": "facebookexternalua",
                "Content-Type": "application/json",
            },
        )
        assert response.status_code == 200


class TestHealthEndpoints:
    """Tests for health check endpoints."""

    def test_health_check(self, client: TestClient) -> None:
        """Health endpoint returns healthy status."""
        response = client.get("/health")
        assert response.status_code == 200
        assert response.json() == {"status": "healthy"}

    def test_root(self, client: TestClient) -> None:
        """Root endpoint returns service info."""
        response = client.get("/")
        assert response.status_code == 200
        data = response.json()
        assert data["service"] == "whatsapp-gateway"
        assert data["status"] == "running"
