import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { SignupPage } from './pages/SignupPage';
import { AcceptInvitePage } from './pages/AcceptInvitePage';
import { DashboardPage } from './pages/DashboardPage';
import { EmployeesPage } from './pages/EmployeesPage';
import { ClientsPage } from './pages/ClientsPage';
import { ManagerialPage } from './pages/ManagerialPage';
import { ManagerPage } from './pages/ManagerPage';
import { HrPage } from './pages/HrPage';
import { HrClassicPage } from './pages/HrClassicPage';
import { PlatformOverview } from './pages/platform/PlatformOverview';
import { PlatformOrganizations } from './pages/platform/PlatformOrganizations';
import { PlatformOrgDetail } from './pages/platform/PlatformOrgDetail';
import { PlatformTeam } from './pages/platform/PlatformTeam';

// Who may open which area. Kept next to the routes so it's obvious at a glance.
const tenantStaff = (a) => !a.isPlatform;
const managerArea = (a) => !a.isPlatform && (a.isManager || a.isOrgAdmin);
const pipelineArea = (a) => !a.isPlatform && (a.isHr || a.isManager || a.isOrgAdmin);
const orgAdminOnly = (a) => !a.isPlatform && a.isOrgAdmin;
const platformOnly = (a) => a.isPlatform;
const platformOwnerOnly = (a) => a.isPlatformOwner;

function guard(element, allow) {
  return <ProtectedRoute allow={allow}>{element}</ProtectedRoute>;
}

// "/" -> each role's own home (see lib/roles.js homePathFor).
function HomeRedirect() {
  const { initializing, isAuthenticated, homePath } = useAuth();
  if (initializing) return null;
  return <Navigate to={isAuthenticated ? homePath : '/login'} replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/login/:orgSlug" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
          {/* Target of the link in the invitation email (backend templates/invitation.js) */}
          <Route path="/accept-invite" element={<AcceptInvitePage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/register/:orgSlug" element={<RegisterPage />} />

          {/* Platform console */}
          <Route path="/platform" element={guard(<PlatformOverview />, platformOnly)} />
          <Route path="/platform/organizations" element={guard(<PlatformOrganizations />, platformOnly)} />
          <Route path="/platform/organizations/:id" element={guard(<PlatformOrgDetail />, platformOnly)} />
          <Route path="/platform/team" element={guard(<PlatformTeam />, platformOwnerOnly)} />

          {/* Tenant workbenches */}
          <Route path="/dashboard" element={guard(<DashboardPage />, orgAdminOnly)} />
          <Route path="/manager" element={guard(<ManagerPage />, managerArea)} />
          <Route path="/hr" element={guard(<HrPage />, pipelineArea)} />
          <Route path="/hr/classic" element={guard(<HrClassicPage />, pipelineArea)} />
          <Route path="/clients" element={guard(<ClientsPage />, tenantStaff)} />
          <Route path="/employees" element={guard(<EmployeesPage />, managerArea)} />
          <Route path="/managerial" element={guard(<ManagerialPage />, managerArea)} />

          <Route path="/" element={<HomeRedirect />} />
          <Route path="*" element={<HomeRedirect />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
