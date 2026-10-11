import { useState, useEffect, useRef } from "react"
import { Link } from "react-router-dom"

// ============================================================================
// Scroll-reveal hook
// ============================================================================
function useInView(options = {}) {
  const ref = useRef(null)
  const [inView, setInView] = useState(false)
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setInView(true); observer.disconnect() } },
      { threshold: 0.12, ...options }
    )
    if (ref.current) observer.observe(ref.current)
    return () => observer.disconnect()
  }, [])
  return [ref, inView]
}

// ============================================================================
// Injected keyframes & micro-interaction styles
// ============================================================================
function LandingStyles() {
  return (
    <style>{`
      @keyframes fadeUp {
        from { opacity: 0; transform: translateY(22px); }
        to   { opacity: 1; transform: translateY(0); }
      }
      @keyframes fadeIn {
        from { opacity: 0; }
        to   { opacity: 1; }
      }
      @keyframes slideRight {
        from { transform: scaleX(0); }
        to   { transform: scaleX(1); }
      }
      @keyframes progressBar {
        0%   { transform: translateX(-100%); }
        100% { transform: translateX(0%); }
      }
      .fade-up {
        opacity: 0;
        animation: fadeUp 0.55s cubic-bezier(0.22, 1, 0.36, 1) forwards;
      }
      .fade-up.delay-1 { animation-delay: 0.08s; }
      .fade-up.delay-2 { animation-delay: 0.18s; }
      .fade-up.delay-3 { animation-delay: 0.28s; }
      .fade-up.delay-4 { animation-delay: 0.38s; }
      .reveal {
        opacity: 0;
        transform: translateY(18px);
        transition: opacity 0.5s cubic-bezier(0.22,1,0.36,1), transform 0.5s cubic-bezier(0.22,1,0.36,1);
      }
      .reveal.visible {
        opacity: 1;
        transform: translateY(0);
      }
      .reveal.delay-1 { transition-delay: 0.07s; }
      .reveal.delay-2 { transition-delay: 0.14s; }
      .reveal.delay-3 { transition-delay: 0.21s; }
      .btn-primary {
        transition: background 0.18s ease, transform 0.12s ease, box-shadow 0.18s ease;
      }
      .btn-primary:hover  { background: #2A2520; }
      .btn-primary:active { transform: scale(0.97); }
      .btn-secondary {
        transition: background 0.18s ease, transform 0.12s ease;
      }
      .btn-secondary:hover  { background: #f0eeec; }
      .btn-secondary:active { transform: scale(0.97); }
      .nav-link {
        position: relative;
        transition: color 0.15s ease;
      }
      .nav-link::after {
        content: '';
        position: absolute;
        bottom: -2px; left: 0;
        width: 100%; height: 1px;
        background: #37322F;
        transform: scaleX(0);
        transform-origin: left;
        transition: transform 0.2s cubic-bezier(0.22,1,0.36,1);
      }
      .nav-link:hover::after { transform: scaleX(1); }
      .nav-link:hover { color: #37322F; }
      .bento-card {
        transition: transform 0.22s cubic-bezier(0.22,1,0.36,1), box-shadow 0.22s ease;
      }
      .bento-card:hover {
        transform: translateY(-3px);
        box-shadow: 0 8px 28px rgba(55,50,47,0.10);
        z-index: 1;
      }
      .social-icon {
        transition: transform 0.15s ease, opacity 0.15s ease;
      }
      .social-icon:hover { transform: scale(1.15); opacity: 0.7; cursor: pointer; }
      .tech-pill {
        transition: background 0.15s ease, transform 0.15s ease;
      }
      .tech-pill:hover { background: #ede9e6; transform: translateY(-1px); }
      .feature-card-item {
        transition: background 0.18s ease, box-shadow 0.18s ease;
      }
      .step-card {
        transition: background 0.2s ease, box-shadow 0.2s ease, transform 0.2s cubic-bezier(0.22,1,0.36,1);
      }
      .step-card:hover {
        transform: translateY(-2px);
      }
      @keyframes flipIn {
        0%   { opacity: 0; transform: translateY(60%) rotateX(-30deg); filter: blur(4px); }
        100% { opacity: 1; transform: translateY(0%)  rotateX(0deg);   filter: blur(0px); }
      }
      @keyframes flipOut {
        0%   { opacity: 1; transform: translateY(0%)   rotateX(0deg);   filter: blur(0px); }
        100% { opacity: 0; transform: translateY(-60%) rotateX(30deg);  filter: blur(4px); }
      }
      .flip-word-in  { animation: flipIn  0.45s cubic-bezier(0.22,1,0.36,1) forwards; }
      .flip-word-out { animation: flipOut 0.35s cubic-bezier(0.55,0,1,0.45) forwards; }
    `}</style>
  )
}

// ============================================================================
// FlipWords Component (Aceternity-style)
// ============================================================================
function FlipWords({ words, className = "", interval = 2800 }) {
  const [current, setCurrent] = useState(0)
  const [phase, setPhase] = useState("in") // "in" | "out"

  useEffect(() => {
    const tick = setInterval(() => {
      setPhase("out")
      setTimeout(() => {
        setCurrent(i => (i + 1) % words.length)
        setPhase("in")
      }, 380)
    }, interval)
    return () => clearInterval(tick)
  }, [words.length, interval])

  return (
    <span
      className={className}
      style={{
        display: "inline-block",
        position: "relative",
        perspective: "800px",
        transformStyle: "preserve-3d",
      }}
    >
      <span
        key={current}
        className={phase === "in" ? "flip-word-in" : "flip-word-out"}
        style={{ display: "inline-block", transformOrigin: "50% 100%" }}
      >
        {words[current]}
      </span>
    </span>
  )
}

// ============================================================================
// Badge Component
// ============================================================================
function Badge({ icon, text }) {
  return (
    <div className="px-[14px] py-[6px] bg-white shadow-[0px_0px_0px_4px_rgba(55,50,47,0.05)] overflow-hidden rounded-[90px] flex justify-start items-center gap-[8px] border border-[rgba(2,6,23,0.08)]">
      <div className="w-[14px] h-[14px] relative overflow-hidden flex items-center justify-center">{icon}</div>
      <div className="text-center flex justify-center flex-col text-[#37322F] text-xs font-medium leading-3 font-sans">
        {text}
      </div>
    </div>
  )
}

