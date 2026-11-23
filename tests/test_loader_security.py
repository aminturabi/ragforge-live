"""Unit tests for loader security and integrity (SSRF and hallucination prevention)."""

import pytest
from core.exceptions import DocumentLoadError
from loaders.web_loader import WebLoader, _is_safe_url
from loaders.youtube_loader import YouTubeTranscriptLoader


def test_is_safe_url_blocks_internal_and_private_ips():
    assert _is_safe_url("http://127.0.0.1:5000") is False
    assert _is_safe_url("http://localhost:8000") is False
    assert _is_safe_url("http://169.254.169.254/latest/meta-data/") is False
    assert _is_safe_url("http://192.168.1.1/admin") is False
    assert _is_safe_url("http://10.0.0.1") is False
    assert _is_safe_url("ftp://example.com") is False


def test_web_loader_raises_on_unsafe_url():
    loader = WebLoader()
    with pytest.raises(DocumentLoadError) as exc_info:
        loader.load("http://127.0.0.1:5000/api/config")
    assert "blocked" in str(exc_info.value).lower()


def test_youtube_loader_fails_explicitly_when_api_missing(monkeypatch):
    import loaders.youtube_loader as ytl
    monkeypatch.setattr(ytl, "YOUTUBE_API_AVAILABLE", False)

    loader = YouTubeTranscriptLoader()
    with pytest.raises(DocumentLoadError) as exc_info:
        loader.load("https://www.youtube.com/watch?v=dQw4w9WgXcQ")
    assert "not installed" in str(exc_info.value)

