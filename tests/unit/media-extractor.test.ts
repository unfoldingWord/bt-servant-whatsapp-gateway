import { describe, it, expect } from 'vitest';
import { extractMedia } from '../../src/services/media-extractor';

describe('extractMedia', () => {
  it('returns no attachments when text has no URLs', () => {
    const text = 'Hello world, no media here.';
    const result = extractMedia(text);
    expect(result.attachments).toEqual([]);
    expect(result.captionText).toBe(text);
  });

  it('extracts a wrapped jpg URL and preserves the URL in the caption as fallback', () => {
    const text =
      "I've got the goods!\n\n🏛 *Acropolis Athens*\n![Acropolis](https://cdn.example.com/acropolis.jpg)\n\nRelevant to Paul's visit.";
    const result = extractMedia(text);
    expect(result.attachments).toEqual([
      { kind: 'image', url: 'https://cdn.example.com/acropolis.jpg' },
    ]);
    expect(result.captionText).toBe(
      "I've got the goods!\n\n🏛 *Acropolis Athens*\nhttps://cdn.example.com/acropolis.jpg\n\nRelevant to Paul's visit."
    );
  });

  it('extracts a wrapped mp4 as a video attachment', () => {
    const text = 'Watch:\n[Fishing](https://cdn.example.com/fishing.mp4)\nCool!';
    const result = extractMedia(text);
    expect(result.attachments).toEqual([
      { kind: 'video', url: 'https://cdn.example.com/fishing.mp4' },
    ]);
    expect(result.captionText).toContain('https://cdn.example.com/fishing.mp4');
  });

  it('captures query string and fragment as part of the URL and preserves them in caption', () => {
    const text = '![Img](https://cdn.example.com/img.jpg?v=1&t=2#frag)';
    const result = extractMedia(text);
    expect(result.attachments[0]?.url).toBe('https://cdn.example.com/img.jpg?v=1&t=2#frag');
    expect(result.captionText).toBe('https://cdn.example.com/img.jpg?v=1&t=2#frag');
  });

  it('skips http:// (non-HTTPS) URLs even when wrapped', () => {
    const text = '![X](http://insecure.example.com/img.jpg) is not safe.';
    const result = extractMedia(text);
    expect(result.attachments).toEqual([]);
    expect(result.captionText).toBe(text);
  });

  it('extracts multiple wrapped URLs in the order they appear', () => {
    const text =
      'First: ![A](https://cdn.example.com/a.jpg) then [B](https://cdn.example.com/b.mp4) and done.';
    const result = extractMedia(text);
    expect(result.attachments).toEqual([
      { kind: 'image', url: 'https://cdn.example.com/a.jpg' },
      { kind: 'video', url: 'https://cdn.example.com/b.mp4' },
    ]);
  });

  it('does not extract media when extension is mid-path (.jpg/foo) inside a wrapper', () => {
    const text = '![X](https://cdn.example.com/img.jpg/foo) bar.';
    const result = extractMedia(text);
    expect(result.attachments).toEqual([]);
  });

  it('matches case-insensitively for extensions', () => {
    const text =
      'Big file ![A](https://cdn.example.com/IMG.JPG) and [B](https://cdn.example.com/CLIP.MP4).';
    const result = extractMedia(text);
    expect(result.attachments).toEqual([
      { kind: 'image', url: 'https://cdn.example.com/IMG.JPG' },
      { kind: 'video', url: 'https://cdn.example.com/CLIP.MP4' },
    ]);
  });

  it('preserves the URL as the entire caption when the wrapped URL is the whole text', () => {
    const text = '![](https://cdn.example.com/bare.jpg)';
    const result = extractMedia(text);
    expect(result.attachments).toHaveLength(1);
    expect(result.captionText).toBe('https://cdn.example.com/bare.jpg');
  });

  it('collapses extra blank lines around an unwrapped wrapper', () => {
    const text = 'Line 1\n\n\n![Img](https://cdn.example.com/img.jpg)\n\n\nLine 2';
    const result = extractMedia(text);
    expect(result.captionText).toBe(
      'Line 1\n\nhttps://cdn.example.com/img.jpg\n\nLine 2'
    );
  });

  it('returns the full caption without truncation even when very long', () => {
    const filler = 'a'.repeat(2000);
    const text = `${filler} ![X](https://cdn.example.com/img.jpg) trailing`;
    const result = extractMedia(text);
    expect(result.captionText.length).toBeGreaterThan(1024);
    expect(result.captionText).toBe(`${filler} https://cdn.example.com/img.jpg trailing`);
    expect(result.captionText.endsWith('…')).toBe(false);
  });

  it('recognizes webp, gif, png for images when wrapped', () => {
    const text =
      'A: ![a](https://cdn.example.com/a.webp) B: ![b](https://cdn.example.com/b.gif) C: ![c](https://cdn.example.com/c.png).';
    const result = extractMedia(text);
    expect(result.attachments.map((a) => a.kind)).toEqual(['image', 'image', 'image']);
  });

  it('recognizes mov and 3gp for videos when wrapped', () => {
    const text =
      'A: [a](https://cdn.example.com/a.mov) B: [b](https://cdn.example.com/b.3gp) done.';
    const result = extractMedia(text);
    expect(result.attachments.map((a) => a.kind)).toEqual(['video', 'video']);
  });

  it('unwraps `![alt](url.jpg)` into one attachment, dropping alt text but preserving the URL', () => {
    const text =
      "Here's the map:\n![Mount Tabor Map](https://cdn.example.com/map.jpg)\nClick for details.";
    const result = extractMedia(text);
    expect(result.attachments).toEqual([{ kind: 'image', url: 'https://cdn.example.com/map.jpg' }]);
    expect(result.captionText).toBe(
      "Here's the map:\nhttps://cdn.example.com/map.jpg\nClick for details."
    );
    expect(result.captionText).not.toContain('Mount Tabor Map');
    expect(result.captionText).not.toContain('![');
    expect(result.captionText).not.toContain('](');
  });

  it('unwraps `[label](url.mp4)` into one attachment, dropping label but preserving the URL', () => {
    const text = 'Watch this:\n[Fishing Net](https://cdn.example.com/vid.mp4)\nEnjoy!';
    const result = extractMedia(text);
    expect(result.attachments).toEqual([{ kind: 'video', url: 'https://cdn.example.com/vid.mp4' }]);
    expect(result.captionText).toBe(
      'Watch this:\nhttps://cdn.example.com/vid.mp4\nEnjoy!'
    );
    expect(result.captionText).not.toContain('Fishing Net');
    expect(result.captionText).not.toContain('[');
    expect(result.captionText).not.toContain('](');
  });

  it('does not double the label when worker pre-labels image in prose', () => {
    const text = 'Bread:\n![Bread](https://cdn.example.com/bread.jpg)\n\nMore prose.';
    const result = extractMedia(text);
    expect(result.attachments).toEqual([
      { kind: 'image', url: 'https://cdn.example.com/bread.jpg' },
    ]);
    expect(result.captionText).toBe(
      'Bread:\nhttps://cdn.example.com/bread.jpg\n\nMore prose.'
    );
    expect(result.captionText).not.toMatch(/Bread\s+Bread/);
  });

  it('unwraps `![](url.jpg)` with empty alt to just the URL — no stray brackets', () => {
    const text = 'Before\n![](https://cdn.example.com/bare.jpg)\nAfter';
    const result = extractMedia(text);
    expect(result.attachments).toEqual([
      { kind: 'image', url: 'https://cdn.example.com/bare.jpg' },
    ]);
    expect(result.captionText).toBe('Before\nhttps://cdn.example.com/bare.jpg\nAfter');
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

  // Issue #28 acceptance cases — explicit attach-intent + bare-URL fallback contract.

  it('does NOT extract a bare URL — only wrapped URLs become attachments', () => {
    const text =
      'Reference list:\nhttps://cdn.example.com/ref-image.jpg\nhttps://cdn.example.com/ref-video.mp4\nNothing should attach.';
    const result = extractMedia(text);
    expect(result.attachments).toEqual([]);
    expect(result.captionText).toBe(text);
  });

  it('mixes wrapped and bare URLs: wrapped attaches, bare survives in caption verbatim', () => {
    const text =
      'First ![Map](https://cdn.example.com/a.jpg) then bare https://cdn.example.com/b.mp4 done.';
    const result = extractMedia(text);
    expect(result.attachments).toEqual([
      { kind: 'image', url: 'https://cdn.example.com/a.jpg' },
    ]);
    expect(result.captionText).toBe(
      'First https://cdn.example.com/a.jpg then bare https://cdn.example.com/b.mp4 done.'
    );
  });

  it('dedupes the same URL emitted in two wrappers — one attachment, both occurrences preserved in caption', () => {
    const text =
      '[Watch](https://cdn.example.com/v.mp4) and also [Open the video](https://cdn.example.com/v.mp4)';
    const result = extractMedia(text);
    expect(result.attachments).toEqual([
      { kind: 'video', url: 'https://cdn.example.com/v.mp4' },
    ]);
    const occurrences = result.captionText.match(/https:\/\/cdn\.example\.com\/v\.mp4/g);
    expect(occurrences).toHaveLength(2);
  });

  it('Aquifer linked-thumbnail `[![Thumb](thumb.jpg)](v.mp4)`: inner image attaches, outer video URL still survives in caption', () => {
    // Documented limitation: the outer link's "label" contains brackets so the
    // wrapper regex (`[^\]]*`) does not match it. Only the inner image is
    // extracted as an attachment. The outer URL is unaffected by unwrap and
    // therefore still appears in caption text — the silent-drop fallback
    // still works.
    const text = '[![Thumb](https://cdn.example.com/thumb.jpg)](https://cdn.example.com/v.mp4)';
    const result = extractMedia(text);
    expect(result.attachments).toEqual([
      { kind: 'image', url: 'https://cdn.example.com/thumb.jpg' },
    ]);
    expect(result.captionText).toContain('https://cdn.example.com/thumb.jpg');
    expect(result.captionText).toContain('https://cdn.example.com/v.mp4');
  });

  it('Mount Tabor end-to-end sample: 1 video + 2 images, all three URLs preserved in caption', () => {
    const text =
      'Here are the Mount Tabor videos for Matt 17:\n\n[Watch the Mount Tabor Video](https://s3.amazonaws.com/example/videos/a109/720p.mp4)\n\nAlso included:\n- 🗺️ ![Mount Tabor Map](https://cdn.example.com/map.jpg)\n- 📸 ![Photo of Mount Tabor](https://cdn.example.com/photo.jpg)';
    const result = extractMedia(text);
    expect(result.attachments).toEqual([
      { kind: 'video', url: 'https://s3.amazonaws.com/example/videos/a109/720p.mp4' },
      { kind: 'image', url: 'https://cdn.example.com/map.jpg' },
      { kind: 'image', url: 'https://cdn.example.com/photo.jpg' },
    ]);
    expect(result.captionText).toContain('https://s3.amazonaws.com/example/videos/a109/720p.mp4');
    expect(result.captionText).toContain('https://cdn.example.com/map.jpg');
    expect(result.captionText).toContain('https://cdn.example.com/photo.jpg');
  });
});
