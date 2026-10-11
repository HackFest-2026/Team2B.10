"""Phase 1 parser tests. Run from worker/:  python -m unittest discover -s tests -v"""
import os
import sys
import tempfile
import unittest

import fitz

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from parsers import IngestError, parse_file, units_from_pages  # noqa: E402
from pdf_processor import extract_page_data  # noqa: E402

SAMPLES = os.path.join(os.path.dirname(__file__), "..", "..", "samples")


def sample(name, source_type):
    return parse_file(os.path.join(SAMPLES, name), source_type, name)


def temp_file(content, suffix, mode="w"):
    f = tempfile.NamedTemporaryFile(mode, suffix=suffix, delete=False)  # tests only; OS cleans temp
    f.write(content)
    f.close()
    return f.name


class ReportTests(unittest.TestCase):
    def test_markdown_sections_and_lines(self):
        r = sample("report_incident.md", "report")
        self.assertEqual(len(r.units), 4)
        first = r.units[0]
        self.assertEqual(first["loc"]["section"], "Incident Report INC-2041 > Summary")
        self.assertIn("02:14 UTC", first["text"])
        self.assertEqual(first["loc"]["line"], 4)
        self.assertEqual(len(first["textSha256"]), 64)

    def test_every_unit_has_location(self):
        for name, kind in [("report_incident.md", "report"), ("chat_oncall.txt", "chatlog"), ("syslog_atlas.log", "syslog")]:
            for u in sample(name, kind).units:
                self.assertTrue(u["loc"], f"{name} unit without location")


class ChatTests(unittest.TestCase):
    def test_text_transcript(self):
        r = sample("chat_oncall.txt", "chatlog")
        self.assertEqual(len(r.units), 5)
        second = r.units[1]
        self.assertEqual(second["loc"]["speaker"], "Marco Silva")
        self.assertEqual(second["loc"]["turn"], 2)
        self.assertEqual((second["loc"]["line"], second["loc"]["lineEnd"]), (2, 3))  # wrapped line joined
        self.assertIn("connection resets", second["text"])
        self.assertEqual(second["loc"]["ts"], "2024-03-14T02:21:40+00:00")

    def test_json_and_csv(self):
        j = sample("chat_export.json", "chatlog")
        self.assertEqual([u["loc"]["speaker"] for u in j.units], ["Aisha Khan", "Marco Silva", "Aisha Khan"])
        self.assertEqual(j.units[1]["loc"]["turn"], 2)
        c = sample("chat_slack.csv", "chatlog")
        self.assertEqual(len(c.units), 2)
        self.assertEqual(c.units[0]["loc"]["line"], 2)  # header is line 1
        self.assertIn("02:31 to 03:18", c.units[1]["text"])

    def test_not_a_conversation_is_rejected(self):
        path = temp_file("just some words without any speaker markers\nand more\n", ".txt")
        with self.assertRaises(IngestError):
            parse_file(path, "chatlog", "x.txt")


