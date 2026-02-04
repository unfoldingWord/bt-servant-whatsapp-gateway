import { describe, it, expect } from 'vitest';
import { chunkMessage, combineChunks } from '../../src/services/chunking';

describe('chunking', () => {
  describe('chunkMessage', () => {
    it('should return single chunk for short messages', () => {
      const result = chunkMessage('Hello world', 100);
      expect(result).toEqual(['Hello world']);
    });

    it('should return message as-is if exactly at limit', () => {
      const message = 'a'.repeat(100);
      const result = chunkMessage(message, 100);
      expect(result).toEqual([message]);
    });

    it('should split at sentence boundaries', () => {
      const message = 'First sentence. Second sentence. Third sentence.';
      const result = chunkMessage(message, 30);
      expect(result).toEqual(['First sentence.', 'Second sentence.', 'Third sentence.']);
    });

    it('should split at semicolons', () => {
      const message = 'Part one; Part two; Part three.';
      const result = chunkMessage(message, 15);
      expect(result).toEqual(['Part one;', 'Part two;', 'Part three.']);
    });

    it('should combine sentences that fit within limit', () => {
      const message = 'Short. Also short. Still short.';
      const result = chunkMessage(message, 50);
      expect(result).toEqual(['Short. Also short. Still short.']);
    });

    it('should split at word boundaries when no sentence boundary', () => {
      const message = 'This is a long sentence without any periods';
      const result = chunkMessage(message, 20);
      // Should split at word boundaries
      expect(result.every((chunk) => chunk.length <= 20)).toBe(true);
      expect(result.join(' ')).toBe(message);
    });

    it('should force split if no word boundary found', () => {
      const message = 'a'.repeat(50);
      const result = chunkMessage(message, 20);
      expect(result).toHaveLength(3);
      expect(result[0]).toBe('a'.repeat(20));
      expect(result[1]).toBe('a'.repeat(20));
      expect(result[2]).toBe('a'.repeat(10));
    });

    it('should use default chunk size of 1500', () => {
      const shortMessage = 'a'.repeat(1500);
      const result = chunkMessage(shortMessage);
      expect(result).toHaveLength(1);

      const longMessage = 'a'.repeat(1501);
      const result2 = chunkMessage(longMessage);
      expect(result2).toHaveLength(2);
    });

    it('should handle double newlines as boundaries', () => {
      const message = 'Paragraph one.\n\nParagraph two.\n\nParagraph three.';
      const result = chunkMessage(message, 20);
      expect(result).toContain('Paragraph one.');
      expect(result).toContain('Paragraph two.');
      expect(result).toContain('Paragraph three.');
    });

    it('should handle empty string', () => {
      const result = chunkMessage('', 100);
      expect(result).toEqual(['']);
    });

    it('should handle whitespace only', () => {
      const result = chunkMessage('   ', 100);
      expect(result).toEqual(['   ']);
    });
  });

  describe('combineChunks', () => {
    it('should combine small chunks', () => {
      const chunks = ['Hello', 'World'];
      const result = combineChunks(chunks, 20);
      expect(result).toEqual(['Hello\n\nWorld']);
    });

    it('should not combine if it exceeds limit', () => {
      const chunks = ['Hello there', 'World here'];
      const result = combineChunks(chunks, 15);
      expect(result).toEqual(['Hello there', 'World here']);
    });

    it('should use double newline as separator', () => {
      const chunks = ['First', 'Second', 'Third'];
      const result = combineChunks(chunks, 100);
      expect(result).toEqual(['First\n\nSecond\n\nThird']);
    });

    it('should handle empty array', () => {
      const result = combineChunks([], 100);
      expect(result).toEqual([]);
    });

    it('should handle single chunk', () => {
      const result = combineChunks(['Single'], 100);
      expect(result).toEqual(['Single']);
    });

    it('should use default chunk size of 1500', () => {
      const chunks = ['a'.repeat(1000), 'b'.repeat(400)];
      const result = combineChunks(chunks);
      // 1000 + 2 (separator) + 400 = 1402, should fit
      expect(result).toHaveLength(1);
    });
  });
});
