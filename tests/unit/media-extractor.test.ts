import { describe, it, expect } from 'vitest';
import { extractMedia } from '../../src/services/media-extractor';

describe('extractMedia', () => {
  it('returns no attachments when text has no URLs', () => {
    const text = 'Hello world, no media here.';
    const result = extractMedia(text);
    expect(result.attachments).toEqual([]);
    expect(result.captionText).toBe(text);
  });

  it('extracts a single https jpg URL and strips it from the caption', () => {
    const text =
      "I've got the goods!\n\n🏛 *Acropolis Athens*\nhttps://cdn.example.com/acropolis.jpg\n\nRelevant to Paul's visit.";
    const result = extractMedia(text);
    expect(result.attachments).toEqual([
      { kind: 'image', url: 'https://cdn.example.com/acropolis.jpg' },
    ]);
    expect(result.captionText).toBe(
      "I've got the goods!\n\n🏛 *Acropolis Athens*\n\nRelevant to Paul's visit."
    );
    expect(result.captionText).not.toContain('https://');
  });

  it('extracts a single mp4 as a video attachment', () => {
    const text = 'Watch:\nhttps://cdn.example.com/fishing.mp4\nCool!';
    const result = extractMedia(text);
    expect(result.attachments).toEqual([
      { kind: 'video', url: 'https://cdn.example.com/fishing.mp4' },
    ]);
  });

  it('captures query string and fragment as part of the URL', () => {
    const text = 'See https://cdn.example.com/img.jpg?v=1&t=2#frag here.';
    const result = extractMedia(text);
    expect(result.attachments[0]?.url).toBe('https://cdn.example.com/img.jpg?v=1&t=2#frag');
  });

  it('skips http:// (non-HTTPS) URLs', () => {
    const text = 'http://insecure.example.com/img.jpg is not safe.';
    const result = extractMedia(text);
    expect(result.attachments).toEqual([]);
    expect(result.captionText).toBe(text);
  });

  it('extracts multiple URLs in the order they appear', () => {
    const text =
      'First: https://cdn.example.com/a.jpg then https://cdn.example.com/b.mp4 and done.';
    const result = extractMedia(text);
    expect(result.attachments).toEqual([
      { kind: 'image', url: 'https://cdn.example.com/a.jpg' },
      { kind: 'video', url: 'https://cdn.example.com/b.mp4' },
    ]);
  });

  it('does not include surrounding punctuation in the URL', () => {
    const text = 'Check (https://cdn.example.com/img.jpg) or "https://cdn.example.com/vid.mp4".';
    const result = extractMedia(text);
    expect(result.attachments.map((a) => a.url)).toEqual([
      'https://cdn.example.com/img.jpg',
      'https://cdn.example.com/vid.mp4',
    ]);
  });

  it('handles a terminal period (sentence-final URL)', () => {
    const text = 'The image is at https://cdn.example.com/img.jpg.';
    const result = extractMedia(text);
    expect(result.attachments[0]?.url).toBe('https://cdn.example.com/img.jpg');
    expect(result.captionText).toBe('The image is at .');
  });

  it('does not match when extension is mid-path (.jpg/foo)', () => {
    const text = 'Not media: https://cdn.example.com/img.jpg/foo bar.';
    const result = extractMedia(text);
    expect(result.attachments).toEqual([]);
  });

  it('matches case-insensitively for extensions', () => {
    const text = 'Big file https://cdn.example.com/IMG.JPG and https://cdn.example.com/CLIP.MP4.';
    const result = extractMedia(text);
    expect(result.attachments).toEqual([
      { kind: 'image', url: 'https://cdn.example.com/IMG.JPG' },
      { kind: 'video', url: 'https://cdn.example.com/CLIP.MP4' },
    ]);
  });

  it('produces an empty caption when the URL is the whole text', () => {
    const text = 'https://cdn.example.com/img.jpg';
    const result = extractMedia(text);
    expect(result.attachments).toHaveLength(1);
    expect(result.captionText).toBe('');
  });

  it('collapses extra blank lines left by URL removal', () => {
    const text = 'Line 1\n\nhttps://cdn.example.com/img.jpg\n\nLine 2';
    const result = extractMedia(text);
    expect(result.captionText).toBe('Line 1\n\nLine 2');
  });

  it('returns the full stripped text without truncation even when very long', () => {
    const filler = 'a'.repeat(2000);
    const text = `${filler} https://cdn.example.com/img.jpg trailing`;
    const result = extractMedia(text);
    expect(result.captionText.length).toBeGreaterThan(1024);
    expect(result.captionText).toBe(`${filler}  trailing`);
    expect(result.captionText.endsWith('…')).toBe(false);
  });

  it('recognizes webp, gif, png for images', () => {
    const text =
      'A: https://cdn.example.com/a.webp B: https://cdn.example.com/b.gif C: https://cdn.example.com/c.png.';
    const result = extractMedia(text);
    expect(result.attachments.map((a) => a.kind)).toEqual(['image', 'image', 'image']);
  });

  it('recognizes mov and 3gp for videos', () => {
    const text = 'A: https://cdn.example.com/a.mov B: https://cdn.example.com/b.3gp done.';
    const result = extractMedia(text);
    expect(result.attachments.map((a) => a.kind)).toEqual(['video', 'video']);
  });

  it('unwraps `![alt](url.jpg)` markdown image into one attachment with clean caption', () => {
    const text =
      "Here's the map:\n![Mount Tabor Map](https://cdn.example.com/map.jpg)\nClick for details.";
    const result = extractMedia(text);
    expect(result.attachments).toEqual([{ kind: 'image', url: 'https://cdn.example.com/map.jpg' }]);
    expect(result.captionText).toContain('Mount Tabor Map');
    expect(result.captionText).not.toContain('![');
    expect(result.captionText).not.toContain('](');
    expect(result.captionText).not.toContain('https://');
  });

  it('unwraps `[label](url.mp4)` markdown video link into one attachment with clean caption', () => {
    const text = 'Watch this:\n[Fishing Net](https://cdn.example.com/vid.mp4)\nEnjoy!';
    const result = extractMedia(text);
    expect(result.attachments).toEqual([{ kind: 'video', url: 'https://cdn.example.com/vid.mp4' }]);
    expect(result.captionText).toContain('Fishing Net');
    expect(result.captionText).not.toContain('[');
    expect(result.captionText).not.toContain('](');
    expect(result.captionText).not.toContain('https://');
  });

  it('unwraps `![](url.jpg)` with empty alt to just the URL — caption has no stray brackets or whitespace', () => {
    const text = 'Before\n![](https://cdn.example.com/bare.jpg)\nAfter';
    const result = extractMedia(text);
    expect(result.attachments).toEqual([
      { kind: 'image', url: 'https://cdn.example.com/bare.jpg' },
    ]);
    expect(result.captionText).toBe('Before\n\nAfter');
    expect(result.captionText).not.toContain('[');
    expect(result.captionText).not.toContain(']');
  });

  it('leaves non-media markdown links untouched in the caption', () => {
    const text = 'See [docs](https://example.com/policy) for details.';
    const result = extractMedia(text);
    expect(result.attachments).toEqual([]);
    expect(result.captionText).toBe(text);
  });

  it('classifies by URL extension even when prefix mismatches (`![alt](vid.mp4)` is video)', () => {
    const text = '![odd](https://cdn.example.com/vid.mp4)';
    const result = extractMedia(text);
    expect(result.attachments).toEqual([{ kind: 'video', url: 'https://cdn.example.com/vid.mp4' }]);
  });

  it('extracts both a markdown-wrapped media link and a bare URL in order', () => {
    const text =
      'First ![Map](https://cdn.example.com/a.jpg) then bare https://cdn.example.com/b.mp4 done.';
    const result = extractMedia(text);
    expect(result.attachments).toEqual([
      { kind: 'image', url: 'https://cdn.example.com/a.jpg' },
      { kind: 'video', url: 'https://cdn.example.com/b.mp4' },
    ]);
    expect(result.captionText).toContain('Map');
    expect(result.captionText).toContain('First');
    expect(result.captionText).toContain('done.');
    expect(result.captionText).not.toContain('![');
    expect(result.captionText).not.toContain('](');
    expect(result.captionText).not.toContain('https://');
  });
});
