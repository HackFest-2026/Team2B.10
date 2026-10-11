import asyncio
import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import main  # noqa: E402


class InsightHardening(unittest.TestCase):
    def test_failed_model_call_returns_none_not_an_empty_insight(self):
        para = {"pageNumber": 2, "text": "Some paragraph."}
        with mock.patch.object(main, "generate_insight_and_highlights", side_effect=RuntimeError("ollama down")):
            result = asyncio.run(main._generate_insight_for_para(para, asyncio.Semaphore(1)))
        self.assertIsNone(result)

    def test_successful_call_keeps_the_insight(self):
        para = {"pageNumber": 1, "text": "Some paragraph."}
        with mock.patch.object(main, "generate_insight_and_highlights", return_value={"insight": "A claim", "highlights": ["x"]}):
            result = asyncio.run(main._generate_insight_for_para(para, asyncio.Semaphore(1)))
        self.assertEqual(result["insightText"], "A claim")
        self.assertEqual(result["rawHighlights"], ["x"])


if __name__ == "__main__":
    unittest.main()
