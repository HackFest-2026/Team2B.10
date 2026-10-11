import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function SignIn() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      navigate('/app');
    } catch (err) {
      setError(err?.response?.data?.error || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  return (
    <section style={styles.page}>
      <div style={styles.card}>
        {/* Logo / Brand */}
        <div style={styles.header}>
          <Link to="/" aria-label="go home" style={styles.logoLink}>
            <span style={styles.logo}>Mirage</span>
          </Link>
          <h1 style={styles.title}>Sign in</h1>
          <p style={styles.subtitle}>Welcome back</p>
        </div>

        <form onSubmit={handleSubmit} style={styles.form}>
          {error && <div style={styles.errorBox}>{error}</div>}

          <div style={styles.field}>
            <label htmlFor="email" style={styles.label}>Email</label>
            <input
              type="email"
              id="email"
              name="email"
              placeholder="you@example.com"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={styles.input}
              onFocus={(e) => { e.target.style.borderColor = 'var(--accent)'; e.target.style.boxShadow = '0 0 0 3px var(--accent-dim)'; }}
              onBlur={(e) => { e.target.style.borderColor = 'var(--border)'; e.target.style.boxShadow = 'none'; }}
            />
          </div>

          <div style={styles.field}>
            <label htmlFor="password" style={styles.label}>Password</label>
            <input
              type="password"
              id="password"
              name="password"
              placeholder="Your password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={styles.input}
              onFocus={(e) => { e.target.style.borderColor = 'var(--accent)'; e.target.style.boxShadow = '0 0 0 3px var(--accent-dim)'; }}
              onBlur={(e) => { e.target.style.borderColor = 'var(--border)'; e.target.style.boxShadow = 'none'; }}
            />
          </div>

          <button type="submit" disabled={loading} style={{ ...styles.btn, ...(loading ? styles.btnDisabled : {}) }}>
            {loading ? 'Signing in…' : 'Continue'}
          </button>
        </form>

        <p style={styles.footer}>
          Don&apos;t have an account?{' '}
          <Link to="/signup" style={styles.link}>Sign up</Link>
        </p>
      </div>
    </section>
  );
}

const styles = {
  page: {
    minHeight: '100vh',
    background: 'var(--bg)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '2rem 1rem',
  },
  card: {
    width: '100%',
    maxWidth: 360,
  },
  header: {
    textAlign: 'center',
    marginBottom: '2.5rem',
  },
  logoLink: {
    textDecoration: 'none',
    display: 'inline-block',
    marginBottom: '0.75rem',
  },
  logo: {
    fontFamily: 'var(--font-display)',
    fontSize: '1.5rem',
    color: 'var(--accent)',
    letterSpacing: '-0.02em',
  },
  title: {
    fontFamily: 'var(--font-display)',
    fontSize: '2.25rem',
    fontWeight: 500,
    color: 'var(--accent)',
    margin: '0.25rem 0 0.5rem',
    lineHeight: 1.1,
  },
  subtitle: {
    fontSize: '0.875rem',
    color: 'var(--text-muted, #7a6e68)',
    margin: 0,
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem',
  },
  errorBox: {
    background: '#FEE2E2',
    border: '1px solid #FCA5A5',
    color: '#B91C1C',
    borderRadius: 8,
    padding: '0.625rem 0.875rem',
    fontSize: '0.875rem',
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.375rem',
  },
  label: {
    fontSize: '0.875rem',
    fontWeight: 500,
    color: 'var(--accent)',
  },
  input: {
    width: '100%',
    padding: '0.625rem 0.875rem',
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: 'var(--surface)',
    color: 'var(--accent)',
    fontSize: '0.9375rem',
    outline: 'none',
    transition: 'border-color 0.15s, box-shadow 0.15s',
    boxSizing: 'border-box',
  },
  btn: {
    width: '100%',
    padding: '0.6875rem 1rem',
    background: 'var(--accent)',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    fontSize: '0.9375rem',
    fontWeight: 600,
    cursor: 'pointer',
    marginTop: '0.5rem',
    transition: 'opacity 0.15s',
  },
  btnDisabled: {
    opacity: 0.6,
    cursor: 'not-allowed',
  },
  footer: {
    textAlign: 'center',
    marginTop: '1.5rem',
    fontSize: '0.875rem',
    color: 'var(--text-muted, #7a6e68)',
  },
  link: {
    color: 'var(--accent)',
    fontWeight: 500,
    textDecoration: 'none',
  },
};
