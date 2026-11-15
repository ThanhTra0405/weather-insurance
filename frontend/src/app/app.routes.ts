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
import { farmerGuard, guestGuard, homeRedirect, profileGuard, staffGuard } from './guards/auth.guards';

/**
 * Route của B (SPEC-B mục 9.1). Đã có: '', login, register, staff/login, staff/account, dashboard,
 * buy-policy, profile, admin, forbidden, 404.
 * Ngày 2–3 thêm: policies/:id, tickets*, notifications, wallet, support*, admin/{review,staff,audit}.
 * TODO: gắn route của A khi A push: 'lp' (LiquidityPage) và ...ADMIN_CHAIN_ROUTES làm con của 'admin'.
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

  // Nhân viên
  // Tạm: hàng đợi CSKH (ngày 3) chỉ là trang giữ chỗ để đăng nhập support không gặp 404.
  { path: 'support', canActivate: [staffGuard('admin', 'support')], component: SupportHome },
  // Tạm: trang admin cũ. Ngày 2 viết lại thành /admin/review trong AdminShell.
  { path: 'admin/review', canActivate: [staffGuard('admin')], component: Admin },
  { path: 'admin', pathMatch: 'full', canActivate: [staffGuard('admin')], component: Admin },

  { path: 'forbidden', component: Forbidden },
  { path: '**', component: NotFound },
];
