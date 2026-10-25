import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { ApiError } from './api/client';
import { AuthProvider } from './auth/AuthContext';
import { Layout } from './components/Layout';
import { LoginPage } from './pages/LoginPage';
import { TicketDetailPage } from './pages/TicketDetailPage';
import { TicketListPage } from './pages/TicketListPage';
import { TicketNewPage } from './pages/TicketNewPage';

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        // Inutile de réessayer une erreur client (droits, ressource absente…).
        retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
      },
    },
  });
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<Layout />}>
        <Route path="/tickets" element={<TicketListPage />} />
        <Route path="/tickets/new" element={<TicketNewPage />} />
        <Route path="/tickets/:id" element={<TicketDetailPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/tickets" replace />} />
    </Routes>
  );
}

export function App({ queryClient = createQueryClient() }: { queryClient?: QueryClient }) {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}
