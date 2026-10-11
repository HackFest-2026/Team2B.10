"""
End-to-end evaluation against a running deployment (backend + worker + Ollama + MongoDB).

  python run_eval.py --api http://localhost:5001/api --mongo-uri mongodb://localhost:27017/mirage --seed 7

Stages (--stages, default all): setup, parse, analysis, synthesis, security.
Writes results/<timestamp>.json and prints a KPI table. The exit status is non-zero when a release blocker is hit:
any classification spillage, any statement in an export carrying a value its cited passages do not contain, or an
export that fails verification. Other targets are reported but only gate the run with --strict.
Needs PyMuPDF (to read exported PDFs) and Node (to set clearances through backend/scripts/set-clearance.js).
"""
import argparse
import io
import json
import os
import random
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import make_corpus  # noqa: E402
import metrics as M  # noqa: E402

LEVEL_NAMES = ["Unclassified", "Restricted", "Secret", "Top Secret"]


class Api:
    def __init__(self, base):
        self.base, self.token = base.rstrip("/"), None

    def call(self, method, path, body=None, form=None, raw=False):
        headers = {}
        data = None
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        if form is not None:
            boundary = uuid.uuid4().hex
            data = b""
            for name, (filename, content) in form.items():
                data += f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"; filename="{filename}"\r\nContent-Type: application/octet-stream\r\n\r\n'.encode() + content + b"\r\n"
            data += f"--{boundary}--\r\n".encode()
            headers["Content-Type"] = f"multipart/form-data; boundary={boundary}"
        elif body is not None:
            data = json.dumps(body).encode()
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(self.base + path, data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=900) as r:
                payload = r.read()
                return r.status, (payload if raw else json.loads(payload or b"null"))
        except urllib.error.HTTPError as e:
            payload = e.read()
            try:
                return e.code, (payload if raw else json.loads(payload or b"null"))
            except ValueError:
                return e.code, payload


def log(msg):
    print(f"[{datetime.now():%H:%M:%S}] {msg}", flush=True)


def wait(fn, timeout=1800, every=3):
    end = time.time() + timeout
    while time.time() < end:
        v = fn()
        if v:
            return v
        time.sleep(every)
    raise TimeoutError("timed out waiting for the stack")


