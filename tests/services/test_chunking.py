"""Tests for message chunking."""

from whatsapp_gateway.services.chunking import chunk_message, combine_chunks


class TestChunkMessage:
    """Tests for the chunk_message function."""

    def test_short_message_no_chunking(self) -> None:
        """Short messages should not be chunked."""
        text = "Hello, world!"
        chunks = chunk_message(text, max_length=1500)
        assert chunks == [text]

    def test_message_at_limit(self) -> None:
        """Message exactly at limit should not be chunked."""
        text = "a" * 1500
        chunks = chunk_message(text, max_length=1500)
        assert chunks == [text]

    def test_long_message_chunked(self) -> None:
        """Long message should be split into chunks."""
        text = "This is sentence one. This is sentence two. This is sentence three."
        chunks = chunk_message(text, max_length=30)
        assert len(chunks) > 1
        assert all(len(c) <= 30 for c in chunks)

    def test_sentence_boundary_splitting(self) -> None:
        """Chunks should prefer sentence boundaries."""
        text = "First sentence. Second sentence. Third sentence."
        chunks = chunk_message(text, max_length=40)
        # Each chunk should be a complete sentence or group of sentences
        assert len(chunks) >= 1
        for chunk in chunks:
            assert len(chunk) <= 40

    def test_force_split_no_spaces(self) -> None:
        """Very long words should be force-split."""
        text = "a" * 100
        chunks = chunk_message(text, max_length=30)
        assert len(chunks) > 1
        assert all(len(c) <= 30 for c in chunks)

    def test_empty_message(self) -> None:
        """Empty message should return empty list or single empty string."""
        chunks = chunk_message("", max_length=1500)
        assert chunks == [""]


class TestCombineChunks:
    """Tests for the combine_chunks function."""

    def test_combine_small_chunks(self) -> None:
        """Small chunks should be combined."""
        chunks = ["Hello", "World", "!"]
        combined = combine_chunks(chunks, max_length=20)
        assert len(combined) < len(chunks)

    def test_respect_max_length(self) -> None:
        """Combined chunks should respect max_length."""
        chunks = ["Hello there", "How are you", "I am fine"]
        combined = combine_chunks(chunks, max_length=25)
        assert all(len(c) <= 25 for c in combined)

    def test_no_combine_if_too_large(self) -> None:
        """Chunks that exceed limit together should not be combined."""
        chunks = ["Hello there friend", "How are you doing today"]
        combined = combine_chunks(chunks, max_length=20)
        assert len(combined) == 2

    def test_empty_chunks(self) -> None:
        """Empty chunk list should return empty list."""
        assert combine_chunks([], max_length=1500) == []
