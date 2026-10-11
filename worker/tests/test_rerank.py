import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from rerank import rerank  # noqa: E402


class RerankTests(unittest.TestCase):
    def test_the_passage_that_answers_outranks_one_that_only_repeats_the_words(self):
        query = "What is ELECTRA and how is it trained?"
        passages = [
            "ELECTRA ELECTRA",
            "We propose ELECTRA, a pre-training method in which a discriminator learns to detect tokens replaced by a small generator.",
            "The Eiffel Tower is located in Paris.",
        ]
        scores = rerank(query, passages)
        self.assertEqual(len(scores), 3)
        self.assertTrue(all(0 <= s <= 1 for s in scores))
        self.assertEqual(max(range(3), key=lambda i: scores[i]), 1)
        self.assertLess(scores[2], 0.05, "an unrelated passage scores near zero")

    def test_empty_input(self):
        self.assertEqual(rerank("anything", []), [])


if __name__ == "__main__":
    unittest.main()
