/**
 * Extract embedded media URLs from response text so they can be rendered
 * as inline WhatsApp image/video messages instead of as plain URL text.
 *
 * Pure module — no I/O, no env, no logging. Caller is responsible for logging.
 */

export type MediaKind = 'image' | 'video';

export interface MediaAttachment {
  kind: MediaKind;
  url: string;
}

export interface ExtractionResult {
  attachments: MediaAttachment[];
  captionText: string;
  captionTruncated: boolean;
}

/** WhatsApp caption length cap. */
export const MAX_CAPTION_LENGTH = 1024;

const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif']);
const VIDEO_EXTS = new Set(['mp4', 'mov', '3gp']);

/**
 * HTTPS URL ending in a recognized media extension, with optional query/fragment.
 * The trailing lookahead ensures the extension terminates the URL — so
 * `.jpg/foo` does not match but `.jpg`, `.jpg?v=1`, `.jpg.` (sentence-final)
 * and `.jpg)` (in prose) all do.
 */
const MEDIA_REGEX =
  // eslint-disable-next-line security/detect-unsafe-regex
  /https:\/\/[^\s<>"')]+?\.(jpg|jpeg|png|webp|gif|mp4|mov|3gp)(?:\?[^\s<>"')]*)?(?:#[^\s<>"')]*)?(?=$|[\s)\]}>"',;!?]|\.(?:\s|$))/gi;

function kindFor(ext: string): MediaKind | null {
  const lower = ext.toLowerCase();
  if (IMAGE_EXTS.has(lower)) return 'image';
  if (VIDEO_EXTS.has(lower)) return 'video';
  return null;
}

function findAttachments(text: string): MediaAttachment[] {
  const attachments: MediaAttachment[] = [];
  for (const match of text.matchAll(MEDIA_REGEX)) {
    const ext = match[1];
    if (!ext) continue;
    const kind = kindFor(ext);
    if (!kind) continue;
    attachments.push({ kind, url: match[0] });
  }
  return attachments;
}

function stripUrls(text: string, urls: string[]): string {
  let result = text;
  for (const url of urls) {
    result = result.split(url).join('');
  }
  return result;
}

function collapseWhitespace(text: string): string {
  const lines = text.split('\n').map((line) => line.trimEnd());
  return lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function truncateCaption(text: string): { caption: string; truncated: boolean } {
  if (text.length <= MAX_CAPTION_LENGTH) {
    return { caption: text, truncated: false };
  }
  return { caption: text.slice(0, MAX_CAPTION_LENGTH - 1) + '…', truncated: true };
}

export function extractMedia(text: string): ExtractionResult {
  const attachments = findAttachments(text);
  if (attachments.length === 0) {
    return { attachments: [], captionText: text, captionTruncated: false };
  }
  const urls = attachments.map((a) => a.url);
  const stripped = collapseWhitespace(stripUrls(text, urls));
  const { caption, truncated } = truncateCaption(stripped);
  return { attachments, captionText: caption, captionTruncated: truncated };
}
