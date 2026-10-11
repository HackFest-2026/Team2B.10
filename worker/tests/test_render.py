import os
import sys
import tempfile
import unicodedata
import unittest

import fitz

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from render import render_pdf  # noqa: E402

SPEC = {
    "title": "Incident INC-2041 <report> & more",
    "generatedAt": "2026-10-08 10:00 UTC",
    "classificationName": "Secret",
    "exportId": "exp-123",
    "keyId": "abcd1234abcd1234",
    "summary": {"supported": 2, "conflicted": 1, "human": 1, "excluded": 3, "redacted": 2, "unsupportedIncluded": 0},
    "sections": [
        {"heading": "Summary", "items": [
            {"text": "The outage began at 02:14 UTC.", "status": "supported", "cites": [1]},
            {"text": "Sessions affected: 12,400 vs 9,800.", "status": "conflicted", "cites": [2, 3]},
            {"text": "Follow up with the vendor.", "status": "human", "cites": []},
            {"redacted": True, "count": 2},
        ]},
        {"heading": "Impact", "items": []},
    ],
    "sources": [
        {"n": 1, "filename": "report.md", "location": "line 4", "classificationName": "Unclassified", "quote": "outage began at 02:14 UTC", "sha256": "0123456789abcdef…"},
        {"n": 2, "filename": "report.md", "location": "line 7", "classificationName": "Unclassified", "quote": "Roughly 12,400 sessions", "sha256": "0123456789abcdef…"},
        {"n": 3, "filename": "chat.json", "location": "turn 2", "classificationName": "Restricted", "quote": "Around 9,800 sessions", "sha256": "fedcba9876543210…"},
    ],
}


class RenderTests(unittest.TestCase):
    def test_pdf_has_content_banners_and_markup_is_escaped(self):
        path = os.path.join(tempfile.mkdtemp(), "out.pdf")
        pages = render_pdf(SPEC, path)
        doc = fitz.open(path)
        self.assertEqual(len(doc), pages)
        text = unicodedata.normalize("NFKC", "\n".join(page.get_text() for page in doc))  # fonts substitute ligatures such as "ﬁ"
        for needle in ["Incident INC-2041 <report> & more", "The outage began at 02:14 UTC.", "SOURCES CONFLICT", "ANALYST NOTE",
                       "REDACTED: 2 statement", "No verifiable statements", "report.md", "chat.json", "exp-123", "abcd1234abcd1234"]:
            self.assertIn(needle, text)
        first = doc[0].get_text()
        self.assertEqual(first.count("SECRET"), 2, "banner at the top and bottom of the page")
        self.assertIn("page 1 of", first)

    def test_banners_and_footer_are_upright_and_in_place(self):
        # Checked on rendered pixels, because text extraction reports the right words even when the page is drawn flipped.
        path = os.path.join(tempfile.mkdtemp(), "orient.pdf")
        render_pdf(SPEC, path)
        page = fitz.open(path)[0]
        pix = page.get_pixmap(dpi=72)
        h, w = pix.height, pix.width

        def ink(y0, y1, red=False):
            count = 0
            for y in range(max(0, y0), min(h, y1)):
                for x in range(0, w, 2):
                    r, g, b = pix.pixel(x, y)[:3]
                    if red and r > 120 and g < 90 and b < 90:
                        count += 1
                    elif not red and r < 200 and g < 200 and b < 200:
                        count += 1
            return count

        self.assertGreater(ink(20, 44, red=True), 20, "classification banner at the top")
        self.assertGreater(ink(h - 48, h - 22, red=True), 20, "classification banner at the bottom")
        self.assertGreater(ink(h - 22, h - 4), 10, "page footer at the bottom")
        self.assertEqual(ink(0, 18), 0, "nothing at the very top: the footer must not be drawn there")
        # the footer is the lowest text on the page and reads left-to-right, upright
        footer = [b for b in page.get_text("blocks") if "page 1 of" in b[4]]
        self.assertTrue(footer and footer[0][1] > h - 30)

    def test_long_documents_paginate(self):
        spec = dict(SPEC, sections=[{"heading": "Facts", "items": [{"text": f"Statement number {i} " + "word " * 30, "status": "supported", "cites": [1]} for i in range(120)]}])
        path = os.path.join(tempfile.mkdtemp(), "long.pdf")
        self.assertGreater(render_pdf(spec, path), 2)


if __name__ == "__main__":
    unittest.main()
