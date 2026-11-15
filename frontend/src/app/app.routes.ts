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
import { SupportHome } from './pages/support-home/support-home';
import { LiquidityPage } from './pages/lp/lp';
import { ADMIN_CHAIN_ROUTES } from './pages/admin-chain/admin-chain.routes';
import { farmerGuard, guestGuard, homeRedirect, profileGuard, staffGuard } from './guards/auth.guards';

/**
 * Route của B (SPEC-B mục 9.1). Đã có: '', login, register, staff/login, staff/account, dashboard,
 * buy-policy, profile, admin, forbidden, 404.
 * Ngày 2–3 thêm: policies/:id, tickets*, notifications, wallet, support*, admin/{review,staff,audit}.
 * Đã gắn route của A: 'lp' (LiquidityPage) và ...ADMIN_CHAIN_ROUTES làm con của 'admin'.
 */
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
  { path: 'profile', canActivate: [farmerGuard], component: ProfilePage },
  { path: 'lp', canActivate: [farmerGuard], component: LiquidityPage },

  // Nhân viên
  // Tạm: hàng đợi CSKH (ngày 3) chỉ là trang giữ chỗ để đăng nhập support không gặp 404.
  { path: 'support', canActivate: [staffGuard('admin', 'support')], component: SupportHome },
  // Quản trị: /admin → /admin/dashboard (A). 'review' đặt TRƯỚC để thắng route '' của shell.
  // Tạm: 'review' vẫn là trang admin cũ; B thay bằng trang mới khi xong.
  {
    path: 'admin',
    canActivate: [staffGuard('admin')],
    children: [{ path: 'review', component: Admin }, ...ADMIN_CHAIN_ROUTES],
  },

  { path: 'forbidden', component: Forbidden },
  { path: '**', component: NotFound },
];
