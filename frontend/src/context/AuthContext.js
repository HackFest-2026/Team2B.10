import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import axios from 'axios';

const AuthContext = createContext(null);

const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:5001/api';

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Restore session on mount
  useEffect(() => {
    const token = localStorage.getItem('token');
    const stored = localStorage.getItem('user');
    if (token && stored) {
      setUser(JSON.parse(stored));
      // Refresh clearance and other server-side attributes; ignore failures (offline, expired token).
      axios
        .get(`${API_BASE}/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
        .then(({ data }) => {
          localStorage.setItem('user', JSON.stringify(data.user));
          setUser(data.user);
        })
        .catch(() => {});
    }
    setLoading(false);
  }, []);

  const signup = useCallback(async (email, password) => {
    const { data } = await axios.post(`${API_BASE}/auth/signup`, { email, password });
    localStorage.setItem('token', data.token);
    localStorage.setItem('user', JSON.stringify(data.user));
    setUser(data.user);
    return data;
  }, []);

  const login = useCallback(async (email, password) => {
    const { data } = await axios.post(`${API_BASE}/auth/login`, { email, password });
    localStorage.setItem('token', data.token);
    localStorage.setItem('user', JSON.stringify(data.user));
    setUser(data.user);
    return data;
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, signup, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
