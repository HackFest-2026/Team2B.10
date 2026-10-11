import React, { useState, useRef, useCallback } from 'react';
import { uploadDocument, uploadFile } from '../api';
import { useAuth } from '../context/AuthContext';
import { CLASSIFICATIONS, SOURCE_TYPES, extensionOf } from '../classification';
import ClassificationHelp from './ClassificationHelp';

export default function UploadArea({ projectId, onUploadComplete }) {
  const [dragging, setDragging] = useState(false);
  const [fileStates, setFileStates] = useState([]); // [{ name, status, progress, error }]
  const inputRef = useRef(null);
  const { user } = useAuth();
  const clearance = user?.clearance ?? 0;
  const [sourceType, setSourceType] = useState('report');
  const [classification, setClassification] = useState(0);
  const allowed = SOURCE_TYPES[sourceType].extensions;

  const uploading = fileStates.length > 0;

  const updateFile = (idx, patch) =>
    setFileStates((prev) => prev.map((f, i) => (i === idx ? { ...f, ...patch } : f)));

  const handleFiles = useCallback(async (files) => {
    const pdfs = Array.from(files).filter((f) => allowed.includes(extensionOf(f.name)));
    if (!pdfs.length) {
      setFileStates([{ name: `No ${allowed.map((e) => '.' + e).join(' ')} files selected`, status: 'error', progress: 0, error: 'Unsupported file type for this source type' }]);
      setTimeout(() => setFileStates([]), 3500);
      return;
    }

    // Initialise per-file state
    const initial = pdfs.map((f) => ({
      name: f.name,
      status: 'pending',  // pending | uploading | done | error
      progress: 0,
      error: null,
    }));
    setFileStates(initial);

    const errors = [];

    for (let i = 0; i < pdfs.length; i++) {
      const file = pdfs[i];
      setFileStates((prev) =>
        prev.map((f, idx) => (idx === i ? { ...f, status: 'uploading', progress: 10 } : f))
      );

      try {
        setFileStates((prev) =>
          prev.map((f, idx) => (idx === i ? { ...f, progress: 30 } : f))
        );

        const { data: { fileUrl } } = await uploadFile(file);

        setFileStates((prev) =>
          prev.map((f, idx) => (idx === i ? { ...f, progress: 70 } : f))
        );

        await uploadDocument(projectId, fileUrl, file.name, sourceType, classification);

        setFileStates((prev) =>
          prev.map((f, idx) => (idx === i ? { ...f, status: 'done', progress: 100 } : f))
        );
      } catch (err) {
        console.error(`Upload failed for ${file.name}:`, err);
        errors.push(file.name);
        setFileStates((prev) =>
          prev.map((f, idx) =>
            idx === i ? { ...f, status: 'error', error: err.message } : f
          )
        );
      }
    }

    // Notify parent once ALL files are done
    onUploadComplete && onUploadComplete();

    // Reset input so the same files can be re-selected
    if (inputRef.current) inputRef.current.value = '';

    // Clear file states after a delay so users can see the result
    setTimeout(() => setFileStates([]), 2500);
  }, [projectId, onUploadComplete, allowed, sourceType, classification]);

  const totalProgress = fileStates.length
    ? Math.round(fileStates.reduce((s, f) => s + f.progress, 0) / fileStates.length)
    : 0;

  const doneCount = fileStates.filter((f) => f.status === 'done').length;
  const errCount = fileStates.filter((f) => f.status === 'error').length;

  const selectStyle = {
    border: '1px solid var(--border)', borderRadius: 10, padding: '8px 12px', background: 'var(--surface)',
    color: 'var(--text)', fontSize: 14, fontWeight: 600, fontFamily: 'inherit',
  };

  return (
    <div>
    <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 14 }}>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>
        Source type
        <select style={selectStyle} value={sourceType} disabled={uploading} onChange={(e) => setSourceType(e.target.value)}>
          {Object.entries(SOURCE_TYPES).map(([key, t]) => <option key={key} value={key}>{t.label}</option>)}
        </select>
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>
        Classification
        <select style={selectStyle} value={classification} disabled={uploading} onChange={(e) => setClassification(Number(e.target.value))}>
          {CLASSIFICATIONS.map((name, level) => (
            <option key={name} value={level} disabled={level > clearance}>{name}{level > clearance ? ' (above your clearance)' : ''}</option>
          ))}
        </select>
      </label>
      <span style={{ fontSize: 12, color: 'var(--text-dim)', paddingBottom: 10 }}>
        Your clearance: <b>{CLASSIFICATIONS[clearance]}</b> · accepts {SOURCE_TYPES[sourceType].hint}
      </span>
    </div>
    <div style={{ marginTop: -6, marginBottom: 12 }}><ClassificationHelp clearance={clearance} /></div>
    <div
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (!uploading) handleFiles(e.dataTransfer.files);
      }}
      style={{
        border: `2px dashed ${dragging ? 'var(--accent-light)' : 'var(--border)'}`,
        borderRadius: 18,
        padding: uploading ? '28px 28px' : '48px 32px',
        textAlign: 'center',
        background: dragging ? 'var(--accent-dim)' : 'var(--surface)',
        transition: 'all 0.18s ease',
        cursor: uploading ? 'default' : 'pointer',
        boxShadow: dragging ? '0 0 0 4px rgba(55,50,47,0.08)' : '0 4px 16px rgba(55,50,47,0.05)',
      }}
    >
      {uploading ? (
        <div>
          {/* Overall progress */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
            <div className="spinner" style={{ width: 20, height: 20, flexShrink: 0 }} />
            <p style={{ color: 'var(--text)', fontSize: 15, fontWeight: 700, flex: 1, textAlign: 'left' }}>
              {fileStates.every((f) => f.status === 'error')
                ? `${errCount} file${errCount > 1 ? 's' : ''} could not be uploaded`
                : `Uploading ${fileStates.length} file${fileStates.length > 1 ? 's' : ''} — ${totalProgress}%`}
            </p>
            {doneCount > 0 && (
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--success)' }}>
                {doneCount} done
              </span>
            )}
            {errCount > 0 && (
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--error)' }}>
                {errCount} failed
              </span>
            )}
          </div>

          {/* Overall bar */}
          <div style={{
            height: 6,
            background: 'var(--surface3)',
            borderRadius: 999,
            overflow: 'hidden',
            marginBottom: 16,
          }}>
            <div style={{
              height: '100%',
              width: `${totalProgress}%`,
              background: errCount > 0 ? 'var(--warning)' : 'var(--accent)',
              borderRadius: 999,
              transition: 'width 0.3s',
            }} />
          </div>

          {/* Per-file status list */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {fileStates.map((f, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '8px 12px',
                  borderRadius: 10,
                  background: 'var(--surface2)',
                  border: '1px solid var(--border)',
                  textAlign: 'left',
                }}
              >
                {/* Icon */}
                {f.status === 'done' ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                ) : f.status === 'error' ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--error)" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                ) : f.status === 'uploading' ? (
                  <div className="spinner" style={{ width: 14, height: 14, borderWidth: 1.5 }} />
                ) : (
                  <div style={{ width: 14, height: 14, borderRadius: '50%', background: 'var(--border)', flexShrink: 0 }} />
                )}

                {/* Filename */}
                <span style={{
                  flex: 1,
                  fontSize: 13,
                  fontWeight: 600,
                  color: f.status === 'error' ? 'var(--error)' : 'var(--text)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}>
                  {f.name}
                </span>

                {/* Per-file progress or status */}
                {f.status === 'uploading' && (
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-dim)' }}>
                    {f.progress}%
                  </span>
                )}
                {f.status === 'error' && f.error && (
                  <span style={{ fontSize: 11, color: 'var(--error)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {f.error}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <>
          <div style={{ fontSize: 42, marginBottom: 16 }}>📄</div>
          <p style={{ color: 'var(--text)', fontWeight: 700, marginBottom: 10, fontSize: 20 }}>
            Drop files here
          </p>
          <p style={{ color: 'var(--text-dim)', marginBottom: 24, fontSize: 16 }}>
            or click to browse your computer
          </p>
          <label className="btn btn-ghost" style={{ cursor: 'pointer', minWidth: 160, fontSize: 16 }}>
            Browse Files
            <input
              ref={inputRef}
              type="file"
              multiple
              accept={allowed.map((e) => "." + e).join(",")}
              style={{ display: 'none' }}
              onChange={(e) => handleFiles(e.target.files)}
            />
          </label>
        </>
      )}
    </div>
    </div>
  );
}
