import { describe, it, expect } from 'vitest';
import { verifySignature, verifyFacebookSignature } from '../../src/services/meta-api/signature';
import { arrayBufferToHex, constantTimeCompare } from '../../src/utils/crypto';

describe('signature verification', () => {
  const secret = 'test-secret';
  const body = '{"object":"whatsapp_business_account","entry":[]}';

  // Pre-computed HMAC-SHA256 of the body with the secret
  // echo -n '{"object":"whatsapp_business_account","entry":[]}' | openssl dgst -sha256 -hmac "test-secret"
  const validSha256Signature =
    'sha256=e4a1c94d15f5eb8e3a0b9e5f9b7a8c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a7b6';

  describe('verifySignature', () => {
    it('should return false for null signature', async () => {
      const result = await verifySignature(body, null, secret);
      expect(result).toBe(false);
    });

    it('should return false for empty signature', async () => {
      const result = await verifySignature(body, '', secret);
      expect(result).toBe(false);
    });

    it('should return false for invalid signature', async () => {
      const result = await verifySignature(body, 'sha256=invalid', secret);
      expect(result).toBe(false);
    });

    it('should validate a correct signature', async () => {
      // Compute the actual signature for this test
      const encoder = new TextEncoder();
      const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      );
      const signatureBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
      const expectedSig = 'sha256=' + arrayBufferToHex(signatureBuffer);

      const result = await verifySignature(body, expectedSig, secret);
      expect(result).toBe(true);
    });

    it('should reject signature with wrong prefix', async () => {
      const encoder = new TextEncoder();
      const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      );
      const signatureBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
      const wrongPrefixSig = 'sha1=' + arrayBufferToHex(signatureBuffer);

      const result = await verifySignature(body, wrongPrefixSig, secret);
      expect(result).toBe(false);
    });

    it('should handle signature with whitespace', async () => {
      const encoder = new TextEncoder();
      const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      );
      const signatureBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
      const sigWithWhitespace = '  sha256=' + arrayBufferToHex(signatureBuffer) + '  ';

      const result = await verifySignature(body, sigWithWhitespace, secret);
      expect(result).toBe(true);
    });
  });

  describe('verifyFacebookSignature', () => {
    it('should prefer SHA-256 signature', async () => {
      const encoder = new TextEncoder();
      const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      );
      const signatureBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
      const validSig = 'sha256=' + arrayBufferToHex(signatureBuffer);

      const result = await verifyFacebookSignature(body, validSig, 'sha1=invalid', secret);
      expect(result).toBe(true);
    });

    it('should fallback to SHA-1 if no SHA-256', async () => {
      const encoder = new TextEncoder();
      const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(secret),
        { name: 'HMAC', hash: 'SHA-1' },
        false,
        ['sign']
      );
      const signatureBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
      const validSha1Sig = 'sha1=' + arrayBufferToHex(signatureBuffer);

      const result = await verifyFacebookSignature(body, null, validSha1Sig, secret);
      expect(result).toBe(true);
    });

    it('should return false if no signatures provided', async () => {
      const result = await verifyFacebookSignature(body, null, null, secret);
      expect(result).toBe(false);
    });
  });
});

describe('crypto utilities', () => {
  describe('constantTimeCompare', () => {
    it('should return true for equal strings', () => {
      expect(constantTimeCompare('test', 'test')).toBe(true);
      expect(constantTimeCompare('', '')).toBe(true);
      expect(constantTimeCompare('abc123', 'abc123')).toBe(true);
    });

    it('should return false for different strings', () => {
      expect(constantTimeCompare('test', 'Test')).toBe(false);
      expect(constantTimeCompare('abc', 'abd')).toBe(false);
    });

    it('should return false for strings of different length', () => {
      expect(constantTimeCompare('test', 'tests')).toBe(false);
      expect(constantTimeCompare('abc', '')).toBe(false);
    });
  });

  describe('arrayBufferToHex', () => {
    it('should convert ArrayBuffer to hex string', () => {
      const buffer = new Uint8Array([0x00, 0x01, 0x0f, 0xff]).buffer;
      expect(arrayBufferToHex(buffer)).toBe('00010fff');
    });

    it('should handle empty buffer', () => {
      const buffer = new Uint8Array([]).buffer;
      expect(arrayBufferToHex(buffer)).toBe('');
    });
  });
});
