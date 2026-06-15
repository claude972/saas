"""Chromium-based PDF renderer for BTP OpenClaw Cockpit.

Converts a full HTML string to PDF bytes using Playwright's headless Chromium.

All Playwright imports are **deferred** inside the function bodies and wrapped
in ``try/except`` so that:

* The API starts normally even if Playwright / Chromium is not installed.
* ``pdf_render_available()`` lets callers decide at runtime whether to use
  this renderer or fall back to the reportlab-based exporter.

Public API
----------
::

    available: bool = pdf_render_available()
    pdf_bytes: bytes = await render_pdf_from_html(html_str)

The ``render_pdf_from_html`` coroutine is safe to call concurrently: each
invocation opens and closes its own isolated browser context.
"""

from __future__ import annotations

import logging

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Availability check
# ---------------------------------------------------------------------------


def pdf_render_available() -> bool:
    """Return True when Playwright is importable (Chromium may still be absent).

    A lazy ``import playwright`` is attempted inside this function; it never
    raises — it returns ``False`` on any error.  The actual Chromium binary
    check is deferred to ``render_pdf_from_html`` itself.
    """
    try:
        import importlib

        importlib.import_module("playwright.async_api")
        return True
    except Exception:  # noqa: BLE001
        return False


# ---------------------------------------------------------------------------
# PDF rendering
# ---------------------------------------------------------------------------


async def render_pdf_from_html(html: str) -> bytes:
    """Render *html* to PDF bytes via a headless Chromium instance.

    Launches a fresh Chromium browser for each call so that multiple
    concurrent requests do not share browser state.  The browser is always
    closed in a ``finally`` block to avoid leaking resources even on error.

    Args:
        html: Complete HTML document string (``<!DOCTYPE html>…</html>``).

    Returns:
        Raw PDF bytes (``application/pdf``), suitable for a FastAPI
        ``StreamingResponse`` or direct ``bytes`` return.

    Raises:
        RuntimeError: if Playwright or Chromium cannot be launched.
        Any exception raised by Playwright is propagated to the caller so
        that the route can catch it and fall back to the reportlab renderer.

    Notes:
        * ``--no-sandbox`` and ``--disable-dev-shm-usage`` are mandatory when
          running as root inside a Docker container (Railway / OVH VPS).
        * ``print_background=True`` preserves the dark header, red accents,
          and colour fills defined in the HTML ``<style>`` block.
        * ``prefer_css_page_size=True`` honours ``@page { size: A4; }`` if
          declared in the stylesheet, falling back to ``format="A4"``.
    """
    try:
        from playwright.async_api import async_playwright
    except ImportError as exc:
        raise RuntimeError(
            "playwright n'est pas installé (pip install playwright && "
            "playwright install chromium)."
        ) from exc

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-dev-shm-usage"],
        )
        try:
            page = await browser.new_page()
            await page.set_content(html, wait_until="networkidle")
            pdf_bytes = await page.pdf(
                format="A4",
                print_background=True,
                prefer_css_page_size=True,
            )
            return pdf_bytes
        finally:
            await browser.close()
