"""Tests for Facebook signature verification."""

import hashlib
import hmac

from whatsapp_gateway.meta_api.signature import verify_facebook_signature


class TestVerifyFacebookSignature:
    """Tests for the verify_facebook_signature function."""

    def test_valid_sha256_signature(self) -> None:
        """Valid SHA-256 signature should return True."""
        secret = "test_secret"
        payload = b'{"test": "data"}'
        expected_sig = "sha256=" + hmac.new(
            secret.encode("utf-8"), payload, hashlib.sha256
        ).hexdigest()

        assert verify_facebook_signature(secret, payload, expected_sig, None) is True

    def test_invalid_sha256_signature(self) -> None:
        """Invalid SHA-256 signature should return False."""
        secret = "test_secret"
        payload = b'{"test": "data"}'

        assert verify_facebook_signature(secret, payload, "sha256=invalid", None) is False

    def test_valid_sha1_signature_fallback(self) -> None:
        """Valid SHA-1 signature (fallback) should return True when no SHA-256."""
        secret = "test_secret"
        payload = b'{"test": "data"}'
        expected_sig = "sha1=" + hmac.new(
            secret.encode("utf-8"), payload, hashlib.sha1
        ).hexdigest()

        assert verify_facebook_signature(secret, payload, None, expected_sig) is True

    def test_invalid_sha1_signature(self) -> None:
        """Invalid SHA-1 signature should return False."""
        secret = "test_secret"
        payload = b'{"test": "data"}'

        assert verify_facebook_signature(secret, payload, None, "sha1=invalid") is False

    def test_no_signature_provided(self) -> None:
        """No signature should return False."""
        assert verify_facebook_signature("secret", b"data", None, None) is False

    def test_sha256_preferred_over_sha1(self) -> None:
        """SHA-256 should be preferred even if both are provided."""
        secret = "test_secret"
        payload = b'{"test": "data"}'
        valid_sha256 = "sha256=" + hmac.new(
            secret.encode("utf-8"), payload, hashlib.sha256
        ).hexdigest()
        invalid_sha1 = "sha1=invalid"

        # Should pass because SHA-256 is valid (SHA-1 is ignored)
        assert verify_facebook_signature(secret, payload, valid_sha256, invalid_sha1) is True

    def test_signature_with_whitespace(self) -> None:
        """Signature with leading/trailing whitespace should work."""
        secret = "test_secret"
        payload = b'{"test": "data"}'
        expected_sig = "  sha256=" + hmac.new(
            secret.encode("utf-8"), payload, hashlib.sha256
        ).hexdigest() + "  "

        assert verify_facebook_signature(secret, payload, expected_sig, None) is True
