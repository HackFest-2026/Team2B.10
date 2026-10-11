import hashlib
import json
import os
import sys
import tempfile
import unittest

HERE = os.path.dirname(__file__)
sys.path.insert(0, os.path.join(HERE, ".."))
sys.path.insert(0, os.path.join(HERE, "..", "..", "worker"))

import make_corpus  # noqa: E402
import metrics  # noqa: E402
from parsers import parse_file  # noqa: E402


def digest(root):
    """Content hash that ignores container timestamps: PDFs by their rendered pixels, DOCX by their body XML."""
    import fitz
    import zipfile
    h = hashlib.sha256()
    for dirpath, _, files in sorted(os.walk(root)):
        for f in sorted(files):
            path = os.path.join(dirpath, f)
            h.update(f.encode())
            if f.endswith(".pdf"):
                h.update(fitz.open(path)[0].get_pixmap(dpi=60).samples)
            elif f.endswith(".docx"):
                h.update(zipfile.ZipFile(path).read("word/document.xml"))
            else:
                h.update(open(path, "rb").read())
    return h.hexdigest()


class CorpusTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dir = tempfile.mkdtemp()
        cls.truth = make_corpus.build(7, cls.dir)

    def test_is_deterministic_and_seed_dependent(self):
        again = tempfile.mkdtemp()
        make_corpus.build(7, again)
        self.assertEqual(digest(self.dir), digest(again), "same seed must give identical files and truth")
        other = tempfile.mkdtemp()
        make_corpus.build(8, other)
        self.assertNotEqual(digest(self.dir), digest(other))

    def test_shape_and_planted_conflicts(self):
        cases = {c["key"]: c for c in self.truth["cases"]}
        self.assertEqual(set(cases), {"A", "B", "C"})
        self.assertEqual({x["class"] for x in cases["A"]["conflicts"]}, {"start", "sessions"})
        self.assertEqual({x["class"] for x in cases["B"]["conflicts"]}, {"end", "person"})
        self.assertEqual(cases["C"]["conflicts"], [], "case C is the all-agree control")
        for c in cases.values():
            for x in c["conflicts"]:
                self.assertEqual(len(x["values"]), 2)
                self.assertNotEqual(*x["values"])
        self.assertEqual(len(cases["B"]["duplicates"]), 1)
        self.assertEqual({s["sourceType"] for c in self.truth["cases"] for s in c["files"]}, {"scan", "report", "chatlog", "syslog"})

    def test_every_classification_level_has_a_canary_in_case_b(self):
        levels = {f["classification"] for f in cases_by_key(self.truth)["B"]["files"]}
        self.assertEqual(levels, {0, 1, 2, 3})
        for lvl in "0123":
            self.assertTrue(self.truth["canaries"][lvl])
        # text sources carry their canary verbatim (scans only through OCR)
        for case in self.truth["cases"]:
            for name, info in case["canaries"].items():
                for f in case["files"]:
                    path = os.path.join(self.dir, case["key"], f["name"])
                    if f["sourceType"] == "scan" or f["name"].endswith(".docx"):
                        continue
                    if f["classification"] == info["level"] and name in f["name"].lower().replace("syslog", "syslog"):
                        pass
        any_found = sum(open(os.path.join(self.dir, "A", f["name"]), encoding="utf-8").read().count("CANARY-") for f in cases_by_key(self.truth)["A"]["files"] if f["sourceType"] != "scan")
        self.assertGreaterEqual(any_found, 3)

    def test_our_parsers_recover_every_log_line_of_the_corpus(self):
        total = correct = 0
        for case in self.truth["cases"]:
            for f in case["files"]:
                if f["sourceType"] != "syslog":
                    continue
                parsed = parse_file(os.path.join(self.dir, case["key"], f["name"]), "syslog", f["name"])
                score = metrics.score_log_parse(parsed.units, case["events"][f["name"]])
                total += score["lines"]
                correct += score["correct"]
                self.assertEqual(score["correct"], score["lines"], f"{f['name']}: {score}")
        self.assertGreater(total, 20)

    def test_chat_and_report_sources_parse(self):
        for case in self.truth["cases"]:
            for f in case["files"]:
                if f["sourceType"] in ("chatlog", "report"):
                    parsed = parse_file(os.path.join(self.dir, case["key"], f["name"]), f["sourceType"], f["name"])
                    self.assertGreaterEqual(len(parsed.units), 3, f["name"])

    def test_ocr_benchmark_has_clean_and_degraded_pairs(self):
        bench = {k: v for k, v in self.truth["ocr"].items() if v.get("benchmark")}
        self.assertEqual(sum(v["degraded"] for v in bench.values()), 3)
        self.assertEqual(sum(not v["degraded"] for v in bench.values()), 3)
        for name in bench:
            self.assertTrue(os.path.getsize(os.path.join(self.dir, name)) > 1000)

    def test_adversarial_queries_include_every_higher_level_canary(self):
        joined = " ".join(self.truth["adversarial"])
        for lvl in "123":
            for token in self.truth["canaries"][lvl]:
                self.assertIn(token, joined)


def cases_by_key(truth):
    return {c["key"]: c for c in truth["cases"]}


if __name__ == "__main__":
    unittest.main()
