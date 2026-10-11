import React, { useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph3D from 'react-force-graph-3d';
import SpriteText from 'three-spritetext';
import * as THREE from 'three';
import { getProjectKnowledgeGraph, getEntityGraph } from '../api';
import './KnowledgeGraph3D.css';

const TYPE_COLORS = {
  document: '#22d3ee',
  claim: '#8b5cf6',
  evidence: '#f59e0b',
  entity: '#34d399',
  conflict: '#ef4444',
};

const LINK_COLORS = {
  mentions: 'rgba(34, 211, 238, 0.56)',
  supports: 'rgba(245, 158, 11, 0.62)',
  agrees: 'rgba(16, 185, 129, 0.64)',
  contradicts: 'rgba(239, 68, 68, 0.68)',
  mentioned_in: 'rgba(52, 211, 153, 0.45)',
};

function nodeSummary(node) {
  if (!node) return 'Click a node to inspect details.';
  if (node.type === 'document') return 'Document node that contains related claims from extracted insights.';
  if (node.type === 'evidence') return `Evidence snippet that supports a claim.`;
  if (node.type === 'entity') return `${node.entityType} entity${node.aliases?.length > 1 ? ' · also written: ' + node.aliases.slice(0, 6).join(', ') : ''}`;
  if (node.type === 'conflict') return 'Two sources disagree about this. Review it in the Analysis tab.';
  const claimDetails = [
    node.consensusState ? `state: ${node.consensusState}` : null,
    node.polarity ? `polarity: ${node.polarity}` : null,
    node.pageNumber ? `page: ${node.pageNumber}` : null,
  ].filter(Boolean);
  return `Claim node · ${claimDetails.join(' · ')}`;
}

function edgeCurve(link) {
  const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
  const targetId = typeof link.target === 'object' ? link.target.id : link.target;
  const seed = `${sourceId || ''}:${targetId || ''}`;
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = ((hash << 5) - hash) + seed.charCodeAt(i);
    hash |= 0;
  }
  const direction = hash % 2 === 0 ? 1 : -1;
  if (link.type === 'mentions') return 0.06 * direction;
  if (link.type === 'supports') return 0.09 * direction;
  if (link.type === 'agrees') return 0.12 * direction;
  return 0.15 * direction;
}

function relationSummary(link) {
  if (!link) return 'Select a relation to view why two nodes are connected.';
  if (link.type === 'mentioned_in') return `Entity mentioned ${link.weight} time${link.weight > 1 ? 's' : ''} in this document`;
  if (link.type === 'contradicts' && link.explanation?.snippet) return `Conflicting sources: ${link.explanation.snippet}`;
  if (link.type === 'mentions') {
    return `Document mentions this claim (page ${link.explanation?.pageNumber || '-'})`;
  }
  if (link.type === 'supports') {
    return `Evidence snippet supports the selected claim (page ${link.explanation?.pageNumber || '-'})`;
  }
  if (link.type === 'agrees' || link.type === 'contradicts') {
    const sim = link.explanation?.topicalSimilarity;
    const similarityPart = sim ? `Topic overlap ${Math.round(sim * 100)}%` : 'Topic overlap detected';
    const sameDoc = link.explanation?.sameDocument ? ' · same document context' : '';
    return `${link.type === 'agrees' ? 'Consensus relation' : 'Conflict relation'} · ${similarityPart}${sameDoc}`;
  }
  return 'Linked relation';
}

