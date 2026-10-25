import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { ApiError } from './api/client';
import { AuthProvider } from './auth/AuthContext';
import { Layout } from './components/Layout';
import { AdminIndex, AdminLayout, RequirePermission } from './pages/admin/AdminLayout';
import { GroupsAdmin } from './pages/admin/GroupsAdmin';
import { LayoutAdmin } from './pages/admin/LayoutAdmin';
import { RoutingAdmin } from './pages/admin/RoutingAdmin';
import { SlaAdmin } from './pages/admin/SlaAdmin';
import { MacrosAdmin } from './pages/admin/MacrosAdmin';
import { PriorityAdmin } from './pages/admin/PriorityAdmin';
import { QualificationAdmin } from './pages/admin/QualificationAdmin';
import { TagsAdmin } from './pages/admin/TagsAdmin';
import { UsersAdmin } from './pages/admin/UsersAdmin';
import { ViewsAdmin } from './pages/admin/ViewsAdmin';
import { BookingPage } from './pages/BookingPage';
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
      <Route path="/book/:token" element={<BookingPage />} />
      <Route element={<Layout />}>
        <Route path="/tickets" element={<TicketListPage />} />
        <Route path="/tickets/new" element={<TicketNewPage />} />
        <Route path="/tickets/:id" element={<TicketDetailPage />} />
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<AdminIndex />} />
          <Route path="users" element={<RequirePermission permission="user:manage"><UsersAdmin /></RequirePermission>} />
          <Route path="groups" element={<RequirePermission permission="settings:manage"><GroupsAdmin /></RequirePermission>} />
          <Route path="routing" element={<RequirePermission permission="settings:manage"><RoutingAdmin /></RequirePermission>} />
          <Route path="sla" element={<RequirePermission permission="settings:manage"><SlaAdmin /></RequirePermission>} />
          <Route path="qualification" element={<RequirePermission permission="settings:manage"><QualificationAdmin /></RequirePermission>} />
          <Route path="priority" element={<RequirePermission permission="settings:manage"><PriorityAdmin /></RequirePermission>} />
          <Route path="tags" element={<RequirePermission permission="settings:manage"><TagsAdmin /></RequirePermission>} />
          <Route path="layout" element={<RequirePermission permission="settings:manage"><LayoutAdmin /></RequirePermission>} />
          <Route path="views" element={<RequirePermission permission="settings:manage"><ViewsAdmin /></RequirePermission>} />
          <Route path="macros" element={<RequirePermission permission="settings:manage"><MacrosAdmin /></RequirePermission>} />
        </Route>
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