class SyslogTests(unittest.TestCase):
    def test_rfc5424_rfc3164_and_raw(self):
        r = sample("syslog_atlas.log", "syslog")
        self.assertEqual(len(r.units), 5)
        a, b, c, d, e = r.units
        self.assertEqual(a["fields"]["host"], "atlas-db-02")
        self.assertEqual(a["fields"]["level"], "ERROR")  # <11> -> severity 3
        self.assertEqual(a["loc"]["ts"], "2024-03-14T02:31:07+00:00")
        self.assertEqual(c["fields"]["service"], "systemd")
        self.assertEqual(c["loc"]["line"], 3)
        self.assertEqual(e["parseStatus"], "raw")  # never silently dropped
        self.assertTrue(r.warnings and "1 of 5" in r.warnings[0])

    def test_iso_kv_access_and_stacktrace(self):
        r = sample("app_events.log", "syslog")
        self.assertEqual(len(r.units), 4)
        err = r.units[0]
        self.assertEqual(err["fields"]["service"], "payments")
        self.assertEqual((err["loc"]["line"], err["loc"]["lineEnd"]), (1, 4))  # stack trace folded in
        self.assertIn("SocketTimeoutException", err["text"])
        kv = r.units[2]
        self.assertEqual(kv["loc"]["eventId"], "EV-9001")
        self.assertEqual(kv["fields"]["host"], "atlas-gw-01")
        access = r.units[3]
        self.assertEqual(access["fields"]["level"], "ERROR")  # 503
        self.assertEqual(access["loc"]["ts"], "2024-03-14T02:31:44+00:00")

    def test_jsonl_event_ids_and_epoch(self):
        r = sample("events.jsonl", "syslog")
        self.assertEqual([u["loc"]["eventId"] for u in r.units], ["EV-8800", "EV-8841", "L3"])
        self.assertEqual(r.units[0]["fields"]["level"], "CRIT")
        self.assertEqual(r.units[1]["fields"]["extra"], {"replica_of": "atlas-db-02"})
        self.assertEqual(r.units[2]["loc"]["ts"], "2024-03-14T02:50:00+00:00")

    def test_bad_inputs_raise_visible_errors(self):
        with self.assertRaises(IngestError):
            parse_file(temp_file("", ".log"), "syslog", "empty.log")
        with self.assertRaises(IngestError):
            parse_file(temp_file(b"\x00\x01\x02binary", ".log", "wb"), "syslog", "bin.log")
        with self.assertRaises(IngestError):
            parse_file(temp_file("[1, 2", ".json"), "syslog", "bad.json")
        with self.assertRaises(IngestError):
            parse_file(temp_file("a,b\n1,2\n", ".csv"), "syslog", "nomsg.csv")
        with self.assertRaises(IngestError):
            parse_file(temp_file("x", ".csv"), "report", "wrongtype.csv")


class ScanTests(unittest.TestCase):
    def make_scan(self, text):
        """Image-only PDF (no text layer) so the OCR path is exercised."""
        src = fitz.open()
        page = src.new_page()
        page.insert_text((72, 100), text, fontsize=18)
        pix = page.get_pixmap(dpi=200)
        scan = fitz.open()
        sp = scan.new_page(width=page.rect.width, height=page.rect.height)
        sp.insert_image(sp.rect, pixmap=pix)
        path = tempfile.NamedTemporaryFile(suffix=".pdf", delete=False).name
        scan.save(path)
        return path

    def test_ocr_units_have_page_bbox_and_confidence(self):
        path = self.make_scan("Incident report atlas-db-02 outage began at 02:14 UTC")
        pages = extract_page_data(path)
        r = units_from_pages(pages)
        self.assertGreaterEqual(len(r.units), 1)
        joined = " ".join(u["text"] for u in r.units).lower()
        self.assertIn("atlas", joined)
        self.assertIn("outage", joined)
        u = r.units[0]
        self.assertEqual(u["loc"]["page"], 1)
        self.assertEqual(len(u["loc"]["bbox"]), 4)
        self.assertIsNotNone(u["confidence"])
        self.assertGreater(r.ocr_confidence, 60)

    def test_text_layer_pdf_has_no_ocr_confidence(self):
        doc = fitz.open()
        doc.new_page().insert_text((72, 100), "Native text layer paragraph about the failover procedure.")
        path = tempfile.NamedTemporaryFile(suffix=".pdf", delete=False).name
        doc.save(path)
        r = units_from_pages(extract_page_data(path))
        self.assertIsNone(r.ocr_confidence)
        self.assertIn("failover", r.units[0]["text"])

    def test_blank_page_is_reported(self):
        doc = fitz.open()
        doc.new_page()
        path = tempfile.NamedTemporaryFile(suffix=".pdf", delete=False).name
        doc.save(path)
        r = units_from_pages(extract_page_data(path))
        self.assertEqual(r.units, [])
        self.assertTrue(any("page" in w for w in r.warnings))


if __name__ == "__main__":
    unittest.main()


