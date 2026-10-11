from .common import IngestError, ParseResult
from .chat import parse_chatlog
from .logs import parse_syslog
from .report import parse_docx, parse_text_report
from .scan import units_from_pages
from .common import decode_text

SOURCE_TYPES = {
    "scan": {"pdf", "png", "jpg", "jpeg", "tif", "tiff"},
    "report": {"pdf", "docx", "txt", "md"},
    "chatlog": {"txt", "log", "json", "jsonl", "csv"},
    "syslog": {"txt", "log", "json", "jsonl", "csv"},
}
PAGE_BASED = {"pdf", "png", "jpg", "jpeg", "tif", "tiff"}  # handled by the PDF/OCR pipeline


def extension_of(filename: str) -> str:
    return filename.rsplit(".", 1)[-1].lower() if "." in filename else ""


def is_page_based(source_type: str, filename: str) -> bool:
    return extension_of(filename) in PAGE_BASED


def parse_file(path: str, source_type: str, filename: str) -> ParseResult:
    """Parse any non-page-based source (text reports, docx, chat logs, system logs) into EUs."""
    ext = extension_of(filename)
    if source_type not in SOURCE_TYPES:
        raise IngestError(f"Unknown source type '{source_type}'")
    if ext not in SOURCE_TYPES[source_type]:
        raise IngestError(f".{ext} files are not supported for source type '{source_type}'")
    with open(path, "rb") as f:
        raw = f.read()
    if not raw.strip():
        raise IngestError("File is empty")
    if source_type == "report":
        return parse_docx(raw) if ext == "docx" else parse_text_report(decode_text(raw))
    text = decode_text(raw)
    return parse_chatlog(text, ext) if source_type == "chatlog" else parse_syslog(text, ext)
