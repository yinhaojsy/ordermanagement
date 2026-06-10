import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import type { ReactElement } from "react";
import AppLayout from "../layout/AppLayout";
import DashboardPage from "../pages/DashboardPage";
import CurrenciesPage from "../pages/CurrenciesPage";
import AccountsPage from "../pages/AccountsPage";
import TransfersPage from "../pages/TransfersPage";
import ExpensesPage from "../pages/ExpensesPage";
import CustomersPage from "../pages/CustomersPage";
import CustomerLedgerPage from "../pages/CustomerLedgerPage";
import CustomerProfilePage from "../pages/CustomerProfilePage";
import CustomerSettingsPage from "../pages/CustomerSettingsPage";
import UsersPage from "../pages/UsersPage";
import RolesPage from "../pages/RolesPage";
import TagsPage from "../pages/TagsPage";
import OrdersPage from "../pages/OrdersPage";
import LoginPage from "../pages/LoginPage";
import ForgotPasswordPage from "../pages/ForgotPasswordPage";
import ProfitCalculationPage from "../pages/ProfitCalculationPage";
import SettingsPage from "../pages/SettingsPage";
import IntegrationsPage from "../pages/IntegrationsPage";
import NotificationsPage from "../pages/NotificationsPage";
import NotificationPreferencesPage from "../pages/NotificationPreferencesPage";
import ProfilePage from "../pages/ProfilePage";
import WalletTrackerPage from "../pages/WalletTrackerPage";
import ReferenceRatesPage from "../pages/ReferenceRatesPage";
import { useAppSelector } from "../app/hooks";
import { hasSectionAccess } from "../utils/permissions";
import {
  canManageKycPolicy,
  canViewCustomerLedger,
  hasAnyCustomerKycPermission,
} from "../utils/customerPermissions";
import { hasStoredSession } from "../utils/authToken";

function RequireAuth({ children, section }: { children: ReactElement; section?: string }) {
  const user = useAppSelector((s) => s.auth.user);
  if (!user || !hasStoredSession()) {
    return <Navigate to="/login" replace />;
  }
  if (section && !hasSectionAccess(user, section)) {
    return <Navigate to="/" replace />;
  }
  return children;
}

function RequireAdmin({ children }: { children: ReactElement }) {
  const user = useAppSelector((s) => s.auth.user);
  if (!user || !hasStoredSession()) {
    return <Navigate to="/login" replace />;
  }
  if (user.role !== "admin") {
    return <Navigate to="/" replace />;
  }
  return children;
}

function RequireCustomerLedger({ children }: { children: ReactElement }) {
  const user = useAppSelector((s) => s.auth.user);
  if (!user || !hasStoredSession()) {
    return <Navigate to="/login" replace />;
  }
  if (!hasSectionAccess(user, "customers") || !canViewCustomerLedger(user)) {
    return <Navigate to="/customers" replace />;
  }
  return children;
}

function RequireCustomerKyc({ children }: { children: ReactElement }) {
  const user = useAppSelector((s) => s.auth.user);
  if (!user || !hasStoredSession()) {
    return <Navigate to="/login" replace />;
  }
  if (!hasSectionAccess(user, "customers") || !hasAnyCustomerKycPermission(user)) {
    return <Navigate to="/customers" replace />;
  }
  return children;
}

function RequireKycPolicy({ children }: { children: ReactElement }) {
  const user = useAppSelector((s) => s.auth.user);
  if (!user || !hasStoredSession()) {
    return <Navigate to="/login" replace />;
  }
  if (!hasSectionAccess(user, "customers") || !canManageKycPolicy(user)) {
    return <Navigate to="/customers" replace />;
  }
  return children;
}

export default function AppRoutes() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<RequireAuth section="dashboard"><DashboardPage /></RequireAuth>} />
          <Route path="currencies" element={<RequireAuth section="currencies"><CurrenciesPage /></RequireAuth>} />
          <Route path="accounts" element={<RequireAuth section="accounts"><AccountsPage /></RequireAuth>} />
          <Route path="transfers" element={<RequireAuth section="transfers"><TransfersPage /></RequireAuth>} />
          <Route path="expenses" element={<RequireAuth section="expenses"><ExpensesPage /></RequireAuth>} />
          <Route
            path="customers/settings"
            element={
              <RequireAuth section="customers">
                <RequireKycPolicy>
                  <CustomerSettingsPage />
                </RequireKycPolicy>
              </RequireAuth>
            }
          />
          <Route path="customers" element={<RequireAuth section="customers"><CustomersPage /></RequireAuth>} />
          <Route
            path="customers/:id/ledger"
            element={
              <RequireAuth section="customers">
                <RequireCustomerLedger>
                  <CustomerLedgerPage />
                </RequireCustomerLedger>
              </RequireAuth>
            }
          />
          <Route
            path="customers/:id/profile"
            element={
              <RequireAuth section="customers">
                <RequireCustomerKyc>
                  <CustomerProfilePage />
                </RequireCustomerKyc>
              </RequireAuth>
            }
          />
          <Route path="users" element={<RequireAuth section="users"><UsersPage /></RequireAuth>} />
          <Route path="roles" element={<RequireAuth section="roles"><RolesPage /></RequireAuth>} />
          <Route path="tags" element={<RequireAuth section="tags"><TagsPage /></RequireAuth>} />
          <Route path="orders" element={<RequireAuth section="orders"><OrdersPage /></RequireAuth>} />
          <Route path="wallets" element={<RequireAuth section="wallets"><WalletTrackerPage /></RequireAuth>} />
          <Route path="notifications" element={<RequireAuth><NotificationsPage /></RequireAuth>} />
          <Route path="notification-preferences" element={<RequireAuth><NotificationPreferencesPage /></RequireAuth>} />
          <Route path="profile" element={<RequireAuth><ProfilePage /></RequireAuth>} />
          <Route path="preferences" element={<Navigate to="/profile" replace />} />
          <Route path="profit" element={<RequireAuth section="profit"><ProfitCalculationPage /></RequireAuth>} />
          <Route
            path="reference-rates"
            element={
              <RequireAuth section="referenceRates">
                <ReferenceRatesPage />
              </RequireAuth>
            }
          />
          <Route path="settings" element={<RequireAdmin><SettingsPage /></RequireAdmin>} />
          <Route path="settings/integrations" element={<RequireAdmin><IntegrationsPage /></RequireAdmin>} />
        </Route>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}


