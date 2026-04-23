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
  /** Original text with media markdown unwrapped and whitespace collapsed. URLs are preserved. */
  captionText: string;
}

/** WhatsApp caption length cap. Callers decide how to honor it. */
export const MAX_CAPTION_LENGTH = 1024;

const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif']);
const VIDEO_EXTS = new Set(['mp4', 'mov', '3gp']);

/**
 * Markdown-wrapped media link: `![alt](url)` or `[label](url)` where the URL
 * has a recognized media extension. Non-media links like `[docs](https://...)`
 * are intentionally not matched here.
 *
 * Wrapper presence is treated as explicit attach-intent. Bare URLs in the
 * surrounding text are not extracted as attachments — they pass through to
 * the caption as the silent-drop fallback if Meta drops the attachment.
 */
const MEDIA_MARKDOWN_REGEX =
  // eslint-disable-next-line security/detect-unsafe-regex
  /!?\[([^\]]*)\]\((https:\/\/[^\s)]+?\.(?:jpg|jpeg|png|webp|gif|mp4|mov|3gp)(?:\?[^\s)]*)?(?:#[^\s)]*)?)\)/gi;

/**
 * Aquifer-style linked thumbnail: `[![alt](thumb-url)](outer-url)`. The inner
 * `]` would defeat `MEDIA_MARKDOWN_REGEX`'s `[^\]]*` label so we match the
 * full nested pattern explicitly to keep the outer media URL attachable.
 * Both URLs must have recognized media extensions.
 */
const LINKED_THUMB_REGEX =
  // eslint-disable-next-line security/detect-unsafe-regex
  /\[!?\[([^\]]*)\]\((https:\/\/[^\s)]+?\.(?:jpg|jpeg|png|webp|gif|mp4|mov|3gp)(?:\?[^\s)]*)?(?:#[^\s)]*)?)\)\]\((https:\/\/[^\s)]+?\.(?:jpg|jpeg|png|webp|gif|mp4|mov|3gp)(?:\?[^\s)]*)?(?:#[^\s)]*)?)\)/gi;

function unwrapMediaMarkdown(text: string): string {
  return text
    .replace(
      LINKED_THUMB_REGEX,
      (_match, _label: string, thumbUrl: string, outerUrl: string) => `${thumbUrl} ${outerUrl}`
    )
    .replace(MEDIA_MARKDOWN_REGEX, (_match, _label: string, url: string) => url);
}

function extensionOf(url: string): string | null {
  const m = url.match(/\.([a-z0-9]+)(?:\?[^#]*)?(?:#.*)?$/i);
  const ext = m?.[1];
  return ext ? ext.toLowerCase() : null;
}

function kindFor(ext: string): MediaKind | null {
  const lower = ext.toLowerCase();
  if (IMAGE_EXTS.has(lower)) return 'image';
  if (VIDEO_EXTS.has(lower)) return 'video';
  return null;
}

function findAttachments(text: string): MediaAttachment[] {
  const out: MediaAttachment[] = [];
  const seen = new Set<string>();
  const add = (url: string | undefined): void => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    const ext = extensionOf(url);
    if (!ext) return;
    const kind = kindFor(ext);
    if (kind) out.push({ kind, url });
  };
  for (const match of text.matchAll(LINKED_THUMB_REGEX)) {
    add(match[2]);
    add(match[3]);
  }
  for (const match of text.matchAll(MEDIA_MARKDOWN_REGEX)) {
    add(match[2]);
  }
  return out;
}

function collapseWhitespace(text: string): string {
  const lines = text.split('\n').map((line) => line.trimEnd());
  return lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function extractMedia(text: string): ExtractionResult {
  const attachments = findAttachments(text);
  const unwrapped = unwrapMediaMarkdown(text);
  const captionText = collapseWhitespace(unwrapped);
  return { attachments, captionText };
}
