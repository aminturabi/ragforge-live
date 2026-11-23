"""Web page and HTML document loader plugin."""

import ipaddress
import os
import re
import socket
import urllib.parse
import urllib.request

from core.contracts import DocumentLoader
from core.exceptions import DocumentLoadError
from core.registry import register_plugin


def _is_safe_url(url: str) -> bool:
    """Validate that target URL does not resolve to private, loopback, or link-local IPs (SSRF protection)."""
    try:
        parsed = urllib.parse.urlparse(url)
        if parsed.scheme not in ("http", "https"):
            return False
        hostname = parsed.hostname
        if not hostname:
            return False

        addr_infos = socket.getaddrinfo(hostname, None)
        for addr in addr_infos:
            ip_str = addr[4][0]
            ip_obj = ipaddress.ip_address(ip_str)
            if (
                ip_obj.is_private
                or ip_obj.is_loopback
                or ip_obj.is_link_local
                or ip_obj.is_reserved
                or ip_obj.is_multicast
            ):
                return False
        return True
    except Exception:
        return False


@register_plugin("loaders", "web")
class WebLoader(DocumentLoader):
    """Loads web pages via HTTP request or parses local HTML files."""

    def load(self, source: str) -> str:
        try:
            if source.startswith("http://") or source.startswith("https://"):
                if not _is_safe_url(source):
                    raise DocumentLoadError(f"Access to internal or restricted network address is blocked: {source}")
                req = urllib.request.Request(source, headers={"User-Agent": "Mozilla/5.0"})
                with urllib.request.urlopen(req, timeout=10) as response:
                    html_content = response.read().decode("utf-8", errors="ignore")
            elif os.path.exists(source):
                with open(source, "r", encoding="utf-8", errors="ignore") as f:
                    html_content = f.read()
            else:
                raise DocumentLoadError(f"Web source or file not found: {source}")
        except Exception as err:
            if isinstance(err, DocumentLoadError):
                raise
            raise DocumentLoadError(f"Failed to load web source {source}: {err}") from err

        # Strip script and style elements
        clean_html = re.sub(r"<(script|style).*?>.*?</\1>", "", html_content, flags=re.DOTALL | re.IGNORECASE)
        # Strip HTML tags
        text = re.sub(r"<[^>]+>", " ", clean_html)
        # Collapse whitespace
        lines = [line.strip() for line in text.splitlines() if line.strip()]
        return "\n".join(lines)
