# MIRAGE

**Multi-source ingestion into a single verifiable document — fully on-prem.**

Mirage ingests scanned documents, reports, conversation logs and system logs at different classification levels, resolves the people and systems that appear across them, finds where the sources disagree, and writes one cited document in which every statement can be traced to a source passage — and every change to a source, a statement or the audit trail is detectable.

<p>
  <img alt="React" src="https://img.shields.io/badge/Frontend-React%2018-61dafb?style=flat-square&logo=react&logoColor=white" />
  <img alt="Node" src="https://img.shields.io/badge/Backend-Node%20%2B%20Express-339933?style=flat-square&logo=node.js&logoColor=white" />
  <img alt="Python" src="https://img.shields.io/badge/Worker-FastAPI-009688?style=flat-square&logo=fastapi&logoColor=white" />
  <img alt="Ollama" src="https://img.shields.io/badge/LLM-Ollama%20(Qwen3)-black?style=flat-square" />
  <img alt="MongoDB" src="https://img.shields.io/badge/Database-MongoDB-47A248?style=flat-square&logo=mongodb&logoColor=white" />
</p>

| Problem-statement requirement | Where it lives |
|---|---|
| Scans / manuals (OCR), reports, conversation logs, system logs | `worker/parsers/`, [Source types](#source-types) |
| Entity resolution and deduplication | `backend/services/entityResolution.js`, `duplicates.js` |
| Cross-source conflict detection | `backend/services/facts.js`, `worker/facts.py` |
| Synthesis with citations, claim verification (NLI) | `backend/services/draftGenerator.js`, `worker/nli.py` |
| Provenance, hashing, signatures, audit trail | `backend/services/exporter.js`, `signing.js`, `audit.js` |
| Classification enforcement and redaction | `backend/services/retrieval.js`, `draftView.js`, every route |
| Fully on-prem | [Quick start](#quick-start-local) · no hosted endpoints at runtime (tested) |
| KPIs | [Quality gates](#quality-gates), `eval/` |

---

## How it works

```text
React UI ──► Express API ── auth · ownership · clearance · audit hash-chain ──► MongoDB
                │
                ├──► shared storage (originals, annotated PDFs, exports)
                ├──► Python worker: parsers · Tesseract OCR · embeddings · NER · fact reading · NLI · PDF render
                └──► Ollama (qwen3:14b) — the only language model, local
```

1. **Ingest** — every source becomes *evidence units* with a stable location (page/bbox, section/line, turn, event ID), a SHA-256, a classification, and OCR confidence where relevant. Unreadable input becomes a visible error; lines a parser cannot understand are kept as `raw`, never dropped.
2. **Retrieve** — the caller's clearance is part of the database query, so units above it are never loaded, scored, or shown to a model.
3. **Analyse** — mentions → entity resolution (aliases merge, ambiguous names are *proposed* not guessed) → facts (`subject · field · value`, each with a verbatim quote) → conflicts found by comparing values in code → duplicates.
4. **Synthesise** — each statement must cite a supplied unit, quote it verbatim, and be *entailed* by it (local NLI model). Failures are never presented as findings.
5. **Export** — a PDF plus an Ed25519-signed manifest mapping every statement to its sources, with source-file hashes, a Merkle root, and the audit-trail head. Exports are rendered per reader clearance.
6. **Verify** — one call re-checks the signature, the PDF, the audit trail, every source file and every cited passage.

### Source types

| Type | Accepts | Evidence unit | Location |
|---|---|---|---|
| Scanned document | PDF, PNG, JPG, TIFF | OCR paragraph (text layer used when present) | page, block, bbox, OCR confidence |
| Report / manual | PDF, DOCX, TXT, MD | paragraph | section path, line / paragraph |
| Conversation log | TXT, JSON, CSV | one speaker turn | turn, speaker, timestamp, line |
| System log | syslog (3164/5424), ISO / key=value / access logs, JSON, JSONL, CSV | one event (stack traces folded in) | line, timestamp, event ID |

OCR pages are read twice at different resolutions; if the two readings disagree the text is flagged unreliable even when Tesseract reports high confidence.

### Conflict detection, in short

The model only **reads** facts out of text; **comparing** them is code (`facts.js`): times, dates, durations and counts are normalised and compared with tolerance, start/end/duration never mix, differently named systems are never compared, named values go through entity resolution, system-log events are compared via the milestone they mark, identifiers (reference codes, ticket numbers, hashes) are never compared because they are meant to differ, and free-text values get a narrow model check that must agree in both orders. Values that could not be turned into a comparable fact are listed under *Not compared*. One project = one case.

### Security model

- Every route except `/auth/*` requires a token; projects, documents, files, drafts and exports are owner-only (404 otherwise, so existence is not leaked).
- Clearance (0 Unclassified – 3 Top Secret) is stored on the user, read from the database on every request, and enforced on retrieval, summaries, chat, previews, graphs, analysis results, drafts and exports. A downgrade takes effect immediately; a document, passage, entity name, alias or conflict above the reader's level is never returned.
- Uploads cannot be labelled above the uploader's clearance. Derived data (summaries, drafts, exports) is stamped with the highest level it used.
- Audit trail: append-only hash chain (`GET /api/audit`, `POST /api/verify`). Access denials are recorded.
- The signing key is kept in a separate volume the worker cannot read.
- No external service is contacted at runtime (a test fails the build if a hosted endpoint appears in the source).

---

## Quick start (local)

Prerequisites: Node 20+, Python 3.11+, MongoDB, Tesseract (`brew install tesseract`), and [Ollama](https://ollama.com) with `ollama pull qwen3:14b`.

```bash
cp backend/.env.example backend/.env      # set JWT_SECRET: openssl rand -hex 32
cp worker/.env.example  worker/.env
cp frontend/.env.example frontend/.env

cd backend  && npm install && cd ..
cd frontend && npm install && cd ..
cd worker   && python -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt && cd ..

(cd backend && npm run dev)                                        # :5001 (set PORT=5001 in backend/.env)
(cd worker && source .venv/bin/activate && uvicorn main:app --port 8000)
(cd frontend && npm start)                                         # :3000
```

The first worker start downloads two small models (MiniLM embeddings, a DeBERTa NLI model) from Hugging Face; after that the worker switches itself to offline mode (`worker/offline.py`: it detects both models in the local cache and sets `HF_HUB_OFFLINE=1`, so it makes no outbound calls; the startup log says which mode it is in). New users have clearance 0; grant more with `node backend/scripts/set-clearance.js <email> <0-3>`.

## Configuration

Environment files are `backend/.env`, `worker/.env` and `frontend/.env` (copy from the `.env.example` next to each). `STORAGE_DIR` must point at the same directory for the backend and the worker; keep `SIGNING_KEY_DIR` somewhere the worker cannot read.

| Setting | Where | Default |
|---|---|---|
| `JWT_SECRET` | backend (required) | none: the API refuses to start without it |
| `OLLAMA_URL`, `LLM_MODEL` | backend, worker | `http://localhost:11434`, `qwen3:14b` |
| `STORAGE_DIR` | backend, worker (shared) | `./storage` |
| `SIGNING_KEY_DIR` | backend only | `./keys` |
| `NLI_MODEL`, `NLI_ENTAIL_MIN` | worker, backend | `cross-encoder/nli-deberta-v3-small`, `0.5` |
| `UPLOAD_INSIGHTS` | backend | `0` (default): uploads only build the citable units (fast); highlights and notes are added per document with the **Add highlights** button. `1` generates them on every upload |
| `GENERATE_INSIGHTS`, `INSIGHT_CONCURRENCY` | worker | `1`, `2`: one Ollama call per key paragraph of PDFs/scans for highlights and notes; `0` skips it (no highlights, no claims in the Insights graph) |
| `ANALYSIS_MAX_FACT_UNITS`, `ANALYSIS_MAX_ENTITY_UNITS` | backend | `40`, `30` (passages the model reads per analysis run) |
| `MAX_UPLOAD_MB`, `MAX_UNITS` | backend, worker | `50`, `20000` |

## Using it

1. Create a project (one project per case), upload sources, choose a type and classification for each.
2. **Chat** (project or document scope) is a conversational RAG assistant. It remembers the thread (a follow-up like "how does it differ from BERT?" is rewritten into a standalone question before searching), retrieves passages in three steps (embedding + word-match search, widening each hit with its neighbouring text, then a local cross-encoder reranker that reads the question with each candidate), and writes an explanatory answer with inline citation chips `[1]` that open the numbered source passages shown under the answer. A second pass of the model checks every sentence against the passages: a citation to the wrong passage is corrected, and a sentence no passage supports is marked ⚠ rather than hidden. Greetings and "how many documents…" questions are answered directly, and a question the documents do not relate to gets a general answer labelled *not from your documents*. Broad questions ("explain the project", "what do these documents have in common") take a share of passages from every document, and "who are the authors" reads the opening passages of each.
3. **Analysis** tab → *Run analysis*: conflicts (with both quotes and a link to the source), entity matches to confirm, duplicates, and values that were *not compared*.
4. **Report** tab → generate a document from selected sources, review and edit (edits are re-verified and audited), then *Export signed PDF + manifest*.
5. *Verify an export* — or offline: `node backend/scripts/verify-export.js manifest.json public-key.pem document.pdf` (key from `GET /api/signing-key`).

*Analysis* reads long documents in stages, because every model call costs time on a laptop: only sentences that state a number, date, owner or cause (and names) are sent to the model, up to a per-run budget, and the page tells you how many are still waiting; run it again to continue. Short sources (reports, chats, notices) are read in full. Raise the budgets on stronger hardware with `ANALYSIS_MAX_FACT_UNITS` (default 40) and `ANALYSIS_MAX_ENTITY_UNITS` (default 30) in `backend/.env`. Report templates: *Incident report* (one event across reports, chats, logs and notices), *Briefing* (key facts first, for a decision-maker) and *Research brief* (several papers, each written about separately). The Report tab shows the report as a document (numbered sections, numbered citations, a list of cited sources); *Review statements* switches to per-statement editing, and the exported PDF has the same structure. Source classification levels (Unclassified to Top Secret) are explained next to the upload controls.

Demo data: `eval/make_corpus.py` generates a seeded corpus (all four source types, planted conflicts, aliases, duplicates and degraded scans) you can upload through the UI.

## API

Base URL `/api` (`:5001/api` when run locally). All routes except `/auth/*` need `Authorization: Bearer <token>`.

| Area | Endpoints |
|---|---|
| Auth | `POST /auth/signup`, `POST /auth/login`, `GET /auth/me` |
| Projects | `POST/GET /projects`, `GET/DELETE /projects/:id`, `POST/GET /projects/:id/summary` |
| Files and sources | `POST /files`, `GET /files/:key`, `POST /projects/:projectId/upload`, `GET .../documents`, `GET /documents/:id`, `GET .../documents/:id/units` |
| Chat | `POST /projects/:projectId/chat` (cited, entailment-checked answers) |
| Analysis | `POST/GET .../analysis`, `GET .../entities`, `POST .../entities/decisions`, `GET .../conflicts`, `PATCH .../conflicts/:id`, `GET .../duplicates`, `GET .../facts`, `GET .../gaps`, `GET .../entity-graph`, `GET .../knowledge-graph` |
| Documents | `GET/POST .../drafts`, `GET/DELETE .../drafts/:id`, `POST/PATCH/DELETE .../drafts/:id/claims[/:claimId]`, `POST .../drafts/:id/export`, `GET .../drafts/:id/exports`, `GET .../exports/:id/(pdf\|manifest)` |
| Provenance | `POST /verify`, `GET /signing-key`, `GET /audit` |

## Quality gates

```bash
(cd backend && npm test)                                    # API / security / export integration tests (needs MongoDB)
(cd worker && python -m unittest discover -s tests)         # parsers, entities, facts, rerank, render
(cd eval && python -m unittest discover -s tests)           # corpus and metric checks
(cd frontend && npm run build)
python eval/run_eval.py --api http://localhost:5001/api --seed 7   # end-to-end evaluation against a live stack
```

The evaluation (`eval/`) generates a seeded corpus with ground truth (planted conflicts, aliases, duplicates, degraded scans, canary strings at every classification level), drives the real stack, and reports OCR accuracy, extraction F1, entity-resolution accuracy, conflict recall/precision, citation correctness, hallucination rate, spillage and timing. Results are written to `eval/results/`. **Any classification spillage, any exported statement that asserts a value its citations do not contain, or any export that fails verification is a release blocker** (non-zero exit; `--strict` also fails on missed targets; `--stages` and `--quick` shorten a run).

## Repository map

| Path | Purpose |
|---|---|
| `backend/` | Express API: auth, access control, retrieval, analysis, drafts, signing, audit (`npm test`) |
| `worker/` | FastAPI worker: parsers, OCR, embeddings, NER, facts, NLI, PDF rendering (`python -m unittest discover -s tests`) |
| `frontend/` | React app: sources, analysis, report editor, verification, graph |
| `eval/` | Corpus generator, scorer, evaluation runner |

## Troubleshooting

- **`401 Invalid or expired token`** — sign in again; keep `JWT_SECRET` stable.
- **Upload says "above your clearance"** — an administrator must raise your clearance (`set-clearance.js`).
- **Document stuck in `PROCESSING` / report fails with "entailment model unavailable"** — the worker is down or still loading its models; check `GET :8000/health`.
- **Chat, analysis or reports hang** — check `ollama list` shows `qwen3:14b` and the model fits in memory.
- **Export refused: "no longer matches its recorded hash"** — a stored source file was modified; that is the integrity check working. Restore the file or re-upload.
- **First worker start is slow** — models are downloaded once; later starts are offline automatically (set `HF_HUB_OFFLINE=0` to force online).
