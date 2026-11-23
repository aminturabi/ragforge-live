"""Tests validating Prompt 1 security and input fixes."""

import os
from unittest.mock import MagicMock, patch
import pytest

from api.app_factory import create_app
from core.exceptions import DocumentLoadError
from loaders.web_loader import WebLoader, _is_safe_url
from loaders.youtube_loader import YouTubeTranscriptLoader


@pytest.fixture
def test_client():
    app = create_app()
    app.config["TESTING"] = True
    return app.test_client()


def test_max_content_length_configured():
    app = create_app()
    assert app.config.get("MAX_CONTENT_LENGTH") == 16 * 1024 * 1024


def test_clear_fails_secure_when_admin_key_unset(monkeypatch, test_client):
    monkeypatch.delenv("ADMIN_KEY", raising=False)
    res = test_client.post("/api/clear", json={"collection_name": "col_test"})
    assert res.status_code == 401
    assert "Admin key required" in res.get_json()["error"]


def test_clear_succeeds_when_admin_key_matches(monkeypatch, test_client):
    monkeypatch.setenv("ADMIN_KEY", "super_secret_admin_password")
    
    # Mock clear_collection to return True
    with patch("api.routes._service") as mock_service:
        mock_instance = MagicMock()
        mock_instance.clear_collection.return_value = True
        mock_service.return_value = mock_instance

        res = test_client.post(
            "/api/clear",
            json={"collection_name": "col_test"},
            headers={"X-Admin-Key": "super_secret_admin_password"},
        )
        assert res.status_code == 200
        assert res.get_json()["success"] is True


def test_clear_rejects_invalid_collection_name(monkeypatch, test_client):
    monkeypatch.setenv("ADMIN_KEY", "secret")
    res = test_client.post(
        "/api/clear",
        json={"collection_name": "../../etc/passwd"},
        headers={"X-Admin-Key": "secret"},
    )
    assert res.status_code == 400
    assert "Invalid collection name" in res.get_json()["error"]


def test_query_rejects_invalid_collection_name(test_client):
    res = test_client.post(
        "/api/query",
        json={"query": "hello", "collection_name": "col/../../bad"},
    )
    assert res.status_code == 400
    assert "Invalid collection name" in res.get_json()["error"]


def test_query_clamps_top_k(monkeypatch, test_client):
    monkeypatch.setenv("GROQ_API_KEY", "gsk_dummy_mock_key")
    with patch("api.routes._service") as mock_service:
        mock_instance = MagicMock()
        mock_instance.query.return_value = {"answer": "ok", "context": []}
        mock_service.return_value = mock_instance

        res = test_client.post(
            "/api/query",
            json={"query": "what is this?", "collection_name": "col_valid_123", "top_k": 999999},
        )
        assert res.status_code == 200
        # Verify clamped to 10
        mock_instance.query.assert_called_once()
        _, kwargs = mock_instance.query.call_args
        assert kwargs.get("top_k") == 10


def test_web_loader_blocks_private_and_loopback_ips():
    assert _is_safe_url("http://127.0.0.1:5000") is False
    assert _is_safe_url("http://localhost:8000") is False
    assert _is_safe_url("http://169.254.169.254/latest/meta-data/") is False
    assert _is_safe_url("http://192.168.1.1") is False
    assert _is_safe_url("http://10.0.0.1") is False

    loader = WebLoader()
    with pytest.raises(DocumentLoadError) as exc_info:
        loader.load("http://127.0.0.1:5000/api/config")
    assert "blocked" in str(exc_info.value).lower()


def test_youtube_loader_raises_error_without_fake_hallucination(monkeypatch):
    import loaders.youtube_loader as ytl
    monkeypatch.setattr(ytl, "YOUTUBE_API_AVAILABLE", False)

    loader = YouTubeTranscriptLoader()
    with pytest.raises(DocumentLoadError) as exc_info:
        loader.load("https://www.youtube.com/watch?v=dQw4w9WgXcQ")
    assert "not installed" in str(exc_info.value)

