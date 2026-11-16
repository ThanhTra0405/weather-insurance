import { Routes } from '@angular/router';
import { BuyPolicy } from './pages/buy-policy/buy-policy';
import { Dashboard } from './pages/dashboard/dashboard';
import { Admin } from './pages/admin/admin';
import { Forbidden } from './pages/forbidden/forbidden';
import { NotFound } from './pages/not-found/not-found';
import { Login } from './pages/login/login';
import { Register } from './pages/register/register';
import { StaffLogin } from './pages/staff-login/staff-login';
import { StaffAccount } from './pages/staff-account/staff-account';
import { ProfilePage } from './pages/profile/profile';
import { PolicyDetailPage } from './pages/policy-detail/policy-detail';
import { NotificationsPage } from './pages/notifications/notifications';
import { TicketsPage } from './pages/tickets/tickets';
import { TicketNewPage } from './pages/ticket-new/ticket-new';
import { TicketDetailPage } from './pages/ticket-detail/ticket-detail';
import { SupportHome } from './pages/support-home/support-home';
import { SupportTicketPage } from './pages/support-ticket/support-ticket';
import { SupportLookupPage } from './pages/support-lookup/support-lookup';
import { SupportCannedPage } from './pages/support-canned/support-canned';
import { AdminShell } from './pages/admin-shell/admin-shell';
import { AdminStaffPage } from './pages/admin-staff/admin-staff';
import { AdminAuditPage } from './pages/admin-audit/admin-audit';
import { WalletPage } from './pages/wallet/wallet';
import { LiquidityPage } from './pages/lp/lp';
import { ADMIN_CHAIN_ROUTES } from './pages/admin-chain/admin-chain.routes';
import { farmerGuard, guestGuard, homeRedirect, profileGuard, staffGuard } from './guards/auth.guards';

/**
 * Route của B (SPEC-B mục 9.1). Ngày 3: thêm wallet, support/*, admin shell (review, staff, audit) và nối trang của A
 * (lp, admin/dashboard|products|system|oracle|payouts).
 */

/**
 * Các trang blockchain của A (dashboard, products, system, oracle, payouts). Lấy route con của ADMIN_CHAIN_ROUTES
 * và bỏ AdminChainShell (khung riêng của A) vì AdminShell của B đã có thanh bên chung.
 */
const adminChainChildren: Routes = (ADMIN_CHAIN_ROUTES[0]?.children ?? []).filter((r) => r.path !== '' && r.redirectTo === undefined);

export const routes: Routes = [
  { path: '', pathMatch: 'full', canActivate: [homeRedirect], children: [] },

  // Đăng nhập / đăng ký
  { path: 'login', canActivate: [guestGuard], component: Login },
  { path: 'register', canActivate: [guestGuard], component: Register },
  { path: 'staff/login', canActivate: [guestGuard], component: StaffLogin },
  { path: 'staff/account', canActivate: [staffGuard('admin', 'support')], component: StaffAccount },

  // Nông dân
  { path: 'dashboard', canActivate: [farmerGuard], component: Dashboard },
  { path: 'buy-policy', canActivate: [farmerGuard, profileGuard], component: BuyPolicy },
  { path: 'policies/:id', canActivate: [farmerGuard], component: PolicyDetailPage },
  { path: 'notifications', canActivate: [farmerGuard], component: NotificationsPage },
  { path: 'tickets', canActivate: [farmerGuard], component: TicketsPage },
  { path: 'tickets/new', canActivate: [farmerGuard, profileGuard], component: TicketNewPage },
  { path: 'tickets/:id', canActivate: [farmerGuard], component: TicketDetailPage },
  { path: 'profile', canActivate: [farmerGuard], component: ProfilePage },
  { path: 'wallet', canActivate: [farmerGuard], component: WalletPage },
  { path: 'lp', canActivate: [farmerGuard], component: LiquidityPage },

  // Nhân viên: CSKH (admin và support)
  { path: 'support', pathMatch: 'full', canActivate: [staffGuard('admin', 'support')], component: SupportHome },
  { path: 'support/ticket/:id', canActivate: [staffGuard('admin', 'support')], component: SupportTicketPage },
  { path: 'support/lookup', canActivate: [staffGuard('admin', 'support')], component: SupportLookupPage },
  { path: 'support/canned', canActivate: [staffGuard('admin', 'support')], component: SupportCannedPage },

  // Quản trị (chỉ admin): AdminShell có thanh bên, các trang là route con.
  {
    path: 'admin',
    canActivate: [staffGuard('admin')],
    component: AdminShell,
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'review' },
      { path: 'review', component: Admin },
      { path: 'staff', component: AdminStaffPage },
      { path: 'audit', component: AdminAuditPage },
      ...adminChainChildren,
      { path: '**', component: NotFound },
    ],
  },

  { path: 'forbidden', component: Forbidden },
  { path: '**', component: NotFound },
];