// ============================================================================
// Feature Card Component
// ============================================================================
function FeatureCard({
  title,
  description,
  isActive,
  progress,
  onClick,
}) {
  return (
    <div
      className={`w-full md:flex-1 self-stretch px-6 py-5 overflow-hidden flex flex-col justify-start items-start gap-2 cursor-pointer relative border-b md:border-b-0 last:border-b-0 ${
        isActive
          ? "bg-white shadow-[0px_0px_0px_0.75px_#E0DEDB_inset]"
          : "border-l-0 border-r-0 md:border border-[#E0DEDB]/80"
      }`}
      onClick={onClick}
    >
      {isActive && (
        <div className="absolute top-0 left-0 w-full h-0.5 bg-[rgba(50,45,43,0.08)]">
          <div
            className="h-full bg-[#322D2B] transition-all duration-100 ease-linear"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      <div className="self-stretch flex justify-center flex-col text-[#2A2520] text-sm md:text-sm font-semibold leading-6 md:leading-6 font-sans">
        {title}
      </div>
      <div className="self-stretch text-[#6B6460] text-[13px] md:text-[13px] font-normal leading-[22px] md:leading-[22px] font-sans">
        {description}
      </div>
    </div>
  )
}

// ============================================================================
// PDF Highlight Preview Component
// ============================================================================
function PDFHighlightPreview({ width = 482, height = 300, className = "", theme = "light" }) {
  const highlights = [
    { color: "#3B82F6", bg: "rgba(59,130,246,0.15)", label: "Key Finding", y: 20, w: "80%" },
    { color: "#10B981", bg: "rgba(16,185,129,0.15)", label: "Methodology", y: 52, w: "65%" },
    { color: "#F59E0B", bg: "rgba(245,158,11,0.15)", label: "Result", y: 84, w: "72%" },
    { color: "#8B5CF6", bg: "rgba(139,92,246,0.15)", label: "Conclusion", y: 116, w: "58%" },
  ]
  return (
    <div
      className={className}
      style={{ width, height, display: "flex", alignItems: "center", justifyContent: "center", background: "transparent" }}
      role="img"
      aria-label="PDF with colorful highlight annotations"
    >
      <div style={{ position: "relative", width: "260px", height: "220px", transform: "scale(1.1)" }}>
        {/* Back page shadow */}
        <div style={{ position: "absolute", left: "14px", top: "8px", width: "220px", height: "200px", background: "#f1f5f9", borderRadius: "6px", boxShadow: "0 1px 4px rgba(0,0,0,0.08)" }} />
        {/* Main page */}
        <div style={{ position: "absolute", left: "0px", top: "0px", width: "220px", height: "200px", background: "#ffffff", borderRadius: "6px", boxShadow: "0px 2px 12px rgba(0,0,0,0.12), 0px 0px 0px 1px rgba(0,0,0,0.06)", padding: "14px", overflow: "hidden" }}>
          {/* Title line */}
          <div style={{ width: "60%", height: "8px", background: "#1e293b", borderRadius: "3px", marginBottom: "10px", opacity: 0.85 }} />
          <div style={{ width: "40%", height: "5px", background: "#94a3b8", borderRadius: "3px", marginBottom: "14px" }} />
          {highlights.map((h, i) => (
            <div key={i} style={{ marginBottom: "8px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "3px" }}>
                <div style={{ width: "3px", height: "14px", background: h.color, borderRadius: "2px", flexShrink: 0 }} />
                <div style={{ width: h.w, height: "8px", background: h.bg, borderRadius: "3px", border: `1px solid ${h.color}30` }} />
              </div>
              <div style={{ display: "flex", gap: "4px", paddingLeft: "9px" }}>
                <div style={{ width: "55%", height: "5px", background: "#e2e8f0", borderRadius: "2px" }} />
              </div>
            </div>
          ))}
        </div>
        {/* Floating insight badge */}
        <div style={{ position: "absolute", right: "-10px", top: "20px", background: "#1e3a8a", borderRadius: "20px", padding: "4px 10px", display: "flex", alignItems: "center", gap: "5px", boxShadow: "0 2px 8px rgba(30,58,138,0.35)" }}>
          <div style={{ width: "6px", height: "6px", background: "#60a5fa", borderRadius: "50%" }} />
          <span style={{ fontFamily: "Inter, sans-serif", fontSize: "9px", fontWeight: 600, color: "#ffffff" }}>4 insights</span>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// RAG Chat Preview Component
// ============================================================================
function ChatPreview({ width = 400, height = 250, className = "" }) {
  const messages = [
    { role: "user", text: "What methodology was used?" },
    { role: "ai", text: "The paper uses a transformer-based approach with multi-head attention…", source: "paper.pdf p.4" },
    { role: "user", text: "Summarize the results" },
  ]
  return (
    <div
      className={className}
      style={{ width, height, background: "transparent", display: "flex", alignItems: "center", justifyContent: "center" }}
    >
      <div style={{ width: "240px", background: "#ffffff", borderRadius: "10px", boxShadow: "0 2px 16px rgba(0,0,0,0.10), 0 0 0 1px rgba(0,0,0,0.06)", overflow: "hidden" }}>
        <div style={{ background: "#1e3a8a", padding: "8px 12px", display: "flex", alignItems: "center", gap: "6px" }}>
          <div style={{ width: "6px", height: "6px", background: "#60a5fa", borderRadius: "50%" }} />
          <span style={{ fontFamily: "Inter, sans-serif", fontSize: "10px", fontWeight: 600, color: "#e0f2fe" }}>Mirage Chat</span>
        </div>
        <div style={{ padding: "10px", display: "flex", flexDirection: "column", gap: "8px" }}>
          {messages.map((m, i) => (
            <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: m.role === "user" ? "flex-end" : "flex-start" }}>
              <div style={{
                maxWidth: "85%",
                background: m.role === "user" ? "#1e3a8a" : "#f1f5f9",
                color: m.role === "user" ? "#ffffff" : "#1e293b",
                borderRadius: m.role === "user" ? "10px 10px 2px 10px" : "10px 10px 10px 2px",
                padding: "5px 8px",
                fontFamily: "Inter, sans-serif",
                fontSize: "8px",
                fontWeight: 400,
                lineHeight: "1.4",
              }}>{m.text}</div>
              {m.source && (
                <div style={{ marginTop: "2px", background: "#dbeafe", borderRadius: "4px", padding: "2px 6px", fontFamily: "Inter, sans-serif", fontSize: "7px", color: "#1d4ed8", fontWeight: 500 }}>
                  📄 {m.source}
                </div>
              )}
            </div>
          ))}
          <div style={{ display: "flex", alignItems: "center", gap: "4px", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "20px", padding: "4px 8px", marginTop: "2px" }}>
            <div style={{ flex: 1, height: "5px", background: "#e2e8f0", borderRadius: "3px" }} />
            <div style={{ width: "14px", height: "14px", background: "#1e3a8a", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <div style={{ width: "5px", height: "5px", borderLeft: "4px solid white", borderTop: "3px solid transparent", borderBottom: "3px solid transparent" }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Insight Cards Preview Component
// ============================================================================
function InsightPreview({ width = 400, height = 250, className = "" }) {
  const insights = [
    { color: "#3B82F6", tag: "Finding", text: "Model outperforms baseline by 12% on benchmark tasks." },
    { color: "#10B981", tag: "Method", text: "Uses contrastive learning with augmented training samples." },
    { color: "#F59E0B", tag: "Limitation", text: "Requires large GPU memory — not suitable for edge devices." },
  ]
  return (
    <div
      className={className}
      style={{ width, height, background: "transparent", display: "flex", alignItems: "center", justifyContent: "center" }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "8px", width: "230px" }}>
        {insights.map((ins, i) => (
          <div key={i} style={{ background: "#ffffff", borderRadius: "8px", boxShadow: "0 1px 6px rgba(0,0,0,0.08), 0 0 0 1px rgba(0,0,0,0.05)", padding: "8px 10px", display: "flex", gap: "8px", alignItems: "flex-start" }}>
            <div style={{ width: "3px", borderRadius: "3px", background: ins.color, alignSelf: "stretch", flexShrink: 0 }} />
            <div>
              <div style={{ fontFamily: "Inter, sans-serif", fontSize: "8px", fontWeight: 700, color: ins.color, marginBottom: "3px", textTransform: "uppercase", letterSpacing: "0.04em" }}>{ins.tag}</div>
              <div style={{ fontFamily: "Inter, sans-serif", fontSize: "9px", color: "#334155", lineHeight: "1.4", fontWeight: 400 }}>{ins.text}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ============================================================================
// Knowledge Graph Preview Component
// ============================================================================
function GraphPreview({ width = "100%", height = "100%", className = "" }) {
  const nodes = [
    { x: 50, y: 50, r: 14, color: "#1e3a8a", label: "Transformer" },
    { x: 120, y: 30, r: 10, color: "#3B82F6", label: "Attention" },
    { x: 140, y: 80, r: 10, color: "#10B981", label: "BERT" },
    { x: 30, y: 100, r: 9, color: "#8B5CF6", label: "NLP" },
    { x: 90, y: 110, r: 8, color: "#F59E0B", label: "Training" },
  ]
  const edges = [
    [0, 1], [0, 2], [0, 3], [0, 4], [1, 2], [3, 4],
  ]
  return (
    <div
      className={className}
      style={{ width, height, background: "transparent", display: "flex", alignItems: "center", justifyContent: "center" }}
    >
      <div style={{ position: "relative", width: "200px", height: "160px" }}>
        <svg width="200" height="160" style={{ position: "absolute", top: 0, left: 0 }}>
          {edges.map(([a, b], i) => (
            <line key={i} x1={nodes[a].x} y1={nodes[a].y} x2={nodes[b].x} y2={nodes[b].y} stroke="rgba(30,58,138,0.18)" strokeWidth="1.5" />
          ))}
          {nodes.map((n, i) => (
            <g key={i}>
              <circle cx={n.x} cy={n.y} r={n.r} fill={n.color} opacity={0.15} />
              <circle cx={n.x} cy={n.y} r={n.r - 3} fill={n.color} opacity={0.9} />
              <text x={n.x} y={n.y + n.r + 9} textAnchor="middle" fontFamily="Inter, sans-serif" fontSize="7" fill="#475569" fontWeight="500">{n.label}</text>
            </g>
          ))}
        </svg>
        <div style={{ position: "absolute", top: "4px", right: "4px", background: "#1e3a8a", borderRadius: "12px", padding: "3px 7px" }}>
          <span style={{ fontFamily: "Inter, sans-serif", fontSize: "8px", fontWeight: 600, color: "#e0f2fe" }}>3D Graph</span>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// How It Works Section Component
// ============================================================================
function HowItWorksSection() {
  const [activeCard, setActiveCard] = useState(0)
  const [animationKey, setAnimationKey] = useState(0)

  const cards = [
    {
      number: "1",
      title: "Create a Project",
      description: "Organize your research by creating a project workspace. Every project keeps documents, insights, and chats fully isolated.",
    },
    {
      number: "2",
      title: "Upload PDFs",
      description: "Drop in research papers, reports, or any PDF. Mirage accepts multi-file uploads and queues them for processing automatically.",
    },
    {
      number: "3",
      title: "AI Processing Pipeline",
      description: "Text extraction, semantic chunking, embedding generation, insight detection, and highlight mapping all run automatically in the background.",
    },
    {
      number: "4",
      title: "Browse Annotated Docs",
      description: "Open the interactive PDF viewer to see AI-annotated highlights, generated insight cards, and user notes side by side.",
    },
    {
      number: "5",
      title: "Chat & Explore Graph",
      description: "Ask project-scoped questions in chat with full source attribution, then navigate the auto-generated 3D knowledge graph.",
    },
  ]

  useEffect(() => {
    const interval = setInterval(() => {
      setActiveCard((prev) => (prev + 1) % cards.length)
      setAnimationKey((prev) => prev + 1)
    }, 5000)
    return () => clearInterval(interval)
  }, [cards.length])

  const handleCardClick = (index) => {
    setActiveCard(index)
    setAnimationKey((prev) => prev + 1)
  }

  return (
    <div id="how-it-works" className="w-full border-b border-[rgba(55,50,47,0.12)] flex flex-col justify-center items-center">
      {/* Header Section */}
      <div className="self-stretch px-6 md:px-24 py-12 md:py-16 border-b border-[rgba(55,50,47,0.12)] flex justify-center items-center gap-6">
        <div className="w-full max-w-[586px] px-6 py-5 overflow-hidden rounded-lg flex flex-col justify-start items-center gap-4">
          <Badge
            icon={<div className="w-[10.50px] h-[10.50px] outline outline-[1.17px] outline-[#37322F] outline-offset-[-0.58px] rounded-full"></div>}
            text="How It Works"
          />
          <div className="self-stretch text-center flex justify-center flex-col text-[#2A2520] text-3xl md:text-5xl font-semibold leading-tight md:leading-[60px] font-sans tracking-tight">
            From PDF to insight in minutes
          </div>
          <div className="self-stretch text-center text-[#6B6460] text-[15px] font-normal leading-7 font-sans">
            Upload your research, let AI do the heavy lifting, then chat and explore
          </div>
        </div>
      </div>

      {/* Content Section */}
      <div className="self-stretch px-4 md:px-9 overflow-hidden flex justify-start items-center">
        <div className="flex-1 py-8 md:py-11 flex flex-col justify-start items-center gap-6 md:gap-12">
          <div className="w-full grid grid-cols-1 md:grid-cols-5 gap-4">
            {cards.map((card, index) => {
              const isActive = index === activeCard
              return (
                <div
                  key={index}
                  onClick={() => handleCardClick(index)}
                  className={`step-card overflow-hidden flex flex-col justify-start items-start transition-all duration-300 cursor-pointer p-4 ${
                    isActive
                      ? "bg-white shadow-[0px_0px_0px_0.75px_#E0DEDB_inset]"
                      : "border border-[rgba(2,6,23,0.08)]"
                  }`}
                >
                  <div className={`w-full h-0.5 bg-[rgba(50,45,43,0.08)] overflow-hidden ${isActive ? "opacity-100" : "opacity-0"}`}>
                    <div
                      key={animationKey}
                      className="h-0.5 bg-[#322D2B] will-change-transform"
                      style={{ animation: isActive ? "progressBar 5s linear forwards" : "none" }}
                    />
                  </div>
                  <div className="w-full flex flex-col gap-2 pt-2">
                    <div className="text-[#2A2520] text-2xl font-bold">{card.number}</div>
                    <div className="self-stretch flex justify-center flex-col text-[#2A2520] text-sm font-semibold leading-6 font-sans">
                      {card.title}
                    </div>
                    <div className="self-stretch text-[#6B6460] text-[13px] font-normal leading-[22px] font-sans">
                      {card.description}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// FAQ Section Component
// ============================================================================
const faqItems = [
  {
    question: "What kinds of documents can I upload?",
    answer: "Mirage supports any PDF — research papers, reports, theses, or technical documentation. Multi-file uploads are supported per project.",
  },
  {
    question: "How does the AI insight extraction work?",
    answer: "After upload, a background worker extracts text with PyMuPDF, chunks it semantically, embeds each chunk with SentenceTransformers, and runs a local Ollama LLM prompt to detect key findings, methodologies, and limitations automatically.",
  },
  {
    question: "Are answers in chat always grounded in my documents?",
    answer: "Yes. The RAG system retrieves only the most relevant chunks from your project's documents and passes them as context. The LLM is instructed not to answer from general knowledge — every response cites the source chunk and page.",
  },
  {
    question: "What is the 3D knowledge graph?",
    answer: "Mirage auto-extracts named entities and their relationships from each document using an LLM, then renders them as a navigable force-directed 3D graph using Three.js / react-force-graph-3d. You can rotate, zoom, and click nodes to inspect them.",
  },
  {
    question: "Are my projects and documents isolated from each other?",
    answer: "Completely. Each project has its own document store, chunk embeddings, insight cards, and chat history. Search and chat never cross project boundaries.",
  },
  {
    question: "Can I run Mirage locally or self-host it?",
    answer: "Yes. The entire stack ships as a Docker Compose file — frontend (React + Nginx), backend (Node.js), Python worker, and MongoDB all start with a single `docker compose up`. Runs fully on-prem with a local Ollama model and no external services.",
  },
]

function FAQSection() {
  const [open, setOpen] = useState(null)
  const [ref, inView] = useInView()
  return (
    <section className="w-full border-b border-[rgba(55,50,47,0.12)]" id="faq">
      <div ref={ref} className="mx-auto max-w-3xl px-6 py-16 sm:py-24">
        {/* Header */}
        <div className={`text-center mb-12 reveal ${inView ? "visible" : ""}`}>
          <h2 className="mt-4 font-serif text-3xl sm:text-4xl md:text-5xl font-normal text-[#2A2520] tracking-tight leading-tight">
            Common Questions
          </h2>
          <p className="mt-3 text-[#6B6460] text-[15px] leading-7 font-sans max-w-md mx-auto">
            Everything you need to know about how Mirage works.
          </p>
        </div>

        {/* Accordion grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {faqItems.map((item, index) => (
            <div
              key={index}
              className={`reveal ${inView ? "visible" : ""} delay-${(index % 3) + 1}`}
            >
              <button
                onClick={() => setOpen(open === index ? null : index)}
                className="w-full text-left bg-white border border-[rgba(55,50,47,0.10)] rounded-xl p-5 shadow-[0_1px_4px_rgba(55,50,47,0.06)] transition-all duration-200 hover:shadow-[0_3px_12px_rgba(55,50,47,0.10)] hover:-translate-y-[1px] group focus:outline-none"
              >
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-[#2A2520] text-[13px] sm:text-sm font-semibold leading-snug font-sans flex-1">
                    {item.question}
                  </h3>
                  <div
                    className="flex-shrink-0 w-5 h-5 rounded-full border border-[rgba(55,50,47,0.15)] flex items-center justify-center mt-0.5 transition-transform duration-200"
                    style={{ transform: open === index ? "rotate(45deg)" : "rotate(0deg)" }}
                  >
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                      <path d="M5 1v8M1 5h8" stroke="#6B6460" strokeWidth="1.4" strokeLinecap="round" />
                    </svg>
                  </div>
                </div>
                <div
                  className="overflow-hidden transition-all duration-300 ease-in-out"
                  style={{ maxHeight: open === index ? "200px" : "0px", opacity: open === index ? 1 : 0 }}
                >
                  <p className="mt-3 text-[#6B6460] text-[13px] leading-[1.65] font-sans font-normal border-t border-[rgba(55,50,47,0.07)] pt-3">
                    {item.answer}
                  </p>
                </div>
              </button>
            </div>
          ))}
        </div>

        {/* Bottom CTA */}
        <p className="mt-8 text-center text-sm text-[rgba(55,50,47,0.50)] font-sans">
          Still have questions?{" "}
          <a
            href="https://github.com/hack-morpheus/mirage-0"
            target="_blank"
            rel="noreferrer"
            className="text-[#37322F] font-medium underline-offset-2 hover:underline"
          >
            Open an issue on GitHub
          </a>
        </p>
      </div>
    </section>
  )
}

// ============================================================================
// CTA Section Component
// ============================================================================
function CTASection() {
  return (
    <div className="w-full relative overflow-hidden flex flex-col justify-center items-center gap-2">
      {/* Content */}
      <div className="self-stretch px-6 md:px-24 py-12 md:py-12 border-t border-b border-[rgba(55,50,47,0.12)] flex justify-center items-center gap-6 relative z-10">
        <div className="absolute inset-0 w-full h-full overflow-hidden">
          <div className="w-full h-full relative">
            {Array.from({ length: 300 }).map((_, i) => (
              <div
                key={i}
                className="absolute h-4 w-full rotate-[-45deg] origin-top-left outline outline-[0.5px] outline-[rgba(3,7,18,0.08)] outline-offset-[-0.25px]"
                style={{
                  top: `${i * 16 - 120}px`,
                  left: "-100%",
                  width: "300%",
                }}
              ></div>
            ))}
          </div>
        </div>

        <div className="w-full max-w-[586px] px-6 py-5 md:py-8 overflow-hidden rounded-lg flex flex-col justify-start items-center gap-6 relative z-20">
          <div className="self-stretch flex flex-col justify-start items-start gap-3">
            <div className="self-stretch text-center flex justify-center flex-col text-[#2A2520] text-3xl md:text-5xl font-semibold leading-tight md:leading-[56px] font-sans tracking-tight">
              Ready to transform your research?
            </div>
            <div className="self-stretch text-center text-[#6B6460] text-[15px] leading-7 font-sans font-normal">
              Upload your first PDF and let Mirage surface the insights hidden in your documents — automatically.
            </div>
          </div>
          <div className="w-full max-w-[497px] flex flex-col justify-center items-center gap-12">
            <div className="flex justify-start items-center gap-4">
              <Link to="/app">
                <div className="btn-primary h-10 px-12 py-[6px] relative bg-[#37322F] shadow-[0px_0px_0px_2.5px_rgba(255,255,255,0.08)_inset] overflow-hidden rounded-full flex justify-center items-center cursor-pointer">
                  <div className="w-44 h-[41px] absolute left-0 top-0 bg-gradient-to-b from-[rgba(255,255,255,0)] to-[rgba(0,0,0,0.10)] mix-blend-multiply"></div>
                  <div className="flex flex-col justify-center text-white text-[13px] font-medium leading-5 font-sans">
                    Open App
                  </div>
                </div>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Footer Section Component
// ============================================================================
function FooterSection() {
  return (
    <div className="w-full pt-10 flex flex-col justify-start items-start">
      {/* Main Footer Content */}
      <div className="self-stretch h-auto flex flex-col md:flex-row justify-between items-stretch pr-0 pb-8 pt-0">
        <div className="h-auto p-4 md:p-8 flex flex-col justify-start items-start gap-8">
          {/* Brand Section */}
          <div className="self-stretch flex justify-start items-center gap-3">
            <div className="text-center text-[#49423D] text-xl font-semibold leading-4 font-sans">Mirage</div>
          </div>
          <div className="text-[rgba(73,66,61,0.90)] text-sm font-medium leading-[18px] font-sans">
            AI-powered research document intelligence platform.
            <br />
            Upload PDFs. Extract insights. Chat with your research.
          </div>

          {/* Social Media Icons */}
          <div className="flex justify-start items-start gap-4">
            {/* Twitter/X Icon */}
            <div className="social-icon w-6 h-6 relative overflow-hidden">
              <div className="w-6 h-6 left-0 top-0 absolute flex items-center justify-center">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path
                    d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"
                    fill="#49423D"
                  />
                </svg>
              </div>
            </div>

            {/* LinkedIn Icon */}
            <div className="social-icon w-6 h-6 relative overflow-hidden">
              <div className="w-6 h-6 left-0 top-0 absolute flex items-center justify-center">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path
                    d="M20.5 2h-17A1.5 1.5 0 002 3.5v17A1.5 1.5 0 003.5 22h17a1.5 1.5 0 001.5-1.5v-17A1.5 1.5 0 0020.5 2zM8 19H5v-9h3zM6.5 8.25A1.75 1.75 0 118.3 6.5a1.78 1.78 0 01-1.8 1.75zM19 19h-3v-4.74c0-1.42-.6-1.93-1.38-1.93A1.74 1.74 0 0013 14.19a.66.66 0 000 .14V19h-3v-9h2.9v1.3a3.11 3.11 0 012.7-1.4c1.55 0 3.36.86 3.36 3.66z"
                    fill="#49423D"
                  />
                </svg>
              </div>
            </div>

            {/* GitHub Icon */}
            <div className="social-icon w-6 h-6 relative overflow-hidden">
              <div className="w-6 h-6 left-0 top-0 absolute flex items-center justify-center">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path
                    d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.300 24 12c0-6.627-5.374-12-12-12z"
                    fill="#49423D"
                  />
                </svg>
              </div>
            </div>
          </div>
        </div>

        {/* Navigation Links */}
        <div className="self-stretch p-4 md:p-8 flex flex-col sm:flex-row flex-wrap justify-start sm:justify-between items-start gap-6 md:gap-8">
          {/* Product Column */}
          <div className="flex flex-col justify-start items-start gap-3 flex-1 min-w-[120px]">
            <div className="self-stretch text-[rgba(73,66,61,0.50)] text-sm font-medium leading-5 font-sans">
              Product
            </div>
            <div className="flex flex-col justify-end items-start gap-2">
              <a href="#how-it-works" className="text-[#49423D] text-sm font-normal leading-5 font-sans cursor-pointer hover:text-[#37322F] transition-colors">
                How It Works
              </a>
              <a href="#features" className="text-[#49423D] text-sm font-normal leading-5 font-sans cursor-pointer hover:text-[#37322F] transition-colors">
                Features
              </a>
              <a href="#knowledge-graph" className="text-[#49423D] text-sm font-normal leading-5 font-sans cursor-pointer hover:text-[#37322F] transition-colors">
                Knowledge Graph
              </a>
              <a href="#pdf-viewer" className="text-[#49423D] text-sm font-normal leading-5 font-sans cursor-pointer hover:text-[#37322F] transition-colors">
                PDF Viewer
              </a>
            </div>
          </div>

          {/* Resources Column */}
          <div className="flex flex-col justify-start items-start gap-3 flex-1 min-w-[120px]">
            <div className="text-[rgba(73,66,61,0.50)] text-sm font-medium leading-5 font-sans">Resources</div>
            <div className="flex flex-col justify-center items-start gap-2">
              <div className="text-[#49423D] text-sm font-normal leading-5 font-sans cursor-pointer hover:text-[#37322F] transition-colors">
                README
              </div>
              <div className="text-[#49423D] text-sm font-normal leading-5 font-sans cursor-pointer hover:text-[#37322F] transition-colors">
                API Reference
              </div>
              <div className="text-[#49423D] text-sm font-normal leading-5 font-sans cursor-pointer hover:text-[#37322F] transition-colors">
                Architecture
              </div>
              <div className="text-[#49423D] text-sm font-normal leading-5 font-sans cursor-pointer hover:text-[#37322F] transition-colors">
                Tech Stack
              </div>
            </div>
          </div>

          {/* Company Column */}
          <div className="flex flex-col justify-start items-start gap-3 flex-1 min-w-[120px]">
            <div className="text-[rgba(73,66,61,0.50)] text-sm font-medium leading-5 font-sans">Company</div>
            <div className="flex flex-col justify-center items-start gap-2">
              <div className="text-[#49423D] text-sm font-normal leading-5 font-sans">hello@mirage.app</div>
              <a href="https://github.com/hack-morpheus/mirage-0" target="_blank" rel="noreferrer" className="text-[#49423D] text-sm font-normal leading-5 font-sans cursor-pointer hover:text-[#37322F] transition-colors">
                GitHub
              </a>
              <Link to="/app">
                <div className="text-[#49423D] text-sm font-normal leading-5 font-sans cursor-pointer hover:text-[#37322F] transition-colors">
                  Open App
                </div>
              </Link>
              <Link to="/code">
                <div className="text-[#49423D] text-sm font-normal leading-5 font-sans cursor-pointer hover:text-[#37322F] transition-colors">
                  Code Lab
                </div>
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Section with Pattern */}
      <div className="self-stretch h-12 relative overflow-hidden border-t border-b border-[rgba(55,50,47,0.12)]">
        <div className="absolute inset-0 w-full h-full overflow-hidden">
          <div className="w-full h-full relative">
            {Array.from({ length: 400 }).map((_, i) => (
              <div
                key={i}
                className="absolute w-[300px] h-16 border border-[rgba(3,7,18,0.08)]"
                style={{
                  left: `${i * 300 - 600}px`,
                  top: "-120px",
                  transform: "rotate(-45deg)",
                  transformOrigin: "top left",
                }}
              />
            ))}
          </div>
        </div>

        {/* Copyright text */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="flex items-center gap-4 flex-wrap justify-center px-4">
            <div className="text-[rgba(73,66,61,0.50)] text-xs font-normal">© 2025 Mirage. All rights reserved.</div>
            <div className="flex items-center gap-3">
              <div className="text-[rgba(73,66,61,0.50)] text-xs font-normal cursor-pointer hover:text-[#49423D] transition-colors">
                Privacy Policy
              </div>
              <div className="text-[rgba(73,66,61,0.50)] text-xs font-normal">•</div>
              <div className="text-[rgba(73,66,61,0.50)] text-xs font-normal cursor-pointer hover:text-[#49423D] transition-colors">
                Terms of Service
              </div>
              <div className="text-[rgba(73,66,61,0.50)] text-xs font-normal">•</div>
              <div className="text-[rgba(73,66,61,0.50)] text-xs font-normal cursor-pointer hover:text-[#49423D] transition-colors">
                Legal
              </div>
              <div className="text-[rgba(73,66,61,0.50)] text-xs font-normal">•</div>
              <div
                className="text-[rgba(73,66,61,0.50)] text-xs font-normal cursor-pointer hover:text-[#49423D] transition-colors"
                onClick={() => new Audio('/sounds/fahh.mp3').play()}
              >
                check
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Main Landing Page Component
// ============================================================================
export default function LandingPage() {
  const [activeCard, setActiveCard] = useState(0)
  const [progress, setProgress] = useState(0)
  const [isScrolled, setIsScrolled] = useState(false)
  const mountedRef = useRef(true)

  useEffect(() => {
    const onScroll = () => setIsScrolled(window.scrollY > 60)
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [])

  useEffect(() => {
    const progressInterval = setInterval(() => {
      if (!mountedRef.current) return

      setProgress((prev) => {
        if (prev >= 100) {
          if (mountedRef.current) {
            setActiveCard((current) => (current + 1) % 3)
          }
          return 0
        }
        return prev + 2
      })
    }, 100)

    return () => {
      clearInterval(progressInterval)
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    return () => {
      mountedRef.current = false
    }
  }, [])

  const handleCardClick = (index) => {
    if (!mountedRef.current) return
    setActiveCard(index)
    setProgress(0)
  }

  return (
    <div className="w-full min-h-screen relative bg-[#F7F5F3] overflow-x-hidden flex flex-col justify-start items-center">
      <LandingStyles />
      <div className="relative flex flex-col justify-start items-center w-full">
        {/* Main container */}
        <div className="w-full max-w-none px-4 sm:px-6 md:px-8 lg:px-0 lg:max-w-[1280px] lg:w-[1280px] relative flex flex-col justify-start items-start min-h-screen">
          {/* Left vertical line */}
          <div className="w-[1px] h-full absolute left-4 sm:left-6 md:left-8 lg:left-0 top-0 bg-[rgba(55,50,47,0.12)] shadow-[1px_0px_0px_white] z-0"></div>

          {/* Right vertical line */}
          <div className="w-[1px] h-full absolute right-4 sm:right-6 md:right-8 lg:right-0 top-0 bg-[rgba(55,50,47,0.12)] shadow-[1px_0px_0px_white] z-0"></div>

          <div className="self-stretch pt-[9px] overflow-hidden border-b border-[rgba(55,50,47,0.06)] flex flex-col justify-center items-center gap-4 sm:gap-6 md:gap-8 lg:gap-[66px] relative z-10">
            {/* Navigation */}
            <div className={`w-full h-12 sm:h-14 md:h-16 lg:h-[84px] fixed left-0 top-0 flex justify-center items-center z-50 px-6 sm:px-8 md:px-12 lg:px-0 transition-all duration-300 ${isScrolled ? "bg-[rgba(247,245,243,0.85)] backdrop-blur-md border-b border-[rgba(55,50,47,0.10)] shadow-[0_1px_0_rgba(255,255,255,0.6)]" : ""}`}>
              {!isScrolled && <div className="w-full h-0 absolute left-0 top-6 sm:top-7 md:top-8 lg:top-[42px] border-t border-[rgba(55,50,47,0.12)] shadow-[0px_1px_0px_white]"></div>}

              <div className={`transition-all duration-300 ${
                isScrolled
                  ? "w-full max-w-5xl px-6 h-full flex justify-between items-center"
                  : "w-full max-w-[calc(100%-32px)] sm:max-w-[calc(100%-48px)] md:max-w-[calc(100%-64px)] lg:max-w-[700px] lg:w-[700px] h-10 sm:h-11 md:h-12 py-1.5 sm:py-2 px-3 sm:px-4 md:px-4 pr-2 sm:pr-3 bg-[#F7F5F3] backdrop-blur-sm shadow-[0px_0px_0px_2px_white] overflow-hidden rounded-[50px]"
              } flex justify-between items-center relative z-30`}>
                <div className="flex justify-center items-center">
                  <div className="flex justify-start items-center">
                    <div className="flex flex-col justify-center text-[#2F3037] text-sm sm:text-base md:text-lg lg:text-xl font-medium leading-5 font-sans">
                      Mirage
                    </div>
                  </div>
                  <div className="pl-3 sm:pl-4 md:pl-5 lg:pl-5 hidden sm:flex flex-row gap-2 sm:gap-3 md:gap-4 lg:gap-4">
                    <div className="flex justify-start items-center">
                      <a href="#how-it-works" className="nav-link flex flex-col justify-center text-[rgba(49,45,43,0.80)] text-xs md:text-[13px] font-medium leading-[14px] font-sans">
                        How It Works
                      </a>
                    </div>
                    <div className="flex justify-start items-center">
                      <a href="#features" className="nav-link flex flex-col justify-center text-[rgba(49,45,43,0.80)] text-xs md:text-[13px] font-medium leading-[14px] font-sans">
                        Features
                      </a>
                    </div>
                    <div className="flex justify-start items-center">
                      <a href="#how-it-works" className="nav-link flex flex-col justify-center text-[rgba(49,45,43,0.80)] text-xs md:text-[13px] font-medium leading-[14px] font-sans">
                        Docs
                      </a>
                    </div>
                    <div className="flex justify-start items-center">
                      <Link to="/code" className="nav-link flex flex-col justify-center text-[rgba(49,45,43,0.80)] text-xs md:text-[13px] font-medium leading-[14px] font-sans">
                        Code
                      </Link>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 sm:gap-3">
                  {isScrolled && (
                    <Link to="/app">
                      <div className="btn-primary px-4 py-1.5 bg-[#37322F] rounded-full flex justify-center items-center cursor-pointer">
                        <div className="text-white text-xs md:text-[13px] font-medium leading-5 font-sans">Open App</div>
                      </div>
                    </Link>
                  )}
                  {!isScrolled && (
                    <Link to="/app">
                      <div className="btn-secondary px-2 sm:px-3 md:px-[14px] py-1 sm:py-[6px] bg-white shadow-[0px_1px_2px_rgba(55,50,47,0.12)] overflow-hidden rounded-full flex justify-center items-center cursor-pointer">
                        <div className="flex flex-col justify-center text-[#37322F] text-xs md:text-[13px] font-medium leading-5 font-sans">
                          Open App
                        </div>
                      </div>
                    </Link>
                  )}
                </div>
              </div>
            </div>

            {/* Hero Section */}
            <div className="w-full relative overflow-hidden" style={{ height: "100svh" }}>

              {/* Hero — 2-col: content left, video right — centered with max-width */}
              <div
                className="relative z-10 w-full h-full flex items-stretch justify-center"
                style={{ paddingTop: 80 }}
              >
                <div className="w-full max-w-[1200px] py-10 mx-auto px-6 md:px-12 md:py-10 grid grid-cols-1 md:grid-cols-[460px_1fr] gap-0 h-full">

                  {/* ── Left: headline + description + CTA ── */}
                  <div className="fade-up flex flex-col justify-between py-10 pr-0 md:pr-12 h-full min-h-0">

                    {/* Headline with flip words — top-aligned */}
                    <div>
                      <h1
                        className="font-serif text-[#2A2520] font-normal tracking-tight"
                        style={{ fontSize: "clamp(2.8rem, 5vw, 5rem)", lineHeight: 1.05 }}
                      >
                        Research
                        <br />
                        <FlipWords
                          words={["Faster.","Smarter.","Deeper.","Effortlessly."]}
                          className="text-[#2A2520]"
                          interval={2600}
                        />
                      </h1>

                      {/* Sub-description */}
                      <p
                        className="font-sans font-normal text-[#6B6460] mt-6"
                        style={{ fontSize: "clamp(0.88rem, 1.2vw, 1rem)", lineHeight: 1.75, maxWidth: 380 }}
                      >
                        Your research is buried in scattered PDFs.
                        <span className="text-[#C9472A] font-semibold"> Set it free in minutes.</span>
                        <br /><br />
                        Upload your papers — Mirage extracts insights, agents surface what matters, and ships deep understanding fast.
                      </p>
                    </div>

                    {/* CTA — bottom of left column */}
                    <div className="fade-up delay-2 flex flex-col gap-3">
                      <Link to="/app">
                        <div
                          className="btn-primary relative overflow-hidden flex items-center gap-2 cursor-pointer w-fit"
                          style={{
                            height: 52,
                            paddingLeft: 36,
                            paddingRight: 36,
                            background: "#1C1917",
                            borderRadius: 100,
                            boxShadow: "0 1px 0 rgba(255,255,255,0.08) inset, 0 4px 16px rgba(28,25,23,0.30)",
                          }}
                        >
                          <div className="absolute inset-0 bg-gradient-to-b from-[rgba(255,255,255,0.06)] to-transparent rounded-full" />
                          <span className="relative text-white font-sans font-medium" style={{ fontSize: 15, letterSpacing: "-0.01em" }}>
                            Start my Research
                          </span>
                          <svg className="relative" width="15" height="15" viewBox="0 0 14 14" fill="none">
                            <path d="M3 7h8M7 3l4 4-4 4" stroke="rgba(255,255,255,0.55)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        </div>
                      </Link>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        {["PDF extraction", "Vector search", "RAG chat", "3D graph"].map((s, i) => (
                          <div key={i} className="flex items-center gap-1.5">
                            {i > 0 && <span className="text-[rgba(55,50,47,0.2)] text-xs">·</span>}
                            <span className="text-[11px] text-[rgba(55,50,47,0.45)] font-sans">{s}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                  </div>

                  {/* ── Right: large video, right-anchored ── */}
                  <div className="relative h-full min-h-0 flex items-start justify-center overflow-hidden">
                    <div
                      style={{
                        width: "min(600px, 100%)",
                        height: "100%",
                        position: "relative",
                        maskImage: "linear-gradient(to bottom, black 0%, black 52%, transparent 100%)",
                        WebkitMaskImage: "linear-gradient(to bottom, black 0%, black 52%, transparent 100%)",
                      }}
                    >
                      <video
                        autoPlay
                        loop
                        muted
                        playsInline
                        style={{
                          width: "100%",
                          height: "100%",
                          objectFit: "cover",
                          objectPosition: "center top",
                          display: "block",
                        }}
                      >
                        <source src="/ajja.mp4" type="video/mp4" />
                      </video>
                    </div>
                  </div>

                </div>
              </div>
            </div>

            {/* Product screenshots section */}
            <div className="w-full border-t border-[rgba(55,50,47,0.10)]">
              <div className="w-full max-w-[960px] mx-auto px-4 sm:px-6 lg:px-0 pt-6 pb-0">
                <div className="w-full h-[220px] sm:h-[320px] md:h-[460px] lg:h-[600px] bg-white shadow-[0px_0px_0px_1px_rgba(0,0,0,0.06),0_4px_24px_rgba(55,50,47,0.10)] overflow-hidden rounded-[10px] flex flex-col">
                  <div className="flex-1 relative overflow-hidden">
                    {[
                      "/images/projectss.png",
                      "/images/anno.png",
                      "/images/kg.png",
                    ].map((src, idx) => (
                      <div
                        key={idx}
                        className={`absolute inset-0 transition-all duration-500 ease-in-out ${
                          activeCard === idx ? "opacity-100 scale-100" : "opacity-0 scale-[0.98]"
                        }`}
                      >
                        <img
                          src={src || "/placeholder.svg"}
                          alt={["Projects Dashboard", "Document Viewer", "Annotation Tool", "Knowledge Graph"][idx]}
                          className="w-full h-full object-cover object-top"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Feature Cards strip */}
            <div id="features" className="self-stretch border-t border-b border-[rgba(55,50,47,0.12)] flex justify-center items-start">
              <div className="w-4 sm:w-6 md:w-8 lg:w-12 self-stretch relative overflow-hidden">
                <div className="w-[120px] sm:w-[140px] md:w-[162px] left-[-40px] sm:left-[-50px] md:left-[-58px] top-[-120px] absolute flex flex-col justify-start items-start">
                  {Array.from({ length: 50 }).map((_, i) => (
                    <div key={i} className="self-stretch h-3 sm:h-4 rotate-[-45deg] origin-top-left outline outline-[0.5px] outline-[rgba(3,7,18,0.08)] outline-offset-[-0.25px]"></div>
                  ))}
                </div>
              </div>
              <div className="flex-1 flex flex-col md:flex-row justify-center items-stretch gap-0">
                <FeatureCard
                  title="AI Insight Extraction"
                  description="Automatically surfaces key findings, methodologies, and conclusions from your PDFs — no manual reading required."
                  isActive={activeCard === 0}
                  progress={activeCard === 0 ? progress : 0}
                  onClick={() => handleCardClick(0)}
                />
                <FeatureCard
                  title="Grounded RAG Chat"
                  description="Ask questions in natural language and get answers grounded exclusively in your uploaded documents, with source attribution."
                  isActive={activeCard === 1}
                  progress={activeCard === 1 ? progress : 0}
                  onClick={() => handleCardClick(1)}
                />
                <FeatureCard
                  title="3D Knowledge Graph"
                  description="Explore an auto-generated interactive 3D graph of entities and relationships discovered across all your project documents."
                  isActive={activeCard === 2}
                  progress={activeCard === 2 ? progress : 0}
                  onClick={() => handleCardClick(2)}
                />
              </div>
              <div className="w-4 sm:w-6 md:w-8 lg:w-12 self-stretch relative overflow-hidden">
                <div className="w-[120px] sm:w-[140px] md:w-[162px] left-[-40px] sm:left-[-50px] md:left-[-58px] top-[-120px] absolute flex flex-col justify-start items-start">
                  {Array.from({ length: 50 }).map((_, i) => (
                    <div key={i} className="self-stretch h-3 sm:h-4 rotate-[-45deg] origin-top-left outline outline-[0.5px] outline-[rgba(3,7,18,0.08)] outline-offset-[-0.25px]"></div>
                  ))}
                </div>
              </div>
            </div>

              {/* Social Proof & Logo Grid Section */}
              <div className="w-full border-b border-[rgba(55,50,47,0.12)] flex flex-col justify-center items-center">
                <div className="self-stretch px-4 sm:px-6 md:px-24 py-8 sm:py-12 md:py-16 border-b border-[rgba(55,50,47,0.12)] flex justify-center items-center gap-6">
                  <div className="w-full max-w-[586px] px-4 sm:px-6 py-4 sm:py-5 shadow-[0px_2px_4px_rgba(50,45,43,0.06)] overflow-hidden rounded-lg flex flex-col justify-start items-center gap-3 sm:gap-4 shadow-none">
                    <Badge
                      icon={
                        <svg width="12" height="10" viewBox="0 0 12 10" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <rect x="1" y="3" width="4" height="6" stroke="#37322F" strokeWidth="1" fill="none" />
                          <rect x="7" y="1" width="4" height="8" stroke="#37322F" strokeWidth="1" fill="none" />
                          <rect x="2" y="4" width="1" height="1" fill="#37322F" />
                          <rect x="3.5" y="4" width="1" height="1" fill="#37322F" />
                          <rect x="2" y="5.5" width="1" height="1" fill="#37322F" />
                          <rect x="3.5" y="5.5" width="1" height="1" fill="#37322F" />
                          <rect x="8" y="2" width="1" height="1" fill="#37322F" />
                          <rect x="9.5" y="2" width="1" height="1" fill="#37322F" />
                          <rect x="8" y="3.5" width="1" height="1" fill="#37322F" />
                          <rect x="9.5" y="3.5" width="1" height="1" fill="#37322F" />
                          <rect x="8" y="5" width="1" height="1" fill="#37322F" />
                          <rect x="9.5" y="5" width="1" height="1" fill="#37322F" />
                        </svg>
                      }
                      text="Powered by Cutting Edge Technology"
                    />
                    <div className="w-full max-w-[472.55px] text-center flex justify-center flex-col text-[#2A2520] text-xl sm:text-2xl md:text-3xl lg:text-5xl font-semibold leading-tight md:leading-[60px] font-sans tracking-tight">
                      Powered by cutting-edge AI
                    </div>
                    <div className="self-stretch text-center text-[#6B6460] text-sm sm:text-[15px] font-normal leading-6 sm:leading-7 font-sans">
                      SentenceTransformers, Local Ollama LLMs (Qwen3), PyMuPDF, and vector search power every layer of the pipeline.
                    </div>
                  </div>
                </div>

                {/* Logo Grid */}
                <div className="self-stretch border-[rgba(55,50,47,0.12)] flex justify-center items-start border-t border-b-0">
                  <div className="w-4 sm:w-6 md:w-8 lg:w-12 self-stretch relative overflow-hidden">
                    <div className="w-[120px] sm:w-[140px] md:w-[162px] left-[-40px] sm:left-[-50px] md:left-[-58px] top-[-120px] absolute flex flex-col justify-start items-start">
                      {Array.from({ length: 50 }).map((_, i) => (
                        <div
                          key={i}
                          className="self-stretch h-3 sm:h-4 rotate-[-45deg] origin-top-left outline outline-[0.5px] outline-[rgba(3,7,18,0.08)] outline-offset-[-0.25px]"
                        />
                      ))}
                    </div>
                  </div>

                  {/* Tech stack pill strip */}
                  <div className="flex-1 border-l border-r border-[rgba(55,50,47,0.12)] py-8 px-6 flex flex-col items-center gap-5">
                    <p className="text-[rgba(55,50,47,0.45)] text-xs font-medium uppercase tracking-widest font-sans">Powered by</p>
                    <div className="flex flex-wrap justify-center gap-2 sm:gap-3">
                      {[
                        { label: "SentenceTransformers", dot: "#3B82F6" },
                        { label: "Local Ollama LLMs (Qwen3)", dot: "#10B981" },
                        { label: "PyMuPDF", dot: "#F59E0B" },
                        { label: "Vector Search", dot: "#8B5CF6" },
                        { label: "React + Three.js", dot: "#06B6D4" },
                        { label: "Node.js", dot: "#22C55E" },
                        { label: "Docker", dot: "#0EA5E9" },
                        { label: "MongoDB", dot: "#EF4444" },
                      ].map((t) => (
                        <div key={t.label} className="tech-pill flex items-center gap-1.5 px-3 py-1.5 bg-white border border-[rgba(55,50,47,0.10)] rounded-full shadow-[0_1px_3px_rgba(55,50,47,0.06)]">
                          <div style={{ width: 6, height: 6, borderRadius: "50%", background: t.dot, flexShrink: 0 }} />
                          <span className="text-[#37322F] text-[12px] font-medium font-sans leading-none">{t.label}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="w-4 sm:w-6 md:w-8 lg:w-12 self-stretch relative overflow-hidden">
                    <div className="w-[120px] sm:w-[140px] md:w-[162px] left-[-40px] sm:left-[-50px] md:left-[-58px] top-[-120px] absolute flex flex-col justify-start items-start">
                      {Array.from({ length: 50 }).map((_, i) => (
                        <div
                          key={i}
                          className="self-stretch h-3 sm:h-4 rotate-[-45deg] origin-top-left outline outline-[0.5px] outline-[rgba(3,7,18,0.08)] outline-offset-[-0.25px]"
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Bento Grid Section */}
              <div className="w-full border-b border-[rgba(55,50,47,0.12)] flex flex-col justify-center items-center">
                {/* Header */}
                <div className="self-stretch px-4 sm:px-6 md:px-8 lg:px-0 lg:max-w-[1280px] lg:w-[1280px] py-8 sm:py-12 md:py-16 border-b border-[rgba(55,50,47,0.12)] flex justify-center items-center gap-6">
                  <div className="w-full max-w-[616px] lg:w-[616px] px-4 sm:px-6 py-4 sm:py-5 shadow-[0px_2px_4px_rgba(50,45,43,0.06)] overflow-hidden rounded-lg flex flex-col justify-start items-center gap-3 sm:gap-4 shadow-none">
                    <Badge
                      icon={
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <rect x="1" y="1" width="4" height="4" stroke="#37322F" strokeWidth="1" fill="none" />
                          <rect x="7" y="1" width="4" height="4" stroke="#37322F" strokeWidth="1" fill="none" />
                          <rect x="1" y="7" width="4" height="4" stroke="#37322F" strokeWidth="1" fill="none" />
                          <rect x="7" y="7" width="4" height="4" stroke="#37322F" strokeWidth="1" fill="none" />
                        </svg>
                      }
                      text="Features"
                    />
                    <div className="w-full max-w-[598.06px] lg:w-[598.06px] text-center flex justify-center flex-col text-[#2A2520] text-xl sm:text-2xl md:text-3xl lg:text-5xl font-semibold leading-tight md:leading-[60px] font-sans tracking-tight">
                      Every feature built for deep research
                    </div>
                    <div className="self-stretch text-center text-[#6B6460] text-sm sm:text-[15px] font-normal leading-6 sm:leading-7 font-sans">
                      Tools that surface what matters, connect the dots,
                      <br />
                      and turn raw PDFs into actionable knowledge.
                    </div>
                  </div>
                </div>

                {/* Bento Grid */}
                <div className="self-stretch flex justify-center items-start">
                  <div className="w-4 sm:w-6 md:w-8 lg:w-12 self-stretch relative overflow-hidden">
                    <div className="w-[120px] sm:w-[140px] md:w-[162px] left-[-40px] sm:left-[-50px] md:left-[-58px] top-[-120px] absolute flex flex-col justify-start items-start">
                      {Array.from({ length: 200 }).map((_, i) => (
                        <div
                          key={i}
                          className="self-stretch h-3 sm:h-4 rotate-[-45deg] origin-top-left outline outline-[0.5px] outline-[rgba(3,7,18,0.08)] outline-offset-[-0.25px]"
                        />
                      ))}
                    </div>
                  </div>

                  <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-0 border-l border-r border-[rgba(55,50,47,0.12)]">
                    {/* Grid items */}
                    {[
                      {
                        title: "Smart PDF Highlight Mapping",
                        desc: "AI phrases are precisely mapped back to exact bounding boxes in source PDFs — every insight is fully traceable.",
                        component: PDFHighlightPreview,
                      },
                      {
                        title: "Project-Scoped RAG Chat",
                        desc: "Every answer is grounded exclusively in your project documents. No hallucinations, no out-of-scope data.",
                        component: ChatPreview,
                      },
                      {
                        title: "Auto-Extracted Insight Cards",
                        desc: "Key findings, methodologies, and limitations are automatically detected and surfaced as structured insight cards.",
                        component: InsightPreview,
                      },
                      {
                        title: "Interactive 3D Knowledge Graph",
                        desc: "Navigate auto-generated force-directed graphs of entities and their relationships across all your research documents.",
                        component: GraphPreview,
                      },
                    ].map((item, idx) => {
                      const Component = item.component
                      return (
                        <div
                          key={idx}
                          className={`bento-card border-b border-r-0 md:border-r border-[rgba(55,50,47,0.12)] p-4 sm:p-6 md:p-8 lg:p-12 flex flex-col justify-start items-start gap-4 sm:gap-6 bg-[#F7F5F3] ${idx < 2 ? "md:border-b-[0.5px]" : "md:border-t-[0.5px]"}`}
                        >
                          <div className="flex flex-col gap-2">
                            <h3 className="text-[#2A2520] text-lg sm:text-[19px] font-semibold leading-tight font-sans">
                              {item.title}
                            </h3>
                            <p className="text-[#6B6460] text-sm md:text-[15px] font-normal leading-relaxed font-sans">
                              {item.desc}
                            </p>
                          </div>
                          <div className="w-full h-[200px] sm:h-[250px] md:h-[300px] rounded-lg flex items-center justify-center overflow-hidden bg-white shadow-[0px_1px_4px_rgba(55,50,47,0.07)]">
                            <Component width="100%" height="100%" className="w-full h-full" />
                          </div>
                        </div>
                      )
                    })}
                  </div>

                  <div className="w-4 sm:w-6 md:w-8 lg:w-12 self-stretch relative overflow-hidden">
                    <div className="w-[120px] sm:w-[140px] md:w-[162px] left-[-40px] sm:left-[-50px] md:left-[-58px] top-[-120px] absolute flex flex-col justify-start items-start">
                      {Array.from({ length: 200 }).map((_, i) => (
                        <div
                          key={i}
                          className="self-stretch h-3 sm:h-4 rotate-[-45deg] origin-top-left outline outline-[0.5px] outline-[rgba(3,7,18,0.08)] outline-offset-[-0.25px]"
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Sections */}
              <HowItWorksSection />
              <FAQSection />
              <CTASection />
              <FooterSection />
          </div>
        </div>
      </div>
    </div>
  )
}