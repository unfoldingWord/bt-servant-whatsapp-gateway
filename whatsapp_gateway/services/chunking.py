"""Message chunking for WhatsApp message length limits."""

from __future__ import annotations

import re

from whatsapp_gateway.config import config

# Default chunk size for WhatsApp messages
DEFAULT_CHUNK_SIZE = 1500


def chunk_message(text: str, max_length: int | None = None) -> list[str]:
    """
    Split a message into chunks that fit within WhatsApp's message limits.

    Attempts to split at sentence boundaries for better readability.

    Args:
        text: The text to split
        max_length: Maximum length per chunk (defaults to config.CHUNK_SIZE)

    Returns:
        List of message chunks
    """
    if max_length is None:
        max_length = config.CHUNK_SIZE

    if len(text) <= max_length:
        return [text]

    # Try to split at sentence boundaries
    chunks = _split_at_sentences(text, max_length)

    # Ensure no chunk exceeds the limit
    final_chunks: list[str] = []
    for chunk in chunks:
        if len(chunk) <= max_length:
            final_chunks.append(chunk)
        else:
            # Force split long chunks
            final_chunks.extend(_force_split(chunk, max_length))

    return final_chunks


def _split_at_sentences(text: str, max_length: int) -> list[str]:
    """Split text at sentence boundaries, keeping chunks under max_length."""
    # Split by sentence-ish boundaries but keep delimiters
    # Match period, semicolon, or double newline as separators
    pieces = re.split(r"(\.|;|\n\n)", text)

    # Reattach separators to their preceding text
    combined_pieces: list[str] = []
    i = 0
    while i < len(pieces):
        piece: str = pieces[i]
        if i + 1 < len(pieces) and pieces[i + 1] in {".", ";", "\n\n"}:
            piece += pieces[i + 1]
            i += 2
        else:
            i += 1
        if piece.strip():
            combined_pieces.append(piece.strip())

    # Combine pieces into chunks respecting max_length
    chunks: list[str] = []
    current_chunk: str = ""
    for piece in combined_pieces:
        separator = " " if current_chunk else ""
        if len(current_chunk) + len(separator) + len(piece) <= max_length:
            current_chunk += separator + piece
        else:
            if current_chunk:
                chunks.append(current_chunk)
            current_chunk = piece

    if current_chunk:
        chunks.append(current_chunk)

    return chunks


def _force_split(text: str, max_length: int) -> list[str]:
    """Force split text that exceeds max_length, trying word boundaries."""
    chunks: list[str] = []
    remaining: str = text

    while len(remaining) > max_length:
        # Try to split at last space before max_length
        split_point = remaining.rfind(" ", 0, max_length)
        if split_point == -1:
            # No space found, force split at max_length
            split_point = max_length

        chunks.append(remaining[:split_point].strip())
        remaining = remaining[split_point:].strip()

    if remaining:
        chunks.append(remaining)

    return chunks


def combine_chunks(chunks: list[str], max_length: int | None = None) -> list[str]:
    """
    Combine small chunks into larger ones up to max_length.

    Useful for combining response parts that are individually small.

    Args:
        chunks: List of text chunks
        max_length: Maximum combined chunk length (defaults to config.CHUNK_SIZE)

    Returns:
        List of combined chunks
    """
    if max_length is None:
        max_length = config.CHUNK_SIZE

    combined: list[str] = []
    current: str = ""

    for chunk in chunks:
        separator = "\n\n" if current else ""
        if len(current) + len(separator) + len(chunk) <= max_length:
            current += separator + chunk
        else:
            if current:
                combined.append(current)
            current = chunk

    if current:
        combined.append(current)

    return combined
