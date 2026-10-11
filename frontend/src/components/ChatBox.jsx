import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import ChatAnswer, { historyFrom } from './ChatAnswer';
import { sendChat } from '../api';
import ChatScope, { defaultScope, scopeDocumentIds } from './ChatScope';

export default function ChatBox({ projectId, projectName, documents = [] }) {
  const navigate = useNavigate();
  const [scope, setScope] = useState(defaultScope());
  const intro = () => [{
    role: 'assistant',
    intro: true,
    content: `Hi! I'm your research assistant for **${projectName}**. Ask me anything about the documents in this project, and follow up: I remember this conversation.`,
  }];
  const [messages, setMessages] = useState(intro);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const send = async () => {
    const q = input.trim();
    if (!q || loading) return;
    setInput('');
    const history = historyFrom(messages); // the conversation so far: lets a follow-up like "and its results?" be understood
    setMessages((prev) => [...prev, { role: 'user', content: q }]);
    setLoading(true);

    try {
      const { data } = await sendChat(projectId, { message: q, documentIds: scopeDocumentIds(scope), history });
      setMessages((prev) => [
        ...prev,
        {
          id: `${Date.now()}`,
          role: 'assistant',
          content: data.answer,
          sources: data.sources,
          grounding: data.grounding,
          rewritten: data.rewritten,
          scope: data.scope,
          mode: data.mode,
        },
      ]);
    } catch (err) {
      console.error('chat send error', err);
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: `Error: ${err.message}`, isError: true },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 18,
      overflow: 'hidden',
      boxShadow: '0 4px 16px rgba(55,50,47,0.06)',
    }}>
      <div style={{
        padding: '14px 20px',
        borderBottom: '1px solid var(--border)',
        background: 'var(--surface)',
        fontWeight: 700,
        fontSize: 13,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        color: 'var(--text)',
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
      }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--accent)', opacity: 0.7 }}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
        </svg>
        Research Assistant
        {messages.length > 1 && (
          <button type="button" className="btn btn-ghost" disabled={loading} onClick={() => setMessages(intro())}
            style={{ marginLeft: 'auto', fontSize: 11, padding: '2px 9px', textTransform: 'none', letterSpacing: 0 }} title="Start a fresh conversation">
            New chat
          </button>
        )}
      </div>

      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}>
        {messages.map((msg, i) => (
          <div key={i} style={{
            display: 'flex',
            justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
          }}>
            <div style={{
              maxWidth: '92%',
              padding: '12px 14px',
              borderRadius: 14,
              fontSize: 14,
              lineHeight: 1.65,
              background: msg.role === 'user'
                ? 'var(--accent)'
                : msg.isError
                  ? 'rgba(192,57,43,0.07)'
                  : 'var(--surface2)',
              color: msg.role === 'user' ? '#ffffff' : (msg.isError ? 'var(--error)' : 'var(--text)'),
              border: msg.role === 'assistant' && !msg.isError ? '1px solid var(--border)' : 'none',
            }}>
              {msg.role === 'user' ? (
                <div style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</div>
              ) : (
                <ChatAnswer msg={msg} onOpenSource={(src) => navigate(`/projects/${projectId}/documents/${src.documentId}`)} />
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', color: 'var(--text-dim)', fontSize: 14 }}>
            <div className="spinner" /> Thinking...
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div style={{
        padding: '10px 14px 13px',
        borderTop: '1px solid var(--border)',
        background: 'var(--surface)',
      }}>
        <ChatScope documents={documents} scope={scope} onChange={setScope} disabled={loading} />
        <div style={{ display: 'flex', gap: 10 }}>
        <input
          className="input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && send()}
          placeholder="Ask about your documents..."
          disabled={loading}
        />
        <button
          className="btn btn-primary"
          onClick={send}
          disabled={loading || !input.trim()}
          style={{ flexShrink: 0 }}
        >
          Send
        </button>
        </div>
      </div>
    </div>
  );
}