import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function UserMenu() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  // Close on outside click
  useEffect(() => {
    function onClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  if (!user) return null;

  const initials = user.email
    ? user.email[0].toUpperCase()
    : '?';

  function handleLogout() {
    logout();
    navigate('/login');
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      {/* Avatar trigger */}
      <button
        onClick={() => setOpen((v) => !v)}
        title={user.email}
        style={{
          width: 32,
          height: 32,
          borderRadius: '50%',
          border: '1.5px solid var(--border)',
          background: 'var(--surface3)',
          color: 'var(--accent)',
          fontWeight: 700,
          fontSize: 13,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          letterSpacing: '-0.01em',
          transition: 'border-color 0.15s',
          outline: 'none',
          flexShrink: 0,
        }}
        onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
        onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
      >
        {initials}
      </button>

      {/* Dropdown */}
      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            right: 0,
            minWidth: 210,
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 12,
            boxShadow: '0 8px 24px rgba(55,50,47,0.12)',
            zIndex: 200,
            overflow: 'hidden',
          }}
        >
          {/* Profile header */}
          <div
            style={{
              padding: '12px 14px',
              borderBottom: '1px solid var(--border)',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
            }}
          >
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: '50%',
                background: 'var(--accent)',
                color: '#fff',
                fontWeight: 700,
                fontSize: 14,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              {initials}
            </div>
            <div style={{ overflow: 'hidden' }}>
              <p
                style={{
                  margin: 0,
                  fontSize: 13,
                  fontWeight: 600,
                  color: 'var(--accent)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  maxWidth: 148,
                }}
              >
                {user.email}
              </p>
              <p style={{ margin: 0, fontSize: 11, color: 'var(--text-dim)', marginTop: 1 }}>Signed in</p>
            </div>
          </div>

          {/* Logout */}
          <button
            onClick={handleLogout}
            style={{
              width: '100%',
              padding: '10px 14px',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 9,
              fontSize: 13,
              fontWeight: 500,
              color: '#B91C1C',
              textAlign: 'left',
              transition: 'background 0.12s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = '#FEF2F2')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
          >
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M18 15l3-3m0 0l-3-3m3 3H9" />
            </svg>
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
