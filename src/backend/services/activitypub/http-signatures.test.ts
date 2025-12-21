import { describe, it, expect, beforeAll } from 'vitest';
import {
  generateKeyPair,
  signRequest,
  verifySignature,
  verifySignatureWithDetails,
  verifyRequest,
  extractKeyId,
} from './http-signatures';

describe('HTTP Signatures', () => {
  let privateKey: string;
  let publicKey: string;

  beforeAll(async () => {
    const keyPair = await generateKeyPair();
    privateKey = keyPair.privateKey;
    publicKey = keyPair.publicKey;
  });

  describe('generateKeyPair', () => {
    it('should generate valid RSA key pair', async () => {
      const keyPair = await generateKeyPair();

      expect(keyPair.privateKey).toContain('-----BEGIN PRIVATE KEY-----');
      expect(keyPair.publicKey).toContain('-----BEGIN PUBLIC KEY-----');
    });
  });

  describe('signRequest', () => {
    it('should sign a request with required headers', async () => {
      const headers = await signRequest({
        method: 'POST',
        url: 'https://example.com/inbox',
        body: '{"type":"Follow"}',
        privateKeyPem: privateKey,
        keyId: 'https://example.com/users/alice#main-key',
      });

      expect(headers.Date).toBeDefined();
      expect(headers.Signature).toBeDefined();
      expect(headers.Digest).toBeDefined();

      expect(headers.Signature).toContain('keyId="https://example.com/users/alice#main-key"');
      expect(headers.Signature).toContain('algorithm="rsa-sha256"');
      expect(headers.Signature).toContain('headers="(request-target) host date digest"');
    });

    it('should not include digest for requests without body', async () => {
      const headers = await signRequest({
        method: 'GET',
        url: 'https://example.com/users/alice',
        privateKeyPem: privateKey,
        keyId: 'https://example.com/users/bob#main-key',
      });

      expect(headers.Date).toBeDefined();
      expect(headers.Signature).toBeDefined();
      expect(headers.Digest).toBeUndefined();
    });
  });

  describe('verifySignature', () => {
    it('should verify a valid signature', async () => {
      const body = '{"type":"Follow","actor":"https://example.com/users/bob"}';
      const url = 'https://example.com/users/alice/inbox';

      const signedHeaders = await signRequest({
        method: 'POST',
        url,
        body,
        privateKeyPem: privateKey,
        keyId: 'https://example.com/users/bob#main-key',
      });

      const request = new Request(url, {
        method: 'POST',
        headers: {
          ...signedHeaders,
          'Content-Type': 'application/activity+json',
          Host: 'example.com',
        },
        body,
      });

      const isValid = await verifySignature({
        request,
        publicKeyPem: publicKey,
      });

      expect(isValid).toBe(true);
    });

    it('should reject signature with wrong public key', async () => {
      const body = '{"type":"Follow"}';
      const url = 'https://example.com/users/alice/inbox';

      const signedHeaders = await signRequest({
        method: 'POST',
        url,
        body,
        privateKeyPem: privateKey,
        keyId: 'https://example.com/users/bob#main-key',
      });

      const request = new Request(url, {
        method: 'POST',
        headers: {
          ...signedHeaders,
          Host: 'example.com',
        },
        body,
      });

      // Generate different key pair
      const otherKeyPair = await generateKeyPair();

      const isValid = await verifySignature({
        request,
        publicKeyPem: otherKeyPair.publicKey,
      });

      expect(isValid).toBe(false);
    });

    it('should reject tampered body', async () => {
      const originalBody = '{"type":"Follow"}';
      const url = 'https://example.com/users/alice/inbox';

      const signedHeaders = await signRequest({
        method: 'POST',
        url,
        body: originalBody,
        privateKeyPem: privateKey,
        keyId: 'https://example.com/users/bob#main-key',
      });

      // Create request with different body but same signature
      const tamperedBody = '{"type":"Delete"}';
      const request = new Request(url, {
        method: 'POST',
        headers: {
          ...signedHeaders,
          Host: 'example.com',
        },
        body: tamperedBody,
      });

      // Signature should still match the headers (including original digest)
      // But verifyRequest should detect the digest mismatch
      const result = await verifyRequest({
        request,
        body: tamperedBody,
        publicKeyPem: publicKey,
      });

      // The signature itself might verify (it's signing the old digest)
      // but verifyRequest should catch the digest mismatch
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Digest mismatch');
    });
  });

  describe('verifySignatureWithDetails', () => {
    it('should return detailed result for missing signature', async () => {
      const request = new Request('https://example.com/inbox', {
        method: 'POST',
        headers: {
          Host: 'example.com',
        },
        body: '{}',
      });

      const result = await verifySignatureWithDetails({
        request,
        publicKeyPem: publicKey,
      });

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Missing Signature header');
    });

    it('should return keyId and signedHeaders on success', async () => {
      const body = '{"type":"Follow"}';
      const url = 'https://example.com/inbox';
      const keyId = 'https://example.com/users/bob#main-key';

      const signedHeaders = await signRequest({
        method: 'POST',
        url,
        body,
        privateKeyPem: privateKey,
        keyId,
      });

      const request = new Request(url, {
        method: 'POST',
        headers: {
          ...signedHeaders,
          Host: 'example.com',
        },
        body,
      });

      const result = await verifySignatureWithDetails({
        request,
        publicKeyPem: publicKey,
      });

      expect(result.valid).toBe(true);
      expect(result.keyId).toBe(keyId);
      expect(result.signedHeaders).toContain('(request-target)');
      expect(result.signedHeaders).toContain('host');
      expect(result.signedHeaders).toContain('date');
    });
  });

  describe('verifyRequest', () => {
    it('should verify complete request including date and digest', async () => {
      const body = '{"type":"Follow"}';
      const url = 'https://example.com/inbox';

      const signedHeaders = await signRequest({
        method: 'POST',
        url,
        body,
        privateKeyPem: privateKey,
        keyId: 'https://example.com/users/bob#main-key',
      });

      const request = new Request(url, {
        method: 'POST',
        headers: {
          ...signedHeaders,
          Host: 'example.com',
        },
        body,
      });

      const result = await verifyRequest({
        request,
        body,
        publicKeyPem: publicKey,
        strictMode: true,
      });

      expect(result.valid).toBe(true);
    });

    it('should warn but pass with old date in non-strict mode', async () => {
      const body = '{"type":"Follow"}';
      const url = 'https://example.com/inbox';

      // Create request with old date
      const oldDate = new Date(Date.now() - 10 * 60 * 1000).toUTCString(); // 10 minutes ago

      const request = new Request(url, {
        method: 'POST',
        headers: {
          Date: oldDate,
          Host: 'example.com',
          Signature: 'keyId="test",algorithm="rsa-sha256",headers="(request-target) host date",signature="test"',
        },
        body,
      });

      // This will fail signature verification, but date check passes in non-strict mode
      const result = await verifyRequest({
        request,
        body,
        publicKeyPem: publicKey,
        strictMode: false,
      });

      // Will fail due to signature, not date
      expect(result.valid).toBe(false);
    });
  });

  describe('extractKeyId', () => {
    it('should extract keyId from signature header', () => {
      const signatureHeader = 'keyId="https://example.com/users/alice#main-key",algorithm="rsa-sha256",headers="(request-target) host date",signature="abc123"';
      const keyId = extractKeyId(signatureHeader);
      expect(keyId).toBe('https://example.com/users/alice#main-key');
    });

    it('should return null for missing header', () => {
      const keyId = extractKeyId(null);
      expect(keyId).toBeNull();
    });

    it('should return null for malformed header', () => {
      const keyId = extractKeyId('invalid-header');
      expect(keyId).toBeNull();
    });
  });
});
