/**
 * Meta/Facebook webhook signature verification.
 *
 * Uses Web Crypto API (available in Cloudflare Workers) for HMAC verification.
 */

import { arrayBufferToHex, constantTimeCompare } from '../../utils/crypto';

/**
 * Verify the signature from Meta webhook requests.
 *
 * @param body - Raw request body as string
 * @param signature - Value of X-Hub-Signature-256 header (e.g., 'sha256=...')
 * @param secret - Meta app secret
 * @returns Promise<boolean> - True if signature is valid
 */
export async function verifySignature(
  body: string,
  signature: string | null,
  secret: string
): Promise<boolean> {
  if (!signature) {
    return false;
  }

  const encoder = new TextEncoder();

  // Import the secret as a CryptoKey
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  // Compute the HMAC signature
  const signatureBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(body));

  // Convert to hex string with sha256= prefix
  const expected = 'sha256=' + arrayBufferToHex(signatureBuffer);

  // Constant-time comparison to prevent timing attacks
  return constantTimeCompare(expected, signature.trim());
}

/**
 * Verify signature with fallback to SHA-1 for legacy support.
 *
 * @param body - Raw request body as string
 * @param sig256 - Value of X-Hub-Signature-256 header
 * @param sig1 - Value of X-Hub-Signature header (legacy SHA-1)
 * @param secret - Meta app secret
 * @returns Promise<boolean> - True if signature is valid
 */
export async function verifyFacebookSignature(
  body: string,
  sig256: string | null,
  sig1: string | null,
  secret: string
): Promise<boolean> {
  // Prefer SHA-256 if provided
  if (sig256) {
    return verifySignature(body, sig256, secret);
  }

  // Fallback to SHA-1 (legacy)
  if (sig1) {
    return verifySha1Signature(body, sig1, secret);
  }

  return false;
}

async function verifySha1Signature(
  body: string,
  signature: string,
  secret: string
): Promise<boolean> {
  const encoder = new TextEncoder();

  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  );

  const signatureBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
  const expected = 'sha1=' + arrayBufferToHex(signatureBuffer);

  return constantTimeCompare(expected, signature.trim());
}
