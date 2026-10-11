"""Renders a verified document to PDF (PyMuPDF Story) with classification banners and page footers."""
import html
from typing import Any, Dict

import fitz

CSS = """
body { font-family: sans-serif; font-size: 10.5pt; line-height: 1.35; color: #1d1b19; }
h1 { font-size: 20pt; margin: 0 0 4pt 0; }
h2 { font-size: 13pt; margin: 16pt 0 5pt 0; border-bottom: 1pt solid #c9c0b8; padding-bottom: 2pt; }
p.meta { color: #6b625b; font-size: 10pt; margin: 0 0 6pt 0; }
table.facts { margin: 4pt 0 6pt 0; }
table.facts th { color: #6b625b; font-weight: normal; width: 70pt; }
p { margin: 0 0 7pt 0; text-align: left; }
table.conflicts td { border-bottom: 0.5pt solid #e3dcd5; padding: 3pt 0; font-size: 10pt; }
li { margin-bottom: 4pt; }
sup { font-size: 7.5pt; color: #37322f; }
.tag { font-size: 8pt; font-weight: bold; }
.conflict { color: #a3211f; }
.human { color: #8a6200; }
.unverified { color: #6b625b; }
.note { color: #6b625b; font-size: 9pt; }
.redacted { color: #6b625b; font-style: italic; }
td, th { font-size: 9pt; padding: 2pt 6pt 2pt 0; vertical-align: top; text-align: left; }
.quote { font-style: italic; color: #4a4440; }
.mono { font-family: monospace; font-size: 8pt; color: #6b625b; }
"""


def _e(value: Any) -> str:
    return html.escape(str(value))


def _cites(numbers) -> str:
    return "".join(f"<sup>[{n}]</sup>" for n in numbers)


def _tag(item: Dict[str, Any]) -> str:
    if item["status"] == "conflicted":
        return " <span class='tag conflict'>[SOURCES CONFLICT]</span>"
    if item["status"] == "human":
        return " <span class='tag human'>[ANALYST NOTE – NO SOURCE]</span>"
    if item["status"] == "unsupported":
        return " <span class='tag unverified'>[UNVERIFIED]</span>"
    return ""


def _section_html(index: int, section: Dict[str, Any]) -> list:
    parts = [f"<h2>{index}. {_e(section['heading'])}</h2>"]
    items = section["items"]
    if not items:
        return parts + ["<p class='note'>No verifiable statements for this section.</p>"]
    redactions = [i for i in items if i.get("redacted")]
    statements = [i for i in items if not i.get("redacted")]
    if section.get("key") == "conflicts" and statements:
        # one row per disagreement: easier to scan than prose
        parts.append("<table class='conflicts'>")
        for item in statements:
            parts.append(f"<tr><td>{_e(item['text'])}{_cites(item['cites'])}</td></tr>")
        parts.append("</table>")
    else:
        # flowing paragraphs of three statements each, every one followed by its citation numbers
        for start in range(0, len(statements), 3):
            chunk = statements[start:start + 3]
            parts.append("<p>" + " ".join(f"{_e(i['text'])}{_cites(i['cites'])}{_tag(i)}" for i in chunk) + "</p>")
    for item in redactions:
        parts.append(f"<p class='redacted'>[REDACTED: {int(item['count'])} statement(s) above this clearance]</p>")
    return parts


def build_html(spec: Dict[str, Any]) -> str:
    parts = [f"<h1>{_e(spec['title'])}</h1>"]
    if spec.get("templateLabel"):
        parts.append(f"<p class='meta'>{_e(spec['templateLabel'])}</p>")
    s = spec["summary"]
    facts = [
        ("Prepared", spec["generatedAt"]),
        ("Classification", spec["classificationName"]),
        ("Export", spec["exportId"]),
    ]
    names = list(dict.fromkeys(src["filename"] for src in spec["sources"]))
    if names:
        facts.append(("Sources", ", ".join(names)))
    verification = (
        f"{s['supported']} verified, {s['conflicted']} in conflict, {s['human']} analyst notes without a source"
        f"{', ' + str(s['excluded']) + ' unverified statements excluded' if s['excluded'] else ''}"
        f"{', ' + str(s['redacted']) + ' statements redacted above this clearance' if s['redacted'] else ''}"
    )
    facts.append(("Verification", verification))
    parts.append("<table class='facts'>" + "".join(f"<tr><th>{_e(k)}</th><td>{_e(v)}</td></tr>" for k, v in facts) + "</table>")
    for index, section in enumerate(spec["sections"], start=1):
        parts.extend(_section_html(index, section))
    parts.append("<h2>Sources</h2><table>")
    for src in spec["sources"]:
        parts.append(
            f"<tr><td><b>[{src['n']}]</b></td><td>{_e(src['filename'])}<br/><span class='note'>{_e(src['location'])} · {_e(src['classificationName'])}</span>"
            f"<br/><span class='quote'>“{_e(src['quote'])}”</span><br/><span class='mono'>file sha-256 {_e(src['sha256'])}</span></td></tr>"
        )
    parts.append("</table>")
    parts.append(f"<p class='note'>Every statement above cites a verbatim excerpt of an ingested source. The signed provenance manifest "
                 f"(key {_e(spec['keyId'])}) maps each statement to its sources and records the source file hashes.</p>")
    return "".join(parts)


def render_pdf(spec: Dict[str, Any], out_path: str) -> int:
    story = fitz.Story(html=build_html(spec), user_css=CSS)
    mediabox = fitz.paper_rect("a4")
    where = mediabox + (54, 64, -54, -64)
    writer = fitz.DocumentWriter(out_path)
    more = 1
    while more:
        device = writer.begin_page(mediabox)
        more, _ = story.place(where)
        story.draw(device)
        writer.end_page()
    writer.close()

    # classification banners and page footers
    doc = fitz.open(out_path)
    total = len(doc)
    banner = spec["classificationName"].upper()
    for number, page in enumerate(doc, start=1):
        # DocumentWriter pages can carry an unbalanced transform (PyMuPDF 1.24 flips everything added afterwards, so the
        # banners and footer came out upside-down and swapped). Wrapping the existing content isolates it.
        page.wrap_contents()
        width = page.rect.width
        page.insert_textbox(fitz.Rect(0, 22, width, 40), banner, fontsize=10, fontname="hebo", align=fitz.TEXT_ALIGN_CENTER, color=(0.64, 0.13, 0.12))
        page.insert_textbox(fitz.Rect(0, page.rect.height - 46, width, page.rect.height - 24), banner, fontsize=10, fontname="hebo", align=fitz.TEXT_ALIGN_CENTER, color=(0.64, 0.13, 0.12))
        page.insert_textbox(
            fitz.Rect(54, page.rect.height - 20, width - 54, page.rect.height - 6),
            f"export {spec['exportId']} · page {number} of {total}", fontsize=7, fontname="helv", color=(0.42, 0.38, 0.36),
        )
    tmp = out_path + ".tmp"
    doc.save(tmp, garbage=3, deflate=True)
    doc.close()
    import os
    os.replace(tmp, out_path)
    return total