export default function KnowledgeGraph3D({ projectId, projectName, mode = 'insights' }) {
  const fgRef = useRef(null);
  const mountRef = useRef(null);
  const [dimensions, setDimensions] = useState({ width: 900, height: 620 });
  const [graph, setGraph] = useState({ nodes: [], links: [], meta: null });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedNode, setSelectedNode] = useState(null);
  const [selectedLink, setSelectedLink] = useState(null);
  const [questionInput, setQuestionInput] = useState('');
  const [activeQuestion, setActiveQuestion] = useState('');
  const [maxClaims, setMaxClaims] = useState(18);

  useEffect(() => {
    const observer = new ResizeObserver(() => {
      if (mountRef.current) {
        setDimensions({
          width: mountRef.current.clientWidth,
          height: 620,
        });
      }
    });

    if (mountRef.current) {
      observer.observe(mountRef.current);
      setDimensions({
        width: mountRef.current.clientWidth,
        height: 620,
      });
    }

    return () => observer.disconnect();
  }, []);

  const fetchGraph = async ({ question = activeQuestion, claims = maxClaims } = {}) => {
    setLoading(true);
    setError('');
    try {
      const response = mode === 'entities'
        ? await getEntityGraph(projectId)
        : await getProjectKnowledgeGraph(projectId, { question: question || undefined, maxClaims: claims });
      const data = response.data;
      setGraph({
        nodes: data.nodes || [],
        links: data.links || [],
        meta: data.meta || null,
      });
      setSelectedNode(null);
      setSelectedLink(null);
      setActiveQuestion(question || '');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to generate knowledge graph.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchGraph({ question: '', claims: maxClaims });
  }, [projectId]);

  useEffect(() => {
    if (!fgRef.current) return;
    fgRef.current.d3Force('charge').strength(-220);
    fgRef.current.d3Force('link').distance((link) => {
      if (link.type === 'mentions') return 118;
      if (link.type === 'supports') return 102;
      return 136;
    });

    const controls = fgRef.current.controls();
    if (controls) {
      controls.autoRotate = true;
      controls.autoRotateSpeed = 0.3;
      controls.enableDamping = true;
      controls.dampingFactor = 0.06;
    }
  }, [graph.nodes.length, graph.links.length]);

  const graphData = useMemo(() => ({
    nodes: graph.nodes.map((node) => ({ ...node })),
    links: graph.links.map((link) => ({ ...link })),
  }), [graph]);

  const handleNodeClick = (node) => {
    setSelectedNode(node);
    setSelectedLink(null);
    if (!fgRef.current) return;

    const distance = 110;
    const ratio = 1 + distance / Math.hypot(node.x || 1, node.y || 1, node.z || 1);

    fgRef.current.cameraPosition(
      { x: (node.x || 1) * ratio, y: (node.y || 1) * ratio, z: (node.z || 1) * ratio },
      node,
      900,
    );
  };

  const applyQuestionFilter = () => {
    fetchGraph({ question: questionInput.trim(), claims: maxClaims });
  };

  const clearQuestionFilter = () => {
    setQuestionInput('');
    fetchGraph({ question: '', claims: maxClaims });
  };

  return (
    <div className="graph-shell">
      <div className="graph-head">
        <div>
          <p className="graph-title">{mode === 'entities' ? 'Entities & Conflicts' : 'Research Evidence Graph'}</p>
          <p className="graph-subtitle">{projectName} · {mode === 'entities' ? 'who and what appears where, and where sources disagree' : 'minimal claim/evidence map'}</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {mode !== 'entities' && (
          <div className="graph-controls">
            <input
              className="graph-input"
              placeholder="Filter by research question"
              value={questionInput}
              onChange={(e) => setQuestionInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') applyQuestionFilter();
              }}
            />
            <select
              className="graph-select"
              value={maxClaims}
              onChange={(e) => setMaxClaims(Number(e.target.value))}
            >
              <option value={12}>12 claims</option>
              <option value={18}>18 claims</option>
              <option value={24}>24 claims</option>
              <option value={30}>30 claims</option>
            </select>
            <button className="btn btn-ghost" onClick={applyQuestionFilter} disabled={loading}>
              Apply
            </button>
            <button className="btn btn-ghost" onClick={clearQuestionFilter} disabled={loading}>
              Reset
            </button>
          </div>
          )}
          <div className="graph-stats">
            <span className="graph-chip">{graph.meta?.documentCount || 0} docs</span>
            {mode === 'entities' ? (
              <>
                <span className="graph-chip">{graph.meta?.entityCount || 0} entities</span>
                <span className="graph-chip">{graph.meta?.conflictCount || 0} conflicts</span>
              </>
            ) : (
              <>
                <span className="graph-chip">{graph.meta?.claimCount || 0} claims</span>
                <span className="graph-chip">{graph.meta?.evidenceCount || 0} evidence</span>
                <span className="graph-chip">{graph.meta?.linkCount || 0} links</span>
              </>
            )}
          </div>
          <button className="btn btn-ghost" onClick={() => fetchGraph({ question: activeQuestion, claims: maxClaims })} disabled={loading}>
            {loading ? 'Refreshing…' : 'Regenerate'}
          </button>
        </div>
      </div>

      {error ? (
        <div className="graph-empty">{error}</div>
      ) : mode !== 'entities' && graphData.nodes.length > 0 && !graph.meta?.claimCount ? (
        <div className="graph-empty" data-testid="graph-no-claims">Claims and evidence come from AI insights of PDFs and scans; this project has none yet. In the Workspace, use "Add highlights" on a PDF (or upload one with insight generation on) to fill this graph, or switch to Entities &amp; conflicts after running the analysis.</div>
      ) : graphData.nodes.length === 0 ? (
        <div className="graph-empty">{mode === 'entities' ? 'Run the analysis first: entities and conflicts appear here once your sources have been analysed.' : 'Upload and process at least one document to generate a knowledge graph.'}</div>
      ) : (
        <div className="graph-body">
          <div ref={mountRef} className="graph-canvas">
            <ForceGraph3D
              ref={fgRef}
              width={dimensions.width}
              height={dimensions.height}
              graphData={graphData}
              backgroundColor="rgba(0,0,0,0)"
              cooldownTicks={120}
              nodeLabel={(node) => `${node.label} (${node.type})`}
              nodeRelSize={6}
              nodeColor={(node) => TYPE_COLORS[node.type] || '#ffffff'}
              nodeVal={(node) => node.val || 5}
              nodeThreeObject={(node) => {
                const color = TYPE_COLORS[node.type] || '#ffffff';
                const radius = node.type === 'document' ? 6.2 : node.type === 'claim' ? 5.6 : 4.6;
                const group = new THREE.Group();

                const sphere = new THREE.Mesh(
                  new THREE.SphereGeometry(radius, 20, 20),
                  new THREE.MeshStandardMaterial({
                    color,
                    metalness: 0.15,
                    roughness: 0.35,
                    emissive: color,
                    emissiveIntensity: 0.16,
                  }),
                );

                const label = new SpriteText(node.label);
                label.color = '#e9ebff';
                label.textHeight = node.type === 'document' ? 4.6 : 4;
                label.backgroundColor = 'rgba(10, 11, 18, 0.62)';
                label.padding = 2;
                label.position.set(0, radius + 6, 0);

                group.add(sphere);
                group.add(label);
                return group;
              }}
              linkColor={(link) => LINK_COLORS[link.type] || 'rgba(255,255,255,0.35)'}
              linkWidth={(link) => {
                if (link.type === 'mentions') return 0.55;
                return Math.min(1.25, 0.35 + (link.weight || 1) * 0.08);
              }}
              linkOpacity={0.92}
              linkCurvature={edgeCurve}
              linkCurveRotation={(link) => edgeCurve(link) > 0 ? 0.55 : -0.55}
              onNodeClick={handleNodeClick}
              onLinkClick={(link) => {
                setSelectedLink(link);
                setSelectedNode(null);
              }}
            />
          </div>

          <aside className="graph-sidebar">
            <p className="graph-panel-title">Node Types</p>
            <div className="graph-legend-item">
              <span className="graph-dot" style={{ background: TYPE_COLORS.document }} />
              Document
            </div>
            <div className="graph-legend-item">
              <span className="graph-dot" style={{ background: TYPE_COLORS.claim }} />
              Claim
            </div>
            <div className="graph-legend-item">
              <span className="graph-dot" style={{ background: TYPE_COLORS.evidence }} />
              Evidence
            </div>
            <div className="graph-legend-item">
              <span className="graph-dot" style={{ background: TYPE_COLORS.entity }} />
              Entity
            </div>
            <div className="graph-legend-item">
              <span className="graph-dot" style={{ background: TYPE_COLORS.conflict }} />
              Conflict
            </div>

            <p className="graph-panel-title" style={{ marginTop: 18 }}>Link Types</p>
            {mode === 'entities' ? (
              <>
                <div className="graph-legend-item">Mentioned in · Entity → Document</div>
                <div className="graph-legend-item">Contradicts · Conflict → Document (red)</div>
              </>
            ) : (
              <>
                <div className="graph-legend-item">Mentions · Document → Claim</div>
                <div className="graph-legend-item">Supports · Evidence → Claim</div>
                <div className="graph-legend-item">Agrees / Contradicts · Claim ↔ Claim</div>
              </>
            )}

            {mode !== 'entities' && (
              <div className="graph-selected">
                <h4>Question Focus</h4>
                <p>{activeQuestion ? activeQuestion : 'No active question filter. Showing highest-signal claims.'}</p>
              </div>
            )}

            <div className="graph-selected">
              <h4>{selectedNode?.label || selectedLink?.type || 'Selection'}</h4>
              <p>{selectedNode ? nodeSummary(selectedNode) : relationSummary(selectedLink)}</p>
              {(selectedNode?.fullText || selectedLink?.explanation?.snippet || selectedLink?.explanation?.leftClaim) && (
                <p style={{ marginTop: 8, fontSize: 11.5 }}>
                  {selectedNode?.fullText
                    || selectedLink?.explanation?.snippet
                    || `${selectedLink?.explanation?.leftClaim || ''} ↔ ${selectedLink?.explanation?.rightClaim || ''}`}
                </p>
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