class UnreliableScanTests(unittest.TestCase):
    """A badly degraded scan must be flagged even when Tesseract reports high confidence."""

    def render(self, level):
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "eval"))
        import make_corpus
        path = tempfile.NamedTemporaryFile(suffix=".pdf", delete=False).name
        make_corpus.render_scan("Maintenance record 482. Technician Grace Moreau replaced unit vega-db-07 on 2024-03-12 at 14:32 UTC after 4 failures.", path, level, 11)
        return units_from_pages(extract_page_data(path))

    def test_clean_scan_is_not_flagged(self):
        r = self.render(0)
        self.assertFalse(any(u["fields"].get("lowConfidence") for u in r.units))
        self.assertTrue(all(u["fields"]["ocrAgreement"] >= 0.9 for u in r.units))

    def test_unreadable_scan_is_flagged_and_explained(self):
        r = self.render(2)
        self.assertTrue(r.units and all(u["fields"].get("lowConfidence") for u in r.units))
        self.assertTrue(any("second resolution" in w for w in r.warnings))


class RealWorldFormatTests(unittest.TestCase):
    def test_hadoop_log_lines(self):
        p = temp_file("081109 203615 148 INFO dfs.DataNode$PacketResponder: PacketResponder 1 for block blk_38 terminating\n"
                      "081109 203807 222 WARN dfs.FSNamesystem: BLOCK* ask 10.251.73.220:50010 to delete blk_71\n", ".log")
        r = parse_file(p, "syslog", "hdfs.log")
        self.assertEqual([u["parseStatus"] for u in r.units], ["ok", "ok"])
        self.assertEqual(r.units[0]["fields"]["timestamp"], "2008-11-09T20:36:15+00:00")
        self.assertEqual(r.units[1]["fields"]["level"], "WARN")
        self.assertEqual(r.units[0]["fields"]["service"], "dfs.DataNode$PacketResponder")

    def test_api_response_with_nested_records(self):
        body = ('{"totalResults":2,"vulnerabilities":[{"cve":{"id":"CVE-2024-0001","published":"2024-01-02T03:04:05.000",'
                '"descriptions":[{"lang":"en","value":"Buffer overflow in sshd allows remote attackers to crash the daemon."}],'
                '"metrics":{"x":{"id":"not-the-event-id"}}}},{"cve":{"id":"CVE-2024-0002","published":"2024-02-03T00:00:00.000",'
                '"descriptions":[{"lang":"en","value":"Second issue."}]}}]}')
        r = parse_file(temp_file(body, ".json"), "syslog", "nvd.json")
        self.assertEqual(len(r.units), 2)
        first = r.units[0]
        self.assertIn("Buffer overflow in sshd", first["text"])
        self.assertEqual(first["loc"]["eventId"], "CVE-2024-0001")
        self.assertTrue(first["fields"]["timestamp"].startswith("2024-01-02T03:04:05"))
        self.assertEqual(first["loc"]["line"], 1)
        self.assertEqual(r.units[1]["loc"]["line"], 2)

    def test_geojson_feed_uses_properties(self):
        body = ('{"type":"FeatureCollection","features":[{"type":"Feature","id":"us1","properties":{"mag":6.0,'
                '"place":"7 km N of La Tronosa, Panama","time":1791605641786,"title":"M 6.0 - 7 km N of La Tronosa, Panama"}}]}')
        r = parse_file(temp_file(body, ".json"), "syslog", "quakes.json")
        self.assertEqual(len(r.units), 1)
        self.assertIn("La Tronosa", r.units[0]["text"])
        self.assertTrue(r.units[0]["fields"]["timestamp"].startswith("2026"))

    def test_json_lines_still_one_event_per_line(self):
        r = parse_file(temp_file('{"ts":"2024-03-14T02:14:00Z","msg":"a"}\n{"ts":"2024-03-14T02:15:00Z","msg":"b"}\n', ".jsonl"), "syslog", "e.jsonl")
        self.assertEqual(len(r.units), 2)
        self.assertEqual([u["fields"]["message"] for u in r.units], ["a", "b"])

    def test_flat_array_records_keep_old_behaviour(self):
        r = parse_file(temp_file('[{"timestamp":"2024-03-14T02:14:00Z","level":"error","message":"disk failed","host":"db1"}]', ".json"), "syslog", "a.json")
        self.assertEqual(r.units[0]["fields"]["host"], "db1")
        self.assertEqual(r.units[0]["fields"]["level"], "ERROR")
