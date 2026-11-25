import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import { Spinner } from './components/ui';
import { get, setToken, setUnauthorizedHandler } from './lib/api';
import { connectRealtime } from './lib/realtime';
import AgentsPage from './pages/Agents';
import DashboardPage from './pages/Dashboard';
import CommunicationPage from './pages/Communication';
import FilesPage from './pages/Files';
import LoginPage from './pages/Login';
import OfficePage from './pages/Office';
import ProjectsPage from './pages/Projects';
import SettingsPage from './pages/Settings';
import TasksPage from './pages/Tasks';
import UsagePage from './pages/Usage';

export default function App() {
  const qc = useQueryClient();
  const [authVersion, setAuthVersion] = useState(0);
  const status = useQuery({
    queryKey: ['auth-status', authVersion],
    queryFn: () => get<{ setupRequired: boolean; user: { id: string; username: string } | null }>('/auth/status'),
    staleTime: Infinity,
  });

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setToken(null);
      setAuthVersion((v) => v + 1);
    });
  }, []);

  const user = status.data?.user;
  useEffect(() => {
    if (!user) return;
    return connectRealtime(qc);
  }, [user, qc]);

  if (status.isLoading)
    return (
      <div className="flex h-full items-center justify-center text-slate-400">
        <Spinner className="h-6 w-6" />
      </div>
    );
  if (status.isError)
    return <div className="flex h-full items-center justify-center text-rose-300">Cannot reach the server: {(status.error as Error).message}</div>;

  if (!user)
    return (
      <LoginPage
        setupRequired={!!status.data?.setupRequired}
        onAuthenticated={(token) => {
          setToken(token);
          qc.clear();
          setAuthVersion((v) => v + 1);
        }}
      />
    );

  return (
    <Layout
      user={user}
      onLogout={() => {
        setToken(null);
        qc.clear();
        setAuthVersion((v) => v + 1);
      }}
    >
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/office" element={<OfficePage />} />
        <Route path="/agents" element={<AgentsPage />} />
        <Route path="/tasks" element={<TasksPage />} />
        <Route path="/communication" element={<CommunicationPage />} />
        <Route path="/usage" element={<UsagePage />} />
        <Route path="/projects" element={<ProjectsPage />} />
        <Route path="/files" element={<FilesPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
