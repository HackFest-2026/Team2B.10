import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getDocument, getInsights, listDocuments, fileHref, authHeaders, downloadFile } from '../api';
import InsightSidebar from '../components/InsightSidebar';
import InsightTooltip from '../components/InsightTooltip';
import SelectionToolbar from '../components/SelectionToolbar';
import AddInsightModal from '../components/AddInsightModal';
import ChatPanel from '../components/ChatPanel';
import UserMenu from '../components/UserMenu';

// ─── PDF.js is vendored under public/vendor/pdfjs (on-prem: no CDN) ─────────
const PDFJS_CDN     = `${process.env.PUBLIC_URL || ''}/vendor/pdfjs/pdf.min.js`;
const WORKER_CDN    = `${process.env.PUBLIC_URL || ''}/vendor/pdfjs/pdf.worker.min.js`;

// ─── Text-layer CSS (injected once) ─────────────────────────────────────────
// Must be present BEFORE renderTextLayer() places <span>s into the DOM.
// Without this, spans render as visible black text on top of the canvas.
if (!document.getElementById('pdfjs-styles')) {
  const s = document.createElement('style');
  s.id = 'pdfjs-styles';
  s.textContent = `
    .pdfPage {
      position: relative;
      display: block;
      margin-bottom: 22px;
      border-radius: 14px;
      border: 1px solid var(--border);
      overflow: visible;
      line-height: 1;
      background: #fff;
      box-shadow: 0 12px 28px rgba(55, 50, 47, 0.08);
    }

    /* Layer 1 – canvas (visual rendering) */
.pdfPage canvas {
  display: block;
  position: absolute;
  top: 0; left: 0;
  z-index: 1;
  pointer-events: none;  /* canvas is visual only — never intercept mouse events */
}

    /* Layer 2 – text layer (transparent, selectable) */
    .pdfPage .textLayer {
      position: absolute;
      top: 0; left: 0;
      /* width/height set inline to match viewport */
      overflow: hidden;
      opacity: 1;
      z-index: 2;          /* above canvas */
      line-height: 1;
      pointer-events: auto; /* allow mouse events for selection */
      user-select: text;
      -webkit-user-select: text;
      -moz-user-select: text;
      -ms-user-select: text;
      /* Reset any inherited font settings */
      text-size-adjust: none;
      -webkit-text-size-adjust: none;
    }
    /* Each word/glyph span from PDF.js */
.pdfPage .textLayer span {
  color: transparent;
  position: absolute;
  white-space: pre;
  cursor: text;
  transform-origin: 0% 0%;
  pointer-events: auto;          /* ← add this explicitly on spans */
  user-select: text;
  -webkit-user-select: text;
}
    /* Warm highlight on selection */
    .pdfPage .textLayer span::selection {
      background: rgba(55, 50, 47, 0.20);
      color: transparent;
    }
    .pdfPage .textLayer br::selection {
      background: transparent;
    }

    /* Layer 3 – annotation layer (highlights, links) */
    .pdfPage .annotationLayer {
      position: absolute;
      top: 0; left: 0;
      z-index: 3;
      pointer-events: none;  /* individual children opt-in */
    }
    .pdfPage .annotationLayer section {
      position: absolute;
    }
    /* Annotation highlight rectangles */
    .pdfPage .annotationLayer .highlightAnnotation {
      opacity: 0.3;
      background: #ffff00;
      mix-blend-mode: multiply;
      pointer-events: none;
    }
    /* Transparent hover hotspots placed over highlight regions */
    .pdfPage .annotationLayer .insightHotspot {
      position: absolute;
      cursor: pointer;
      border-radius: 2px;
      pointer-events: auto;
      transition: box-shadow 0.15s ease, background 0.15s ease;
    }
    .pdfPage .annotationLayer .insightHotspot:hover {
      box-shadow: 0 0 0 2px rgba(255, 215, 0, 0.7);
      background: rgba(255, 215, 0, 0.12);
    }
    /* User highlight overlay (persisted highlights reloaded from DB) */
    .pdfPage .userHighlightOverlay {
      transition: box-shadow 0.15s ease, background 0.15s ease;
    }
    .pdfPage .userHighlightOverlay:hover {
      box-shadow: 0 0 0 2px rgba(255, 215, 0, 0.7);
      background: rgba(255, 215, 0, 0.5) !important;
    }
    @keyframes screenshotPulse {
      0%, 100% { outline-color: rgba(255,215,0,0.4); }
      50%       { outline-color: rgba(255,215,0,0.9); }
    }
    /* Sidebar tab bar */
    .dvTab {
      flex: 1;
      padding: 12px 0;
      background: transparent;
      border: none;
      border-bottom: 2px solid transparent;
      cursor: pointer;
      font-size: 14px;
      font-weight: 700;
      color: var(--text-dim, #6B6460);
      transition: color 0.15s, border-color 0.15s;
    }
    .dvTab.tab-active {
      color: var(--text, #2A2520);
      border-bottom-color: var(--accent, #37322F);
    }
  `;
  document.head.appendChild(s);
}

