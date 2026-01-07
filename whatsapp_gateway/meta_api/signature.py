"""Facebook/Meta webhook signature verification."""

import hashlib
import hmac


def verify_facebook_signature(
    app_secret: str, payload: bytes, sig256: str | None, sig1: str | None
) -> bool:
    """
    Verify the signature from Meta webhook requests.

    Args:
        app_secret: your Meta app secret (string)
        payload: raw request body as bytes
        sig256: value of X-Hub-Signature-256 header (e.g., 'sha256=...')
        sig1: value of X-Hub-Signature header (e.g., 'sha1=...') - legacy fallback

    Returns:
        True if signature is valid, False otherwise
    """
    # Prefer SHA-256 if provided
    if sig256:
        expected = (
            "sha256=" + hmac.new(app_secret.encode("utf-8"), payload, hashlib.sha256).hexdigest()
        )
        return hmac.compare_digest(expected, sig256.strip())

    # Fallback to SHA-1 if only that header is present
    if sig1:
        expected = "sha1=" + hmac.new(app_secret.encode("utf-8"), payload, hashlib.sha1).hexdigest()
        return hmac.compare_digest(expected, sig1.strip())

    return False
