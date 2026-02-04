/**
 * Message chunking for WhatsApp message length limits.
 */

/** Default chunk size for WhatsApp messages */
const DEFAULT_CHUNK_SIZE = 1500;

/** Sentence boundary delimiters */
const SENTENCE_DELIMITERS = new Set(['.', ';', '\n\n']);

/**
 * Split a message into chunks that fit within WhatsApp's message limits.
 *
 * Attempts to split at sentence boundaries for better readability.
 */
export function chunkMessage(text: string, maxLength: number = DEFAULT_CHUNK_SIZE): string[] {
  if (text.length <= maxLength) {
    return [text];
  }

  // Try to split at sentence boundaries
  const chunks = splitAtSentences(text, maxLength);

  // Ensure no chunk exceeds the limit
  const finalChunks: string[] = [];
  for (const chunk of chunks) {
    if (chunk.length <= maxLength) {
      finalChunks.push(chunk);
    } else {
      finalChunks.push(...forceSplit(chunk, maxLength));
    }
  }

  return finalChunks;
}

/**
 * Reattach sentence delimiters to their preceding text.
 */
function reattachDelimiters(pieces: string[]): string[] {
  const combined: string[] = [];
  let i = 0;

  while (i < pieces.length) {
    const current = pieces[i] ?? '';
    const next = pieces[i + 1];
    const hasDelimiter = next !== undefined && SENTENCE_DELIMITERS.has(next);

    const piece = hasDelimiter ? current + next : current;
    i += hasDelimiter ? 2 : 1;

    const trimmed = piece.trim();
    if (trimmed) {
      combined.push(trimmed);
    }
  }

  return combined;
}

/**
 * Combine pieces into chunks respecting maxLength.
 */
function combineIntoChunks(pieces: string[], maxLength: number): string[] {
  const chunks: string[] = [];
  let currentChunk = '';

  for (const piece of pieces) {
    const separator = currentChunk ? ' ' : '';
    const wouldFit = currentChunk.length + separator.length + piece.length <= maxLength;

    if (wouldFit) {
      currentChunk += separator + piece;
    } else {
      if (currentChunk) chunks.push(currentChunk);
      currentChunk = piece;
    }
  }

  if (currentChunk) chunks.push(currentChunk);
  return chunks;
}

/**
 * Split text at sentence boundaries, keeping chunks under maxLength.
 */
function splitAtSentences(text: string, maxLength: number): string[] {
  const pieces = text.split(/(\.|;|\n\n)/);
  const combinedPieces = reattachDelimiters(pieces);
  return combineIntoChunks(combinedPieces, maxLength);
}

/**
 * Force split text that exceeds maxLength, trying word boundaries.
 */
function forceSplit(text: string, maxLength: number): string[] {
  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > maxLength) {
    let splitPoint = remaining.lastIndexOf(' ', maxLength);
    if (splitPoint === -1) splitPoint = maxLength;

    const chunk = remaining.slice(0, splitPoint).trim();
    if (chunk) chunks.push(chunk);
    remaining = remaining.slice(splitPoint).trim();
  }

  if (remaining) chunks.push(remaining);
  return chunks;
}

/**
 * Combine small chunks into larger ones up to maxLength.
 */
export function combineChunks(chunks: string[], maxLength: number = DEFAULT_CHUNK_SIZE): string[] {
  const combined: string[] = [];
  let current = '';

  for (const chunk of chunks) {
    const separator = current ? '\n\n' : '';
    const wouldFit = current.length + separator.length + chunk.length <= maxLength;

    if (wouldFit) {
      current += separator + chunk;
    } else {
      if (current) combined.push(current);
      current = chunk;
    }
  }

  if (current) combined.push(current);
  return combined;
}
