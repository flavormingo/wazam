import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useSearchParams } from 'react-router';
import { useAuthStore } from './stores/auth';
import { LoginPage, safeNext } from './pages/LoginPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { InvitePage } from './pages/InvitePage';
import { MainLayout } from './pages/MainLayout';
import { Toaster } from './components/Toaster';
import { Lightbox } from './components/Lightbox';
import { WormMark } from './components/WormMark';

function LoginRoute() {
  const user = useAuthStore((s) => s.user);
  const [params] = useSearchParams();
  return user ? <Navigate to={safeNext(params.get('next')) ?? '/'} replace /> : <LoginPage />;
}

export function App() {
  const { user, loading, fetchUser } = useAuthStore();

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="loading-brand">
          <WormMark size={96} className="breathing" />
          <span className="wordmark">wazam</span>
        </div>
      </div>
    );
  }

  return (
    <>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginRoute />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/invite/:code" element={<InvitePage />} />
          <Route path="/*" element={user ? <MainLayout /> : <Navigate to="/login" />} />
        </Routes>
      </BrowserRouter>
      <Toaster />
      <Lightbox />
    </>
  );
}
