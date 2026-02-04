"""Pytest configuration and fixtures."""

import os

import pytest


def pytest_configure() -> None:
    """Set environment variables before test collection."""
    os.environ.setdefault("META_VERIFY_TOKEN", "test_verify_token")
    os.environ.setdefault("META_WHATSAPP_TOKEN", "test_whatsapp_token")
    os.environ.setdefault("META_PHONE_NUMBER_ID", "123456789")
    os.environ.setdefault("META_APP_SECRET", "test_app_secret")
    os.environ.setdefault("FACEBOOK_USER_AGENT", "facebookexternalua")
    os.environ.setdefault("ENGINE_BASE_URL", "http://localhost:8000")
    os.environ.setdefault("ENGINE_API_KEY", "test_api_key")
    os.environ.setdefault("ENGINE_ORG", "test_org")
    os.environ.setdefault("LOG_PSEUDONYM_SECRET", "test_secret")


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
    monkeypatch.setenv("ENGINE_ORG", "test_org")
    monkeypatch.setenv("LOG_PSEUDONYM_SECRET", "test_secret")