// ─── Load vendored PDF.js once, return the library object ───────────────────
let pdfjsLoadPromise = null;
function loadPdfJs() {
  if (pdfjsLoadPromise) return pdfjsLoadPromise;
  pdfjsLoadPromise = new Promise((resolve, reject) => {
    if (window.pdfjsLib) { return resolve(window.pdfjsLib); }
    const script = document.createElement('script');
    script.src = PDFJS_CDN;
    script.onload = () => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = WORKER_CDN;
      resolve(window.pdfjsLib);
    };
    script.onerror = () => reject(new Error('Failed to load PDF.js'));
    document.head.appendChild(script);
  });
  return pdfjsLoadPromise;
}

export default function DocumentViewer() {
  const { projectId, documentId } = useParams();
  const navigate = useNavigate();
  const [document_, setDocument] = useState(null);
  const [insights,  setInsights] = useState([]);
  const [projectDocs, setProjectDocs] = useState([]);
  const [loading,   setLoading]  = useState(true);
  const [pdfError,  setPdfError] = useState(null);
  const [scale,     setScale]    = useState(1.2);

  // Chat / sidebar state (persists across tab switches)
  const [chatOpen,         setChatOpen]         = useState(false);
  const [chatContext,      setChatContext]       = useState('');
  const [chatHistory,      setChatHistory]       = useState([]);
  const [screenshotMode,   setScreenshotMode]    = useState(false);
  const [chatImageContext, setChatImageContext]  = useState(null);

  useEffect(() => {
    const load = async () => {
      try {
        const [docRes, insRes] = await Promise.all([
          getDocument(documentId, projectId),
          getInsights(projectId, documentId),
        ]);
        setDocument(docRes.data);
        setInsights(insRes.data);
      } catch (err) {
        setPdfError(err.message);
      } finally {
        setLoading(false);
      }
    };
    load();
    listDocuments(projectId).then((r) => setProjectDocs(r.data)).catch(() => setProjectDocs([]));
  }, [documentId, projectId]);

  const handleAddInsight = (savedInsight) => setInsights(prev => [...prev, savedInsight]);
  const handleAskAI = (text) => { setChatContext(text); setChatOpen(true); };
  const handleRegionCaptured = (base64Image) => {
    setChatImageContext(base64Image);
    setScreenshotMode(false);
    setChatOpen(true);
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: 'var(--bg)' }}>
        <div>
          <div className="spinner" style={{ width: 40, height: 40, borderWidth: 3, margin: '0 auto 16px' }} />
          <p style={{ color: 'var(--text-dim)' }}>Loading document...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page" style={{ background: 'var(--bg)' }}>
      <nav className="navbar">
        <span className="navbar-brand" onClick={() => navigate('/')} style={{ cursor: 'pointer' }}>
          Mirage
        </span>
        <span style={{ color: 'var(--border)' }}>›</span>
        <span
          className="navbar-breadcrumb"
          style={{ cursor: 'pointer', color: 'var(--accent-light)' }}
          onClick={() => navigate(`/projects/${projectId}`)}
        >
          Project
        </span>
        <span style={{ color: 'var(--border)' }}>›</span>
        <span className="navbar-breadcrumb" style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {document_?.filename}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn btn-ghost" onClick={() => setScale(s => Math.max(0.5, s - 0.2))}>−</button>
          <span style={{ color: 'var(--text-dim)', lineHeight: '32px', fontSize: 14, fontWeight: 700 }}>{Math.round(scale * 100)}%</span>
          <button className="btn btn-ghost" onClick={() => setScale(s => Math.min(3, s + 0.2))}>+</button>
          <button
            className={`btn btn-ghost${screenshotMode ? ' btn-active' : ''}`}
            onClick={() => setScreenshotMode(s => !s)}
            title="Capture region to explain"
            style={{
              color: screenshotMode ? '#a16207' : undefined,
              border: screenshotMode ? '1px solid #fcd34d' : undefined,
              background: screenshotMode ? '#fffbeb' : undefined,
            }}
          >
            📷
          </button>
          <UserMenu />
        </div>
      </nav>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', height: 'calc(100vh - 74px)', overflow: 'hidden' }}>
        {/* PDF Viewer */}
        <div style={{
          overflowY: 'auto', padding: '28px', background: 'var(--surface2)',
          ...(screenshotMode && {
            outline: '2px solid #fcd34d',
            outlineOffset: '-2px',
            animation: 'screenshotPulse 1.5s ease-in-out infinite',
          }),
        }}>
          {pdfError ? (
            <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-dim)' }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>⚠️</div>
              <p style={{ color: 'var(--error)', marginBottom: 16 }}>{pdfError}</p>
              {document_?.annotatedFileUrl && (
                <button onClick={() => downloadFile(document_.annotatedFileUrl, document_.filename)} className="btn btn-primary">
                  Download PDF ↓
                </button>
              )}
            </div>
          ) : (
            <PdfRenderer
              url={document_?.annotatedFileUrl}
              scale={scale}
              insights={insights}
              projectId={projectId}
              documentId={documentId}
              onAddInsight={handleAddInsight}
              onAskAI={handleAskAI}
              screenshotMode={screenshotMode}
              onRegionCaptured={handleRegionCaptured}
            />
          )}
        </div>

        {/* Right Sidebar */}
        <div style={{
          display: 'flex', flexDirection: 'column',
          overflowY: 'hidden',
          background: 'var(--surface)',
          borderLeft: '1px solid var(--border)',
        }}>
          {/* Tab Bar */}
          <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
            <button className={`dvTab${!chatOpen ? ' tab-active' : ''}`} onClick={() => setChatOpen(false)}>
              💡 Insights
            </button>
            <button className={`dvTab${chatOpen ? ' tab-active' : ''}`} onClick={() => setChatOpen(true)}>
              💬 Ask AI
            </button>
          </div>

          {/* Tab Content */}
          <div style={{ flex: 1, overflowY: 'auto', padding: 18, display: 'flex', flexDirection: 'column' }}>
            {chatOpen ? (
              <ChatPanel
                context={chatContext}
                setContext={setChatContext}
                imageContext={chatImageContext}
                setImageContext={setChatImageContext}
                history={chatHistory}
                setHistory={setChatHistory}
                projectId={projectId}
                documentId={documentId}
                documents={projectDocs}
              />
            ) : (
              <>
                <h3 style={{ fontWeight: 700, marginBottom: 14, fontSize: 16, flexShrink: 0, color: 'var(--text)' }}>
                  Document Insights
                </h3>
                <InsightSidebar insights={insights} />
                <div style={{ marginTop: 20, flexShrink: 0 }}>
                  <button
                    onClick={() => downloadFile(document_?.annotatedFileUrl, document_?.filename)}
                    className="btn btn-ghost"
                    style={{ width: '100%', justifyContent: 'center' }}
                  >
                    📥 Download PDF
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────
/**
 * Match a PDF annotation hotspot to a system-generated insight by covered text.
 * User-created insights are matched by insightId directly (see overlay hover handlers).
 */
function findMatchingInsight(pageInsights, annot, viewport, textDiv) {
  if (!pageInsights.length) return null;

  const [rx1, ry1, rx2, ry2] = viewport.convertToViewportRectangle(annot.rect);
  const left   = Math.min(rx1, rx2);
  const top    = Math.min(ry1, ry2);
  const right  = Math.max(rx1, rx2);
  const bottom = Math.max(ry1, ry2);

  const layerRect = textDiv.getBoundingClientRect();
  let coveredText = '';

  textDiv.querySelectorAll('span').forEach(span => {
    const sr  = span.getBoundingClientRect();
    const sl  = sr.left - layerRect.left;
    const st  = sr.top  - layerRect.top;
    const sr2 = sl + sr.width;
    const sb  = st + sr.height;
    if (sl < right && sr2 > left && st < bottom && sb > top) {
      coveredText += span.textContent + ' ';
    }
  });

  coveredText = coveredText.toLowerCase().trim();
  if (!coveredText) return null;

  let bestInsight = null;
  let bestScore   = 0;

  for (const insight of pageInsights) {
    if (insight.type === 'user-created') continue; // handled separately by insightId
    for (const hl of (insight.highlights || [])) {
      const phrase = (hl.text || '').toLowerCase().trim();
      if (!phrase) continue;
      if (coveredText.includes(phrase) || phrase.includes(coveredText)) {
        const score = Math.min(coveredText.length, phrase.length) /
                      Math.max(coveredText.length, phrase.length);
        if (score > bestScore) { bestScore = score; bestInsight = insight; }
      }
    }
  }
  return bestInsight;
}

// ── PdfRenderer ──────────────────────────────────────────────────────────────
function PdfRenderer({ url, scale, insights, projectId, documentId, onAddInsight, onAskAI, screenshotMode, onRegionCaptured }) {
  const containerRef = useRef(null);
  const wrapperRef   = useRef(null);
  const overlayRef   = useRef(null);
  const insightsRef  = useRef(insights);
  useEffect(() => { insightsRef.current = insights; }, [insights]);

  const [tooltip,          setTooltip]          = useState(null);
  const [selectionToolbar, setSelectionToolbar]  = useState(null);
  const [insightModal,     setInsightModal]      = useState(null);
  const [dragState,        setDragState]         = useState(null);

  // ── Screenshot drag handlers ─────────────────────────────────────────────
  const handleMouseDown = (e) => {
    const rect = overlayRef.current.getBoundingClientRect();
    setDragState({
      startX:   e.clientX - rect.left,
      startY:   e.clientY - rect.top,
      currentX: e.clientX - rect.left,
      currentY: e.clientY - rect.top,
    });
  };

  const handleMouseMove = (e) => {
    if (!dragState) return;
    const rect = overlayRef.current.getBoundingClientRect();
    setDragState(prev => ({
      ...prev,
      currentX: e.clientX - rect.left,
      currentY: e.clientY - rect.top,
    }));
  };

  const handleMouseUp = async (e) => {
    if (!dragState) return;
    await captureRegion(dragState);
    setDragState(null);
  };

  const captureRegion = async (drag) => {
    const overlayRect    = overlayRef.current.getBoundingClientRect();
    const containerRect  = containerRef.current.getBoundingClientRect();

    const selLeft   = Math.min(drag.startX, drag.currentX);
    const selTop    = Math.min(drag.startY, drag.currentY);
    const selWidth  = Math.abs(drag.currentX - drag.startX);
    const selHeight = Math.abs(drag.currentY - drag.startY);

    if (selWidth < 10 || selHeight < 10) return;

    const pages = containerRef.current.querySelectorAll('.pdfPage');
    let targetCanvas     = null;
    let canvasOffsetTop  = 0;
    let canvasOffsetLeft = 0;

    for (const page of pages) {
      const pageRect  = page.getBoundingClientRect();
      const pageTop   = pageRect.top  - overlayRect.top;
      const pageLeft  = pageRect.left - overlayRect.left;

      if (
        selTop < pageTop + pageRect.height &&
        selTop + selHeight > pageTop
      ) {
        targetCanvas     = page.querySelector('canvas');
        canvasOffsetTop  = pageTop;
        canvasOffsetLeft = pageLeft;
        break;
      }
    }

    if (!targetCanvas) return;

    const dpr = window.devicePixelRatio || 1;

    const outputCanvas        = document.createElement('canvas');
    outputCanvas.width        = selWidth  * dpr;
    outputCanvas.height       = selHeight * dpr;
    const ctx = outputCanvas.getContext('2d');

    const srcX = (selLeft  - canvasOffsetLeft) * dpr;
    const srcY = (selTop   - canvasOffsetTop)  * dpr;
    const srcW = selWidth  * dpr;
    const srcH = selHeight * dpr;

    ctx.drawImage(targetCanvas, srcX, srcY, srcW, srcH, 0, 0, srcW, srcH);

    const base64Image = outputCanvas.toDataURL('image/png');
    onRegionCaptured && onRegionCaptured(base64Image);
  };


  // ── Text selection detection ─────────────────────────────────────────────
  useEffect(() => {
    const handleSelectionChange = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.toString().trim()) {
        setSelectionToolbar(null);
        return;
      }
      const selectedText = sel.toString().trim();
      const range = sel.getRangeAt(0);
      if (!containerRef.current?.contains(range.commonAncestorContainer)) {
        setSelectionToolbar(null);
        return;
      }
      const rect = range.getBoundingClientRect();
      setSelectionToolbar({ text: selectedText, rect });
    };

    document.addEventListener('selectionchange', handleSelectionChange);
    return () => document.removeEventListener('selectionchange', handleSelectionChange);
  }, []);

  // ── Draw persisted user highlight overlays ───────────────────────────────
  const drawUserHighlights = (currentScale) => {
    if (!containerRef.current) return;
    const s = currentScale ?? scale;
    containerRef.current.querySelectorAll('.userHighlightOverlay').forEach(el => el.remove());

    const userInsights = (insightsRef.current || []).filter(ins => ins.type === 'user-created');
    userInsights.forEach(insight => {
      const wrappers = containerRef.current.querySelectorAll('.pdfPage');
      const wrapper  = wrappers[insight.pageNumber - 1];
      if (!wrapper || !insight.boundingRect) return;
      const { left, top, width, height } = insight.boundingRect;
      if (!width || !height) return;

      const div = document.createElement('div');
      div.dataset.insightId     = insight._id || insight.id || '';
      div.dataset.userHighlight = 'true';
      div.className             = 'userHighlightOverlay';
      div.style.position        = 'absolute';
      div.style.left            = `${left   * s}px`;
      div.style.top             = `${top    * s}px`;
      div.style.width           = `${width  * s}px`;
      div.style.height          = `${height * s}px`;
      div.style.background      = 'rgba(255, 215, 0, 0.35)';
      div.style.borderRadius    = '2px';
      div.style.zIndex          = '4';
      div.style.pointerEvents   = 'auto';
      div.style.cursor          = 'pointer';

      div.addEventListener('mouseenter', () => {
        const r = div.getBoundingClientRect();
        setTooltip({
          insight,
          anchorRect: { centerX: r.left + r.width / 2, topY: r.top, bottomY: r.bottom },
        });
      });
      div.addEventListener('mousemove', () => {
        setTooltip(prev => {
          if (!prev) return prev;
          const r = div.getBoundingClientRect();
          return { ...prev, anchorRect: { centerX: r.left + r.width / 2, topY: r.top, bottomY: r.bottom } };
        });
      });
      div.addEventListener('mouseleave', () => setTooltip(null));
      wrapper.appendChild(div);
    });
  };

  // Redraw overlays when insights list changes (new insight saved without re-render)
  useEffect(() => {
    if (containerRef.current?.querySelectorAll('.pdfPage').length > 0) {
      drawUserHighlights(scale);
    }
    // eslint-disable-next-line
  }, [insights]);

  // ── Main PDF render ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    const renderTasks = [];

    const render = async () => {
      if (!containerRef.current) return;
      containerRef.current.innerHTML = '';

      let pdfjs;
      try {
        pdfjs = await loadPdfJs();
      } catch (err) {
        if (!cancelled && containerRef.current)
          containerRef.current.innerHTML = `<p style="color:#ef4444;padding:20px">Could not load PDF renderer: ${err.message}</p>`;
        return;
      }

      try {
        const pdf = await pdfjs.getDocument({ url: fileHref(url), httpHeaders: authHeaders() }).promise;
        if (cancelled) return;

        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
          if (cancelled) break;
          const page     = await pdf.getPage(pageNum);
          const viewport = page.getViewport({ scale });
          const dpr      = window.devicePixelRatio || 1;

          // Wrapper
          const wrapper        = document.createElement('div');
          wrapper.className    = 'pdfPage';
          wrapper.dataset.page = pageNum;
          wrapper.style.width  = `${viewport.width}px`;
          wrapper.style.height = `${viewport.height}px`;

          // Canvas
          const canvas   = document.createElement('canvas');
          canvas.width   = Math.floor(viewport.width  * dpr);
          canvas.height  = Math.floor(viewport.height * dpr);
          canvas.style.width  = `${viewport.width}px`;
          canvas.style.height = `${viewport.height}px`;
          wrapper.appendChild(canvas);

          const ctx = canvas.getContext('2d');
          ctx.scale(dpr, dpr);
          const renderTask = page.render({ canvasContext: ctx, viewport });
          renderTasks.push(renderTask);
          await renderTask.promise;

          // Text layer
          const textDiv = document.createElement('div');
          textDiv.className = 'textLayer';
          textDiv.style.width  = `${viewport.width}px`;
          textDiv.style.height = `${viewport.height}px`;
          textDiv.style.setProperty('--scale-factor', scale);
          wrapper.appendChild(textDiv);

          await pdfjs.renderTextLayer({
            textContentSource: page.streamTextContent(),
            container:  textDiv,
            viewport,
            textDivs:   [],
          }).promise;

          // Annotation hotspot layer (system-generated PDF highlights)
          const annotLayer        = document.createElement('div');
          annotLayer.className    = 'annotationLayer';
          annotLayer.style.width  = `${viewport.width}px`;
          annotLayer.style.height = `${viewport.height}px`;

          const annotations = await page.getAnnotations();
          annotations.filter(a => a.subtype === 'Highlight').forEach((annot) => {
            const [rx1, ry1, rx2, ry2] = viewport.convertToViewportRectangle(annot.rect);
            const hotspot        = document.createElement('div');
            hotspot.className    = 'insightHotspot';
            hotspot.style.left   = `${Math.min(rx1, rx2)}px`;
            hotspot.style.top    = `${Math.min(ry1, ry2)}px`;
            hotspot.style.width  = `${Math.abs(rx2 - rx1)}px`;
            hotspot.style.height = `${Math.abs(ry2 - ry1)}px`;

            hotspot.addEventListener('mouseenter', () => {
              const pageInsights = (insightsRef.current || []).filter(ins => ins.pageNumber === pageNum);
              const matched = findMatchingInsight(pageInsights, annot, viewport, textDiv);
              if (matched) {
                const r = hotspot.getBoundingClientRect();
                setTooltip({
                  insight: matched,
                  anchorRect: { centerX: r.left + r.width / 2, topY: r.top, bottomY: r.bottom },
                });
              }
            });
            hotspot.addEventListener('mouseleave', () => setTooltip(null));
            annotLayer.appendChild(hotspot);
          });

          wrapper.appendChild(annotLayer);
          if (!cancelled) containerRef.current?.appendChild(wrapper);
        }

        // After all pages rendered — draw persisted user highlight overlays
        if (!cancelled) drawUserHighlights(scale);
      } catch (err) {
        if (!cancelled && containerRef.current)
          containerRef.current.innerHTML = `<p style="color:#ef4444;padding:20px">Failed to render PDF: ${err.message}</p>`;
      }
    };

    render();
    return () => {
      cancelled = true;
      renderTasks.forEach((t) => { try { t.cancel(); } catch (_) {} });
    };
    // eslint-disable-next-line
  }, [url, scale]);

  // ── Selection toolbar handlers ───────────────────────────────────────────
  const handleAddInsight = (text) => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;

    const range     = sel.getRangeAt(0).cloneRange();
    const rangeRect = range.getBoundingClientRect();
    let pageNumber  = 1;
    let wrapperRect = null;

    if (containerRef.current) {
      for (const w of containerRef.current.querySelectorAll('.pdfPage')) {
        if (w.contains(range.commonAncestorContainer)) {
          pageNumber  = parseInt(w.dataset.page || '1', 10);
          wrapperRect = w.getBoundingClientRect();
          break;
        }
      }
      if (!wrapperRect) {
        const ancestor = range.commonAncestorContainer?.nodeType === 3
          ? range.commonAncestorContainer.parentElement
          : range.commonAncestorContainer;
        const closestPage = ancestor?.closest?.('.pdfPage');
        if (closestPage) {
          pageNumber  = parseInt(closestPage.dataset.page || '1', 10);
          wrapperRect = closestPage.getBoundingClientRect();
        }
      }
    }

    // Unscaled bounding rect (relative to page wrapper, divided by current scale)
    const rawRect = wrapperRect
      ? {
          left:   (rangeRect.left   - wrapperRect.left) / scale,
          top:    (rangeRect.top    - wrapperRect.top)  / scale,
          width:  rangeRect.width  / scale,
          height: rangeRect.height / scale,
        }
      : { left: 0, top: 0, width: 0, height: 0 };

    // Inline highlight (best-effort — can fail when selection spans multiple DOM nodes)
    let markEl = null;
    try {
      const mark = document.createElement('mark');
      mark.style.background      = 'rgba(255, 215, 0, 0.35)';
      mark.style.color           = 'transparent';
      mark.style.borderRadius    = '2px';
      mark.dataset.userHighlight = 'true';
      range.surroundContents(mark);
      markEl = mark;
    } catch (_) { /* safe to ignore */ }

    sel.removeAllRanges();
    setSelectionToolbar(null);
    setInsightModal({ text, rawRect, pageNumber, markEl });
  };

  const handleAsk = (text) => {
    window.getSelection()?.removeAllRanges();
    setSelectionToolbar(null);
    onAskAI && onAskAI(text);
  };

  const handleModalSave = (savedInsight) => {
    if (insightModal?.markEl) {
      insightModal.markEl.dataset.insightId = savedInsight._id || savedInsight.id || '';
    }
    setInsightModal(null);
    onAddInsight && onAddInsight(savedInsight);
  };

  const handleModalClose = () => {
    // Unwrap inline mark on cancel
    const mark = insightModal?.markEl;
    if (mark && mark.parentNode) {
      while (mark.firstChild) mark.parentNode.insertBefore(mark.firstChild, mark);
      mark.parentNode.removeChild(mark);
    }
    setInsightModal(null);
  };

  return (
    <>
      <div ref={wrapperRef} style={{ position: 'relative', maxWidth: 900, margin: '0 auto' }}>
        <div ref={containerRef} />

        {/* Screenshot drag overlay */}
        {screenshotMode && (
          <div
            ref={overlayRef}
            style={{
              position: 'absolute', top: 0, left: 0,
              width: '100%', height: '100%',
              zIndex: 10, cursor: 'crosshair', background: 'transparent',
            }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
          >
            {dragState && (
              <div style={{
                position:   'absolute',
                left:       Math.min(dragState.startX, dragState.currentX),
                top:        Math.min(dragState.startY, dragState.currentY),
                width:      Math.abs(dragState.currentX - dragState.startX),
                height:     Math.abs(dragState.currentY - dragState.startY),
                border:     '2px solid rgba(55,50,47,0.55)',
                background: 'rgba(55,50,47,0.06)',
                borderRadius: 3,
                pointerEvents: 'none',
              }} />
            )}
          </div>
        )}
      </div>

      {tooltip && <InsightTooltip insight={tooltip.insight} anchorRect={tooltip.anchorRect} />}

      {selectionToolbar && (
        <SelectionToolbar
          text={selectionToolbar.text}
          rect={selectionToolbar.rect}
          onHighlight={handleAddInsight}
          onAsk={handleAsk}
        />
      )}

      {insightModal && (
        <AddInsightModal
          selectedText={insightModal.text}
          pageNumber={insightModal.pageNumber}
          boundingRect={insightModal.rawRect}
          projectId={projectId}
          documentId={documentId}
          onSave={handleModalSave}
          onClose={handleModalClose}
        />
      )}
    </>
  );
}