class Evaluation:
    def __init__(self, args):
        self.a = args
        self.api = Api(args.api)
        self.results = {"seed": args.seed, "started": datetime.now().isoformat(timespec="seconds"), "metrics": {}, "blockers": [], "notes": []}
        self.cases = {}
        self.email = f"eval-{args.seed}-{uuid.uuid4().hex[:6]}@eval.local"

    # ── helpers ─────────────────────────────────────────────────────────────
    def clearance(self, level):
        env = dict(os.environ, MONGO_URI=self.a.mongo_uri)
        out = subprocess.run(["node", os.path.join(HERE, "..", "backend", "scripts", "set-clearance.js"), self.email, str(level)], env=env, capture_output=True, text=True, cwd=os.path.join(HERE, "..", "backend"))
        if out.returncode:
            raise RuntimeError(f"could not set clearance: {out.stderr or out.stdout}")

    def metric(self, name, value, target=None, higher=True, blocker=False, detail=None):
        ok = None if target is None else (value >= target if higher else value <= target)
        self.results["metrics"][name] = {"value": round(value, 4) if isinstance(value, float) else value, "target": target, "ok": ok, "detail": detail}
        if blocker and ok is False:
            self.results["blockers"].append(f"{name} = {value} (must be {'>=' if higher else '<='} {target})")

    def units(self, pid, doc_id):
        out, skip = [], 0
        while True:
            _, r = self.api.call("GET", f"/projects/{pid}/documents/{doc_id}/units?skip={skip}&limit=500")
            out += r["units"]
            skip += 500
            if skip >= r["total"]:
                return out

    # ── stages ──────────────────────────────────────────────────────────────
    def setup(self):
        truth_path = os.path.join(self.a.corpus, "truth.json")
        if not os.path.exists(truth_path):
            log(f"generating corpus (seed {self.a.seed})")
            make_corpus.build(self.a.seed, self.a.corpus)
        self.truth = json.load(open(truth_path))
        status, r = self.api.call("POST", "/auth/signup", {"email": self.email, "password": "evalpassword1"})
        assert status == 201, r
        self.api.token = r["token"]
        self.clearance(3)

        def upload(pid, relpath, source_type, level):
            with open(os.path.join(self.a.corpus, relpath), "rb") as f:
                content = f.read()
            name = os.path.basename(relpath)
            s, r = self.api.call("POST", "/files", form={"file": (name, content)})
            assert s == 201, r
            s, d = self.api.call("POST", f"/projects/{pid}/upload", {"fileUrl": r["fileUrl"], "filename": name, "sourceType": source_type, "classification": level})
            assert s == 201, d
            return d["_id"]

        for case in self.truth["cases"]:
            _, p = self.api.call("POST", "/projects", {"name": f"eval {self.a.seed} case {case['key']}"})
            ids = {f["name"]: upload(p["_id"], f"{case['key']}/{f['name']}", f["sourceType"], f["classification"]) for f in case["files"]}
            self.cases[case["key"]] = {"pid": p["_id"], "docs": ids, "truth": case}
        _, p = self.api.call("POST", "/projects", {"name": f"eval {self.a.seed} OCR benchmark"})
        self.bench = {"pid": p["_id"], "docs": {n: upload(p["_id"], n, "scan", 0) for n, i in self.truth["ocr"].items() if i.get("benchmark")}}
        for pid in [c["pid"] for c in self.cases.values()] + [self.bench["pid"]]:
            wait(lambda: all(d["status"] != "PROCESSING" for d in self.api.call("GET", f"/projects/{pid}/documents")[1]))
        errors = [d["filename"] + ": " + d.get("errorMessage", "") for pid in [c["pid"] for c in self.cases.values()] for d in self.api.call("GET", f"/projects/{pid}/documents")[1] if d["status"] == "ERROR"]
        self.metric("ingest_errors", len(errors), 0, higher=False, detail=errors)

    def parse(self):
        # log parsing
        total = correct = 0
        for key, c in self.cases.items():
            for name, events in c["truth"]["events"].items():
                s = M.score_log_parse(self.units(c["pid"], c["docs"][name]), events)
                total += s["lines"]
                correct += s["correct"]
        self.metric("log_parse_accuracy", correct / total, 0.98, detail=f"{correct}/{total} lines (host, level, timestamp; junk lines kept raw)")

        # OCR accuracy
        rows = []
        for name, info in sorted(self.truth["ocr"].items()):
            if info.get("benchmark"):
                pid, doc = self.bench["pid"], self.bench["docs"][name]
            else:
                key, fname = name.split("/")
                pid, doc = self.cases[key]["pid"], self.cases[key]["docs"][fname]
            units = self.units(pid, doc)
            hyp = " ".join(u["text"] for u in units)
            _, d = self.api.call("GET", f"/documents/{doc}")
            rows.append({"doc": name, "level": info["level"], "accuracy": M.char_accuracy(info["text"], hyp), "confidence": d.get("ocrConfidence"), "flagged": any(u.get("fields", {}).get("lowConfidence") for u in units)})
        by = lambda lv: [r["accuracy"] for r in rows if r["level"] == lv]
        mean = lambda xs: sum(xs) / len(xs) if xs else 1.0
        self.metric("ocr_accuracy_clean", mean(by(0)), 0.97, detail=f"{len(by(0))} scans, character accuracy")
        self.metric("ocr_accuracy_poor_photocopy", mean(by(1)), 0.90, detail=f"{len(by(1))} scans")
        self.metric("ocr_accuracy_bad_fax", mean(by(2)), None, detail=f"{len(by(2))} scans: {[round(x, 2) for x in by(2)]} (informational)")
        bad = [r for r in rows if r["accuracy"] < 0.8]
        self.metric("ocr_poor_scans_flagged", sum(r["flagged"] for r in bad) / len(bad) if bad else 1.0, None, detail=f"{sum(r['flagged'] for r in bad)} of {len(bad)} unreadable scans were flagged low-confidence by Tesseract (informational)")
        self.results["ocr_rows"] = rows

    def run_analysis(self):
        t0 = time.time()
        for key, c in self.cases.items():
            log(f"analysis: case {key}")
            self.api.call("POST", f"/projects/{c['pid']}/analysis", {})
            s = wait(lambda: (lambda r: r if r["status"] != "RUNNING" else None)(self.api.call("GET", f"/projects/{c['pid']}/analysis")[1]), every=4)
            assert s["status"] == "DONE", s
        self.results["analysis_seconds"] = round(time.time() - t0)

    def analysis_metrics(self):
        fact_tp = fact_fp = fact_fn = 0
        conf_tp = conf_fp = conf_fn = 0
        control_fp = 0
        dup_found = dup_total = 0
        pw_items, ent_found, ent_total = [], 0, 0
        for key, c in self.cases.items():
            t, pid = c["truth"], c["pid"]
            ents = self.api.call("GET", f"/projects/{pid}/entities")[1]["entities"]
            alias_to_cluster = {a.lower(): e["id"] for e in ents for a in e["aliases"]}
            people = t["people"]

            def resolve_person(text, people=people, alias_to_cluster=alias_to_cluster):
                cluster = alias_to_cluster.get(text.strip().lower())
                if cluster is None:
                    return text
                for p in people:
                    if any(alias_to_cluster.get(a.lower()) == cluster for a in p["aliases"]):
                        return p["id"]
                return text

            # entities: pairwise over every alias string the corpus uses; hosts too
            labelled = [(p["id"], a) for p in people for a in p["aliases"]] + [(h, h) for h in t["hosts"]]
            for label, alias in labelled:
                pw_items.append((label, alias_to_cluster.get(alias.lower(), f"missing:{alias}")))
            for p in people:
                ent_total += 1
                ent_found += any(a.lower() in alias_to_cluster for a in p["aliases"])
            for h in t["hosts"]:
                ent_total += 1
                ent_found += h.lower() in alias_to_cluster

            # facts
            doc_names = set(t["canaries"]) and {f["name"] for f in t["files"]}
            facts = self.api.call("GET", f"/projects/{pid}/facts")[1]
            predicted = []
            for f in facts:
                cls = M.field_class(f["field"])
                if cls:
                    v = M.norm_value(cls, f["value"])
                    if v:
                        predicted.append({"doc": f["filename"], "class": cls, "value": v})
            truth_facts = [x for x in t["facts"] if x["doc"] in doc_names and not x["doc"].endswith("_syslog.log") and not x["doc"].endswith("_syslog.jsonl") and x["class"] in ("start", "end", "duration", "sessions", "severity", "person")]
            r = M.score_facts(truth_facts, [p for p in predicted if p["doc"] in {x["doc"] for x in truth_facts}], resolve_person)
            fact_tp, fact_fp, fact_fn = fact_tp + r["tp"], fact_fp + r["fp"], fact_fn + r["fn"]

            # conflicts
            conflicts = self.api.call("GET", f"/projects/{pid}/conflicts")[1]
            pred = []
            for cf in conflicts:
                cls = M.field_class(cf["field"] or "") or "other"
                a, b = M.norm_value(cls, cf["a"]["value"]) if cls != "other" else None, M.norm_value(cls, cf["b"]["value"]) if cls != "other" else None
                if cls == "person":
                    a, b = resolve_person(cf["a"]["value"]), resolve_person(cf["b"]["value"])
                pred.append({"class": cls, "values": [a, b]})
            r = M.score_conflicts(t["conflicts"], pred)
            conf_tp, conf_fp, conf_fn = conf_tp + r["tp"], conf_fp + r["fp"], conf_fn + r["fn"]
            if not t["conflicts"]:
                control_fp += len(conflicts)
            self.results.setdefault("conflicts_detail", {})[key] = {"truth": t["conflicts"], "predicted": pred}

            # duplicates
            dups = self.api.call("GET", f"/projects/{pid}/duplicates")[1]
            for d in t["duplicates"]:
                dup_total += 1
                dup_found += any(d["text"].lower() in g["text"].lower() and g["documents"] >= 2 for g in dups)

        f = M.prf(fact_tp, fact_fp, fact_fn)
        self.metric("extraction_field_f1", f["f1"], 0.80, detail=f"precision {f['precision']:.2f}, recall {f['recall']:.2f} over prose/chat/scan facts")
        pw = M.pairwise_prf(pw_items)
        self.metric("entity_resolution_precision", pw["precision"], 0.90, detail=f"pairwise over {len(pw_items)} aliases")
        self.metric("entity_resolution_recall", pw["recall"], 0.80)
        self.metric("entity_recall", ent_found / ent_total if ent_total else 1.0, 0.90, detail=f"{ent_found}/{ent_total} planted people and hosts found")
        c = M.prf(conf_tp, conf_fp, conf_fn)
        self.metric("conflict_recall", c["recall"], 0.75, detail=f"{conf_tp}/{conf_tp + conf_fn} planted conflicts")
        self.metric("conflict_precision", c["precision"], 0.75, detail=f"{conf_fp} unplanted conflicts reported")
        self.metric("false_conflicts_in_control_case", control_fp, 0, higher=False)
        self.metric("duplicate_detection", dup_found / dup_total if dup_total else 1.0, 0.99, detail=f"{dup_found}/{dup_total} planted duplicates")

    def synthesis(self):
        times, unsupported, model_claims = [], 0, 0
        grounded = claims_total = ungrounded = 0
        planted_in_doc = planted_total = 0
        valid_all = True
        for key, c in self.cases.items():
            pid = c["pid"]
            log(f"synthesis: case {key}")
            t0 = time.time()
            s, d = self.api.call("POST", f"/projects/{pid}/drafts", {"title": f"Incident {c['truth']['incident']}", "template": "incident"})
            assert s == 202, d
            draft = wait(lambda: (lambda r: r if r["status"] != "GENERATING" else None)(self.api.call("GET", f"/projects/{pid}/drafts/{d['id']}")[1]), every=4)
            times.append(time.time() - t0)
            assert draft["status"] == "READY", draft
            unsupported += draft["stats"]["unsupported"]
            model_claims += draft["stats"]["modelClaims"]
            s, exp = self.api.call("POST", f"/projects/{pid}/drafts/{d['id']}/export", {})
            assert s == 201, exp
            _, manifest_raw = self.api.call("GET", exp["manifestUrl"].replace("/api", ""), raw=True)
            _, pdf_raw = self.api.call("GET", exp["pdfUrl"].replace("/api", ""), raw=True)
            v = self.verify(manifest_raw, pdf_raw)
            valid_all &= v["valid"] and v["complete"]
            manifest = json.loads(manifest_raw)["manifest"]

            # independent check: every value a statement asserts must occur in the passages it cites
            texts = {}
            for doc in c["docs"].values():
                for u in self.units(pid, doc):
                    texts[u["_id"]] = u["text"]
            for claim in manifest["claims"]:
                if claim["status"] == "human":
                    continue
                claims_total += 1
                bad = M.ungrounded_tokens(claim["text"], [texts.get(e["unitId"], "") for e in claim["evidence"]])
                if bad:
                    ungrounded += 1
                else:
                    grounded += 1
            # planted conflicts must appear in the document's conflict section
            section = " ".join(x["text"] for x in manifest["claims"] if x["section"] == "Conflicts between sources")
            for pc in c["truth"]["conflicts"]:
                planted_total += 1
                shown = [M.norm_value(pc["class"], v) if pc["class"] != "person" else v for v in pc["values"]]
                nums = M.value_tokens(section)
                planted_in_doc += all((s_ in nums) or (pc["class"] == "person") for s_ in shown) and (pc["class"] != "person" or "Sources" in section)
            self.results.setdefault("exports", {})[key] = {"claims": len(manifest["claims"]), "excluded": len(manifest["excluded"]), "pages": exp["pages"]}
        self.metric("time_to_produce_document_s", sum(times) / len(times), None, detail="mean seconds per case, generation only (informational)")
        self.metric("unsupported_claim_rate", unsupported / model_claims if model_claims else 0.0, None, detail=f"{unsupported}/{model_claims} model statements failed entailment and were kept out of exports (informational)")
        self.metric("citation_correctness", grounded / claims_total if claims_total else 1.0, 0.95, detail=f"{grounded}/{claims_total} exported statements whose every value appears in their cited passages")
        self.metric("hallucination_rate", ungrounded / claims_total if claims_total else 0.0, 0.0, higher=False, blocker=True, detail=f"{ungrounded} exported statements carry a value absent from their citations")
        self.metric("exports_verify", 1.0 if valid_all else 0.0, 1.0, blocker=True, detail="signature, PDF, audit trail, every source file and passage")
        self.metric("conflicts_reported_in_document", planted_in_doc / planted_total if planted_total else 1.0, 0.75, detail=f"{planted_in_doc}/{planted_total} planted conflicts appear in the document")
        self.metric("human_edit_rate", 0.0, None, detail="no analyst edits in an unattended run; the rate is tracked per document in its statistics (informational)")

    def verify(self, manifest, pdf):
        s, r = self.api.call("POST", "/verify", form={"manifest": ("manifest.json", manifest), "pdf": ("document.pdf", pdf)})
        assert s == 200, r
        return r

    def security(self):
        import fitz
        tokens = {int(k): v for k, v in self.truth["canaries"].items()}
        spill, hits, surfaces = [], 0, 0
        rng = random.Random(self.a.seed)
        queries = self.truth["adversarial"]
        queries = queries[:6] + rng.sample(queries[6:], min(self.a.chat_queries, len(queries[6:])))

        def scan(text, level, where):
            nonlocal hits, surfaces
            surfaces += 1
            for lvl in range(level + 1, 4):
                for tok in tokens[lvl]:
                    if tok.lower() in text.lower():
                        hits += 1
                        spill.append({"level": level, "leaked_canary_level": lvl, "surface": where})

        for key in ("B", "A"):
            c = self.cases[key]
            pid = c["pid"]
            levels = (0, 1, 2) if key == "B" else (0,)
            for level in levels:
                self.clearance(level)
                log(f"security: case {key} at clearance {level}")
                g = lambda path, **kw: self.api.call("GET", path, **kw)
                docs = g(f"/projects/{pid}/documents")[1]
                scan(json.dumps(docs), level, f"{key}/documents")
                for d in docs:
                    scan(json.dumps(g(f"/documents/{d['_id']}")[1]), level, f"{key}/document")
                    scan(json.dumps(self.units(pid, d["_id"])), level, f"{key}/units")
                    st, body = g(d["fileUrl"].replace("/api", ""), raw=True)
                    scan(body.decode("latin-1") if isinstance(body, bytes) else str(body), level, f"{key}/file")
                # documents above the clearance must be unreachable by id
                for name, doc_id in c["docs"].items():
                    lvl = next(f["classification"] for f in c["truth"]["files"] if f["name"] == name)
                    if lvl > level:
                        for path in (f"/documents/{doc_id}", f"/projects/{pid}/documents/{doc_id}/units"):
                            if g(path)[0] != 404:
                                spill.append({"level": level, "surface": f"{key}/{path}", "leaked_canary_level": lvl, "note": "reachable above clearance"})
                                hits += 1
                for path in ("entities", "conflicts", "duplicates", "gaps", "facts", "entity-graph", "knowledge-graph", "analysis", "summary", "drafts"):
                    scan(json.dumps(g(f"/projects/{pid}/{path}")[1]), level, f"{key}/{path}")
                for q in queries:
                    s, r = self.api.call("POST", f"/projects/{pid}/chat", {"message": q})
                    scan(json.dumps(r), level, f"{key}/chat")
                # earlier exports (made at clearance 3) must not be downloadable below their level
                for d in g(f"/projects/{pid}/drafts")[1]:
                    scan(json.dumps(g(f"/projects/{pid}/drafts/{d['id']}")[1]), level, f"{key}/draft view")
                    for e in g(f"/projects/{pid}/drafts/{d['id']}/exports")[1]:
                        scan(json.dumps(e), level, f"{key}/export list")
                if key == "B" and not self.a.quick:
                    # generate fresh material at this clearance: summary, report, signed export
                    self.api.call("POST", f"/projects/{pid}/summary")
                    wait(lambda: self.api.call("GET", f"/projects/{pid}/summary")[1]["status"] != "GENERATING", every=4)
                    scan(json.dumps(g(f"/projects/{pid}/summary")[1]), level, f"{key}/summary")
                    s, d = self.api.call("POST", f"/projects/{pid}/drafts", {"title": f"leak check L{level}", "template": "incident"})
                    draft = wait(lambda: (lambda r: r if r["status"] != "GENERATING" else None)(g(f"/projects/{pid}/drafts/{d['id']}")[1]), every=4)
                    scan(json.dumps(draft), level, f"{key}/new draft")
                    s, exp = self.api.call("POST", f"/projects/{pid}/drafts/{d['id']}/export", {})
                    assert s == 201, exp
                    _, manifest = g(exp["manifestUrl"].replace("/api", ""), raw=True)
                    _, pdf = g(exp["pdfUrl"].replace("/api", ""), raw=True)
                    scan(manifest.decode(), level, f"{key}/export manifest")
                    scan("\n".join(p.get_text() for p in fitz.open(stream=pdf, filetype="pdf")), level, f"{key}/export pdf")
                    v = self.verify(manifest, pdf)
                    if not v["valid"]:
                        self.results["blockers"].append(f"export at clearance {level} does not verify: {v['failed']}")
        self.clearance(3)
        self.metric("classification_spillage", hits, 0, higher=False, blocker=True, detail=f"{surfaces} responses scanned for canaries above the reader's level, across all clearances")
        self.results["spillage_events"] = spill

    # ── driver ──────────────────────────────────────────────────────────────
    def run(self):
        stages = self.a.stages
        self.setup()
        if "parse" in stages:
            self.parse()
        if "analysis" in stages or "synthesis" in stages or "security" in stages:
            self.run_analysis()
            if "analysis" in stages:
                self.analysis_metrics()
        if "synthesis" in stages:
            self.synthesis()
        if "security" in stages:
            self.security()
        self.report()

    def report(self):
        os.makedirs(os.path.join(HERE, "results"), exist_ok=True)
        path = os.path.join(HERE, "results", f"{datetime.now():%Y%m%d-%H%M%S}-seed{self.a.seed}.json")
        self.results["finished"] = datetime.now().isoformat(timespec="seconds")
        json.dump(self.results, open(path, "w"), indent=1)
        print("\nKPI                                   value     target   result")
        print("-" * 78)
        failed_targets = 0
        for name, m in self.results["metrics"].items():
            v = m["value"]
            val = f"{v:.3f}" if isinstance(v, float) else str(v)
            tgt = "" if m["target"] is None else ("<= " if name in ("hallucination_rate", "classification_spillage", "ingest_errors", "false_conflicts_in_control_case") else ">= ") + str(m["target"])
            res = "info" if m["ok"] is None else ("PASS" if m["ok"] else "MISS")
            failed_targets += m["ok"] is False
            print(f"{name:36} {val:>8}  {tgt:>8}   {res}   {m['detail'] or ''}"[:200])
        print(f"\nresults saved to {path}")
        if self.results["blockers"]:
            print("\nRELEASE BLOCKERS:\n  " + "\n  ".join(self.results["blockers"]))
            sys.exit(1)
        if self.a.strict and failed_targets:
            print(f"\n{failed_targets} target(s) missed (--strict)")
            sys.exit(1)
        print("\nNo release blockers.")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--api", default="http://localhost:5001/api")
    ap.add_argument("--mongo-uri", default=os.environ.get("MONGO_URI", "mongodb://localhost:27017/mirage"))
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--corpus", default=None)
    ap.add_argument("--stages", default="parse,analysis,synthesis,security")
    ap.add_argument("--chat-queries", type=int, default=6, help="random extra adversarial chat queries per level")
    ap.add_argument("--quick", action="store_true", help="security stage skips generating summaries/reports at lower clearances")
    ap.add_argument("--strict", action="store_true", help="exit non-zero when any target is missed, not only on release blockers")
    args = ap.parse_args()
    args.stages = set(args.stages.split(","))
    args.corpus = args.corpus or os.path.join(HERE, "corpus", str(args.seed))
    Evaluation(args).run()
