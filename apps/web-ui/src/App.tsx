import { Navigate, Outlet, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { ConsoleProvider, useConsole } from './console/ConsoleContext';
import { CommandPortalLayout, FiPortalLayout, WalletPortalLayout } from './console/PortalLayout';
import CommandCenterPage from './console/pages/CommandCenterPage';
import ScenarioOrchestrationPage from './console/pages/ScenarioOrchestrationPage';
import WalletOpsPage from './console/pages/WalletOpsPage';
import FiConsolePage from './console/pages/FiConsolePage';
import VerifierPage from './console/pages/VerifierPage';
import IntegrationsPage from './console/pages/IntegrationsPage';
import AuditPage from './console/pages/AuditPage';
import RegistryPage from './console/pages/RegistryPage';
import WalletHomePage from './console/pages/WalletHomePage';
import WalletInboxPage from './console/pages/WalletInboxPage';
import WalletHistoryPage from './console/pages/WalletHistoryPage';
import WalletNomineesPage from './console/pages/WalletNomineesPage';
import WalletDelegationsPage from './console/pages/WalletDelegationsPage';
import FiHomePage from './console/pages/FiHomePage';
import CommandHomePage from './console/pages/CommandHomePage';
import PortalLoginPage from './console/pages/PortalLoginPage';
import WalletLoginPage from './console/pages/WalletLoginPage';
import FiLoginPage from './console/pages/FiLoginPage';
import CommandLoginPage from './console/pages/CommandLoginPage';
import { COMMAND_PORTAL_ADMIN_LOGIN_REQUIRED, DEMO_BYPASS_WALLET_LOGIN } from './console/portalFlags';

function ConsoleProviderOutlet() {
  return (
    <ConsoleProvider>
      <Outlet />
    </ConsoleProvider>
  );
}

function RequireFiPortalAuth() {
  const location = useLocation();
  const { fiAuthenticated, fiRoleGranted } = useConsole();
  const returnTo = encodeURIComponent(`${location.pathname}${location.search}${location.hash}`);
  if (!fiAuthenticated) {
    return <Navigate to={`/fi/login?next=${returnTo}`} replace />;
  }
  if (!fiRoleGranted) {
    return <Navigate to={`/fi/login?denied=fi&next=${returnTo}`} replace />;
  }
  return <Outlet />;
}

function RequireWalletPortalAuth() {
  if (DEMO_BYPASS_WALLET_LOGIN) {
    return <Outlet />;
  }
  const location = useLocation();
  const { authenticated, walletRoleGranted } = useConsole();
  const returnTo = encodeURIComponent(`${location.pathname}${location.search}${location.hash}`);
  if (!authenticated) {
    return <Navigate to={`/wallet/login?next=${returnTo}`} replace />;
  }
  if (!walletRoleGranted) {
    return <Navigate to={`/wallet/login?denied=wallet&next=${returnTo}`} replace />;
  }
  return <Outlet />;
}

function RequireCommandPortalAuth() {
  const location = useLocation();
  const { adminRoleGranted, authenticated } = useConsole();
  const returnTo = encodeURIComponent(`${location.pathname}${location.search}${location.hash}`);
  if (COMMAND_PORTAL_ADMIN_LOGIN_REQUIRED && !authenticated) {
    return <Navigate to={`/command/login?next=${returnTo}`} replace />;
  }
  if (COMMAND_PORTAL_ADMIN_LOGIN_REQUIRED && !adminRoleGranted) {
    return <Navigate to={`/command/login?denied=admin&next=${returnTo}`} replace />;
  }
  return <Outlet />;
}

function ConsoleAliasRedirect() {
  const location = useLocation();
  const params = useParams();
  const legacyPath = (params['*'] ?? '').replace(/^\/+|\/+$/g, '');
  const [firstSegment, ...remainingSegments] = legacyPath.split('/').filter(Boolean);

  let target = '/command';

  if (!legacyPath) {
    target = '/command';
  } else if (firstSegment === 'wallet') {
    const remaining = remainingSegments.join('/');
    target = remaining ? `/wallet/${remaining}` : '/wallet';
  } else if (firstSegment === 'fi') {
    const remaining = remainingSegments.join('/');
    target = remaining ? `/fi/${remaining}` : '/fi';
  } else if (firstSegment === 'login') {
    target = '/login';
  } else if (firstSegment === 'command') {
    const remaining = remainingSegments.join('/');
    target = remaining ? `/command/${remaining}` : '/command';
  } else if (firstSegment === 'scenario' || firstSegment === 'verifier' || firstSegment === 'integrations' || firstSegment === 'audit') {
    target = `/command/${legacyPath}`;
  }

  return <Navigate to={`${target}${location.search}${location.hash}`} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route element={<ConsoleProviderOutlet />}>
        <Route path="/login" element={<PortalLoginPage />} />
        <Route path="/wallet/login" element={<WalletLoginPage />} />
        <Route path="/fi/login" element={<FiLoginPage />} />
        <Route path="/command/login" element={<CommandLoginPage />} />

        <Route path="/console/*" element={<ConsoleAliasRedirect />} />

        <Route element={<RequireWalletPortalAuth />}>
          <Route path="/wallet" element={<WalletPortalLayout />}>
            <Route index element={<WalletHomePage />} />
            <Route path="inbox" element={<WalletInboxPage />} />
            <Route path="history" element={<WalletHistoryPage />} />
            <Route path="nominees" element={<WalletNomineesPage />} />
            <Route path="delegations" element={<WalletDelegationsPage />} />
            <Route path="ops" element={<WalletOpsPage mode="consents" />} />
            <Route path="delegation" element={<WalletOpsPage mode="delegation" />} />
          </Route>
        </Route>

        <Route element={<RequireCommandPortalAuth />}>
          <Route path="/command" element={<CommandPortalLayout />}>
            <Route index element={<CommandHomePage />} />
            <Route path="operations" element={<CommandCenterPage />} />
            <Route path="registry" element={<RegistryPage />} />
            <Route path="overview" element={<Navigate to="/command/operations" replace />} />
            <Route path="scenario" element={<ScenarioOrchestrationPage />} />
            <Route path="verifier" element={<VerifierPage />} />
            <Route path="integrations" element={<IntegrationsPage />} />
            <Route path="audit" element={<AuditPage />} />
          </Route>
        </Route>

        <Route element={<RequireFiPortalAuth />}>
          <Route path="/fi" element={<FiPortalLayout />}>
            <Route index element={<FiHomePage />} />
            <Route path="create" element={<FiConsolePage mode="create" />} />
            <Route path="queue" element={<FiConsolePage mode="queue" />} />
            <Route path="timeline" element={<FiConsolePage mode="timeline" />} />
            <Route path="consents" element={<Navigate to="/fi/queue" replace />} />
            <Route path="verify" element={<Navigate to="/fi/queue" replace />} />
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
