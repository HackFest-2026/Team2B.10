import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import metrics as m  # noqa: E402


class TextTests(unittest.TestCase):
    def test_char_accuracy(self):
        self.assertEqual(m.char_accuracy("Hello  World", "hello world"), 1.0)
        self.assertAlmostEqual(m.char_accuracy("abcd", "abxd"), 0.75)
        self.assertEqual(m.char_accuracy("abc", ""), 0.0)
        self.assertEqual(m.char_accuracy("ab", "zzzzzzzz"), 0.0)  # floored, never negative


class SetTests(unittest.TestCase):
    def test_prf(self):
        r = m.prf(8, 2, 2)
        self.assertEqual((r["precision"], r["recall"]), (0.8, 0.8))
        self.assertEqual(m.prf(0, 0, 0)["f1"], 1.0, "nothing to find and nothing reported is a perfect score")
        self.assertEqual(m.prf(0, 3, 0)["precision"], 0.0)

    def test_pairwise(self):
        items = [("a", "x"), ("a", "x"), ("b", "y"), ("b", "x"), (None, "x")]
        r = m.pairwise_prf(items)
        self.assertEqual((r["tp"], r["fp"], r["fn"]), (1, 2, 1))


class FactTests(unittest.TestCase):
    def test_field_classes(self):
        self.assertEqual(m.field_class("outage start time"), "start")
        self.assertEqual(m.field_class("Outage End Time"), "end")
        self.assertEqual(m.field_class("outage duration"), "duration")
        self.assertEqual(m.field_class("sessions affected"), "sessions")
        self.assertEqual(m.field_class("person responsible"), "person")
        self.assertIsNone(m.field_class("cause"))

    def test_normalising_and_tolerance(self):
        self.assertEqual(m.norm_value("start", "2:14 UTC"), "02:14")
        self.assertEqual(m.norm_value("sessions", "12,400"), "12400")
        self.assertTrue(m.same_value("start", "02:14", "02:15"))
        self.assertFalse(m.same_value("start", "02:14", "02:31"))

    def test_score_facts_ignores_unmapped_predictions(self):
        truth = [{"doc": "r", "class": "start", "value": "02:14"}, {"doc": "r", "class": "sessions", "value": "12400"}, {"doc": "c", "class": "person", "value": "p1"}]
        pred = [{"doc": "r", "class": "start", "value": "02:14"}, {"doc": "r", "class": "sessions", "value": "9800"}, {"doc": "c", "class": "person", "value": "Dr. P. Raman"}]
        r = m.score_facts(truth, pred, lambda v: "p1" if "Raman" in v else v)
        self.assertEqual((r["tp"], r["fp"], r["fn"]), (2, 1, 1))


class GroundingTests(unittest.TestCase):
    def test_tokens_skip_dates_and_identifiers(self):
        t = m.value_tokens("On 2024-03-14 atlas-db-02 INC-4374 failed at 2:14 UTC; 12,400 sessions over 47 minutes")
        self.assertEqual(t, {"02:14", "12400", "47"})

    def test_ungrounded(self):
        self.assertEqual(m.ungrounded_tokens("began at 02:14 and hit 9,800 sessions", ["The outage began at 02:14 UTC."]), {"9800"})
        self.assertEqual(m.ungrounded_tokens("began at 02:14", ["began at 02:14:33 UTC"]), set())


class ConflictTests(unittest.TestCase):
    def test_pair_matching(self):
        truth = [{"class": "start", "values": ["02:14", "02:31"]}, {"class": "sessions", "values": ["12400", "9800"]}]
        pred = [{"class": "start", "values": ["02:31", "02:14"]}, {"class": "end", "values": ["02:49", "03:18"]}]
        r = m.score_conflicts(truth, pred)
        self.assertEqual((r["tp"], r["fp"], r["fn"]), (1, 1, 1))


class ParseTests(unittest.TestCase):
    def test_log_parse_score(self):
        events = [
            {"line": 1, "ts": "2024-03-14T02:31:07+00:00", "host": "h1", "level": "ERROR", "kind": "failure"},
            {"line": 2, "ts": None, "host": None, "level": None, "kind": "raw"},
            {"line": 3, "ts": "02:49:44", "host": "h2", "level": None, "kind": "recovery"},
            {"line": 4, "ts": "2024-03-14T02:50:00+00:00", "host": "h3", "level": "INFO", "kind": "noise"},
        ]
        units = [
            {"loc": {"line": 1, "ts": "2024-03-14T02:31:07+00:00"}, "fields": {"host": "h1", "level": "ERROR"}, "parseStatus": "ok"},
            {"loc": {"line": 2}, "fields": {}, "parseStatus": "raw"},
            {"loc": {"line": 3, "ts": "Mar 14 02:49:44"}, "fields": {"host": "h2"}, "parseStatus": "ok"},
            {"loc": {"line": 4, "ts": "2024-03-14T02:50:00+00:00"}, "fields": {"host": "WRONG", "level": "INFO"}, "parseStatus": "ok"},
        ]
        r = m.score_log_parse(units, events)
        self.assertEqual((r["correct"], r["lines"]), (3, 4))


if __name__ == "__main__":
    unittest.main()
