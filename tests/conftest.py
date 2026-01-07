"""Pytest configuration and fixtures."""

import pytest


@pytest.fixture(autouse=True)
def set_test_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    """Set required environment variables for tests."""
    monkeypatch.setenv("META_VERIFY_TOKEN", "test_verify_token")
    monkeypatch.setenv("META_WHATSAPP_TOKEN", "test_whatsapp_token")
    monkeypatch.setenv("META_PHONE_NUMBER_ID", "123456789")
    monkeypatch.setenv("META_APP_SECRET", "test_app_secret")
    monkeypatch.setenv("FACEBOOK_USER_AGENT", "facebookexternalua")
    monkeypatch.setenv("ENGINE_BASE_URL", "http://localhost:8000")
    monkeypatch.setenv("ENGINE_API_KEY", "test_api_key")
    monkeypatch.setenv("LOG_PSEUDONYM_SECRET", "test_secret")
