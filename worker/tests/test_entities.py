import json
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from entities import extract_mentions, llm_mentions, pattern_mentions  # noqa: E402


def kinds(mentions):
    return {(m["text"], m["type"]) for m in mentions}


class PatternTests(unittest.TestCase):
    def test_hosts_ips_ids_emails(self):
        text = "atlas-db-02 failed; event EV-9001 from 10.0.4.17 reported to ops@corp.example.com, see build.corp.internal"
        got = kinds(pattern_mentions(text))
        self.assertIn(("atlas-db-02", "HOST"), got)
        self.assertIn(("EV-9001", "ID"), got)
        self.assertIn(("10.0.4.17", "IP"), got)
        self.assertIn(("ops@corp.example.com", "EMAIL"), got)
        self.assertIn(("build.corp.internal", "HOST"), got)

    def test_ordinary_hyphenated_words_are_not_hosts(self):
        got = kinds(pattern_mentions("The file system was read-only and the fail-over was on-prem."))
        self.assertEqual(got, set())

    def test_structured_fields_are_authoritative(self):
        got = kinds(pattern_mentions("payments timeout", {"host": "atlas-gw-01", "service": "payments"}, "syslog"))
        self.assertIn(("atlas-gw-01", "HOST"), got)
        self.assertIn(("payments", "SYSTEM"), got)
        self.assertIn(("Marco Silva", "PERSON"), kinds(pattern_mentions("ok", {"speaker": "Marco Silva"}, "chatlog")))


class LlmTests(unittest.TestCase):
    def test_invented_or_paraphrased_mentions_are_discarded(self):
        texts = ["Priya Raman restored service by failing over to atlas-db-03."]

        def fake_chat(system, prompt, json_mode=False):
            return json.dumps({"results": [{"i": 1, "entities": [
                {"text": "Priya Raman", "type": "PERSON"},
                {"text": "Dr. Raman", "type": "PERSON"},          # not in the text -> dropped
                {"text": "atlas-db-03", "type": "SYSTEM"},
                {"text": "Priya", "type": "ROBOT"},               # unknown type -> dropped
            ]}]})

        got = kinds(llm_mentions(texts, fake_chat)[0])
        self.assertEqual(got, {("Priya Raman", "PERSON"), ("atlas-db-03", "SYSTEM")})

    def test_codes_the_model_calls_systems_are_identifiers(self):
        text = "Ticket INC-4374 and reference code CANARY-L2-0a097c97 concern atlas-db-02 and Tomasz Novak."

        def fake_chat(system, prompt, json_mode=False):
            return json.dumps({"results": [{"i": 1, "entities": [
                {"text": "INC-4374", "type": "SYSTEM"}, {"text": "CANARY-L2-0a097c97", "type": "ORG"},
                {"text": "atlas-db-02", "type": "SYSTEM"}, {"text": "Tomasz Novak", "type": "PERSON"}]}]})

        got = kinds(llm_mentions([text], fake_chat)[0])
        self.assertEqual(got, {("INC-4374", "ID"), ("CANARY-L2-0a097c97", "ID"), ("atlas-db-02", "SYSTEM"), ("Tomasz Novak", "PERSON")})

    def test_model_failure_degrades_to_patterns(self):
        def broken(*a, **k):
            raise RuntimeError("ollama down")
        units = [{"text": "Marco Silva paged atlas-db-02", "sourceType": "report"}]
        got = kinds(extract_mentions(units, broken)[0])
        self.assertEqual(got, {("atlas-db-02", "HOST")})

    def test_syslog_units_skip_the_llm(self):
        calls = []
        def chat(*a, **k):
            calls.append(1)
            return '{"results":[]}'
        extract_mentions([{"text": "boot ok", "sourceType": "syslog", "fields": {"host": "h-1"}}], chat)
        self.assertEqual(calls, [])

    def test_dedup_within_unit_and_bad_indexes(self):
        def chat(*a, **k):
            return json.dumps({"results": [{"i": 9, "entities": [{"text": "x", "type": "PERSON"}]}, {"i": 1, "entities": [
                {"text": "Aisha Khan", "type": "PERSON"}, {"text": "Aisha Khan", "type": "PERSON"}]}]})
        got = extract_mentions([{"text": "Aisha Khan asked", "sourceType": "chatlog", "fields": {"speaker": "Aisha Khan"}}], chat)[0]
        self.assertEqual(len([m for m in got if m["text"] == "Aisha Khan"]), 1)


if __name__ == "__main__":
    unittest.main()
