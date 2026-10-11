import json
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from facts import extract_facts, label_events, uncovered, value_tokens, verify_fact  # noqa: E402

TEXT = "The outage began at 02:14 UTC and lasted 47 minutes. Roughly 12,400 sessions were interrupted."


def good(**over):
    base = {"subject": "Outage", "field": "Outage Start Time", "value": "02:14 UTC", "type": "time", "quote": "The outage began at 02:14 UTC"}
    base.update(over)
    return base


class VerifyTests(unittest.TestCase):
    def test_grounded_fact_is_normalised(self):
        f = verify_fact(good(), TEXT)
        self.assertEqual((f["field"], f["subject"]), ("outage start time", "outage"))

    def test_ungrounded_facts_are_dropped(self):
        for bad in [good(value="02:31 UTC"), good(quote="The outage began at 02:31 UTC"), good(type="vibes"),
                    good(field=""), {"field": "x"}, good(value="UTC", quote="lasted 47 minutes")]:
            self.assertIsNone(verify_fact(bad, TEXT), bad)


class OwnershipTests(unittest.TestCase):
    def fact(self, quote, value):
        return {"subject": "incident", "field": "person responsible", "value": value, "type": "text", "quote": quote}

    def test_ownership_needs_ownership_words_in_the_quote(self):
        ok = [("Aisha Petrov: I own this incident", "Aisha Petrov", "Aisha Petrov: I own this incident and will write the review."),
              ("on-call engineer Rahul Tanaka restored service", "Rahul Tanaka", "The on-call engineer Rahul Tanaka restored service."),
              ("Responsible: Rahul Tanaka", "Rahul Tanaka", "Handover note. Responsible: Rahul Tanaka.")]
        for quote, value, text in ok:
            self.assertIsNotNone(verify_fact(self.fact(quote, value), text), quote)
        text = "T. Novak: Paging the team, helix-gw-06 is not responding to health checks."
        self.assertIsNone(verify_fact(self.fact("T. Novak: Paging the team", "T. Novak"), text), "speaking is not owning")

    def test_other_fields_are_unaffected(self):
        f = {"subject": "x", "field": "outage start time", "value": "02:14 UTC", "type": "time", "quote": "began at 02:14 UTC"}
        self.assertIsNotNone(verify_fact(f, "The outage began at 02:14 UTC."))


class ExtractTests(unittest.TestCase):
    def test_vocabulary_is_passed_in_and_grows(self):
        seen = []

        def chat(system, prompt, json_mode=False):
            seen.append(prompt)
            return json.dumps({"results": [{"i": 1, "facts": [
                good(),
                {"subject": "outage", "field": "outage duration", "value": "47 minutes", "type": "duration", "quote": "lasted 47 minutes"},
                {"subject": "x", "field": "invented", "value": "99", "type": "number", "quote": "99 problems"},
            ]}, {"i": 7, "facts": [good()]}]})

        facts, vocab, _ = extract_facts([TEXT], ["sessions affected"], chat)
        self.assertIn("sessions affected", seen[0])
        self.assertEqual([f["field"] for f in facts[0]], ["outage start time", "outage duration"])
        self.assertEqual(vocab, ["sessions affected", "outage start time", "outage duration"])

    def test_model_failure_gives_no_facts(self):
        def broken(*a, **k):
            raise RuntimeError("down")
        facts, _, gaps = extract_facts([TEXT, TEXT], [], broken)
        self.assertEqual(facts, [[], []])
        self.assertTrue(all(g for g in gaps), 'a model failure leaves visible gaps, not silence')

    def test_vocabulary_carries_across_batches(self):
        prompts = []

        def chat(system, prompt, json_mode=False):
            prompts.append(prompt)
            return json.dumps({"results": [{"i": 1, "facts": [good()]}]})

        extract_facts([TEXT] * 6, [], chat)  # 2 batches of 5 + 1
        self.assertIn("(none yet)", prompts[0])
        self.assertIn("outage start time", prompts[1])


class CoverageTests(unittest.TestCase):
    def test_value_tokens(self):
        t = "Began at 02:14 UTC on 2024-03-14 on atlas-db-02 (INC-2041); 12,400 sessions over 47 minutes; build 7 failed."
        self.assertEqual(set(value_tokens(t)), {"02:14 UTC", "2024-03-14", "12,400 sessions", "47 minutes"})

    def test_uncovered_ignores_formatting(self):
        facts = [{"value": "12,400", "field": "sessions affected"}, {"value": "02:14 UTC", "field": "x"}]
        self.assertEqual(uncovered(TEXT, facts), ["47 minutes"])

    def test_second_pass_asks_only_about_skipped_values(self):
        prompts = []

        def chat(system, prompt, json_mode=False):
            prompts.append(prompt)
            if len(prompts) == 1:  # pass 1 misses the sessions count and the duration
                return json.dumps({"results": [{"i": 1, "facts": [good()]}]})
            return json.dumps({"results": [{"i": 1, "facts": [
                {"subject": "sessions", "field": "sessions affected", "value": "12,400", "type": "number", "quote": "Roughly 12,400 sessions"},
                {"subject": "x", "field": "unrelated", "value": "99", "type": "number", "quote": "Roughly 12,400 sessions"},  # not asked about
            ]}]})

        facts, _, gaps = extract_facts([TEXT], [], chat)
        self.assertIn("12,400 sessions", prompts[1])
        self.assertNotIn("02:14", prompts[1].split("VALUES:")[1])
        self.assertEqual({f["field"] for f in facts[0]}, {"outage start time", "sessions affected"})
        self.assertEqual(gaps, [["47 minutes"]], "what the model still skipped is reported")


class MilestoneTests(unittest.TestCase):
    def test_labels_are_restricted_to_the_vocabulary(self):
        events = [{"text": "disk controller reset failed", "host": "atlas-db-02"}, {"text": "cron ran", "host": "atlas-db-02"}, {"text": "x", "host": ""}]

        def chat(system, prompt, json_mode=False):
            self.assertIn("outage start time", prompt)
            return json.dumps({"results": [{"i": 1, "milestone": "Outage Start Time"}, {"i": 2, "milestone": None}, {"i": 3, "milestone": "invented milestone"}, {"i": 9, "milestone": "outage start time"}]})

        self.assertEqual(label_events(events, ["outage start time", "outage end time"], chat), ["outage start time", None, None])

    def test_no_vocabulary_or_failure_means_no_labels(self):
        def broken(*a, **k):
            raise RuntimeError("down")
        self.assertEqual(label_events([{"text": "a"}], [], broken), [None])
        self.assertEqual(label_events([{"text": "a"}], ["m"], broken), [None])


if __name__ == "__main__":
    unittest.main()
