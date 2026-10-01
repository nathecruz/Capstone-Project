import type { ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Layout, NAV } from './components/Layout';
import { Spinner, ToastProvider } from './components/ui';
import { AuthProvider, useAuth } from './lib/auth';
import type { Permission } from './lib/types';
import { AnalyticsPage } from './pages/Analytics';
import { AuditLogPage } from './pages/AuditLog';
import { CategoriesPage } from './pages/Categories';
import { LoginPage } from './pages/Login';
import { NotificationsPage } from './pages/Notifications';
import { OverviewPage } from './pages/Overview';
import { RegisterPage } from './pages/Register';
import { SettingsPage } from './pages/Settings';
import { SupportPage } from './pages/Support';
import { UserDetailPage } from './pages/UserDetail';
import { UsersPage } from './pages/Users';

function Guard({ permission, children }: { permission?: Permission; children: ReactNode }) {
  const { can } = useAuth();
  if (permission && !can(permission)) {
    const fallback = NAV.find((item) => !item.permission || can(item.permission));
    return <Navigate to={fallback?.to ?? '/settings'} replace />;
  }
  return <>{children}</>;
}

function AppRoutes() {
  const { admin, checking } = useAuth();
  if (checking) return <div className="flex min-h-screen items-center justify-center bg-page"><Spinner label="Loading the Admin Panel" /></div>;
  if (!admin) {
    return (
      <Routes>
        <Route path="register" element={<RegisterPage />} />
        <Route path="*" element={<LoginPage />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Guard permission="dashboard:view"><OverviewPage /></Guard>} />
        <Route path="analytics" element={<Guard permission="analytics:view"><AnalyticsPage /></Guard>} />
        <Route path="users" element={<Guard permission="users:view"><UsersPage /></Guard>} />
        <Route path="users/:id" element={<Guard permission="users:view"><UserDetailPage /></Guard>} />
        <Route path="categories" element={<Guard permission="categories:view"><CategoriesPage /></Guard>} />
        <Route path="notifications" element={<Guard permission="notifications:view"><NotificationsPage /></Guard>} />
        <Route path="support" element={<Guard permission="support:view"><SupportPage /></Guard>} />
        <Route path="audit" element={<Guard permission="audit:view"><AuditLogPage /></Guard>} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
