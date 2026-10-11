import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import ProjectPage from './pages/ProjectPage';
import DocumentViewer from './pages/DocumentViewer';
import SourceUnits from './pages/SourceUnits';
import LandingPage from './pages/Landing';
import CodePage from './pages/CodePage';
import PaperDetail from './pages/PaperDetail';
import SignUp from './pages/SignUp';
import SignIn from './pages/SignIn';
import ScrollToTop from './components/ScrollToTop';
import ProtectedRoute from './components/ProtectedRoute';
import { AuthProvider } from './context/AuthContext';
import './App.css';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <ScrollToTop />
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/landing" element={<LandingPage />} />
          <Route path="/signup" element={<SignUp />} />
          <Route path="/login" element={<SignIn />} />
          <Route path="/app" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
          <Route path="/code" element={<ProtectedRoute><CodePage /></ProtectedRoute>} />
          <Route path="/code/:slug" element={<ProtectedRoute><PaperDetail /></ProtectedRoute>} />
          <Route path="/projects/:projectId" element={<ProtectedRoute><ProjectPage /></ProtectedRoute>} />
          <Route path="/projects/:projectId/documents/:documentId" element={<ProtectedRoute><DocumentViewer /></ProtectedRoute>} />
          <Route path="/projects/:projectId/documents/:documentId/units" element={<ProtectedRoute><SourceUnits /></ProtectedRoute>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
