import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

/**
 * `allow` is an optional predicate over the auth context. Someone who is
 * signed in but not allowed on this page is sent to their own home rather
 * than shown a dead end (e.g. an HR user typing /platform).
 */
export function ProtectedRoute({ children, allow }) {
  const auth = useAuth();
  const location = useLocation();

  if (auth.initializing) {
    return (
      <div className="flex min-h-svh items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (!auth.isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (allow && !allow(auth)) {
    return <Navigate to={auth.homePath} replace />;
  }

  return children;
}
