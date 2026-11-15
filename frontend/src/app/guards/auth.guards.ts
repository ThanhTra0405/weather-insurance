import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { Web3Service } from '../services/web3.service';
import { Role } from '../models/auth.models';

/**
 * Route của nông dân: chưa có JWT thì chuyển /login?returnUrl= (không tự đăng nhập ngầm).
 * Có JWT nhưng ví tương ứng không còn trên máy thì xoá phiên và báo cần khôi phục ví.
 */
export const farmerGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(AuthService);
  const web3 = inject(Web3Service);
  const router = inject(Router);

  await auth.ready;

  if (!auth.isLoggedIn()) {
    return router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
  }
  if (auth.role() !== 'farmer') {
    return router.createUrlTree(['/forbidden']);
  }

  const stored = web3.storedAddress();
  if (!stored || stored.toLowerCase() !== auth.wallet()) {
    // Xoá phiên trước khi chuyển đi, nếu không guestGuard của /login sẽ đẩy ngược lại (vòng lặp).
    auth.clearSession();
    return router.createUrlTree(['/login'], {
      queryParams: { returnUrl: state.url, reason: 'restore-wallet' },
    });
  }
  return true;
};

/** Route của nhân viên. Chưa đăng nhập: /staff/login?returnUrl=. Sai vai trò (kể cả nông dân): trang 403. */
export function staffGuard(...roles: Role[]): CanActivateFn {
  return async (_route, state) => {
    const auth = inject(AuthService);
    const router = inject(Router);

    await auth.ready;

    if (!auth.isLoggedIn()) {
      return router.createUrlTree(['/staff/login'], { queryParams: { returnUrl: state.url } });
    }
    const role = auth.role();
    if (role === null || role === 'farmer' || !roles.includes(role)) {
      return router.createUrlTree(['/forbidden']);
    }
    return true;
  };
}

/** /login, /register, /staff/login: đã đăng nhập thì về trang chủ của vai trò. */
export const guestGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  await auth.ready;
  return auth.isLoggedIn() ? router.parseUrl(auth.homePath()) : true;
};

/** Hồ sơ chưa đầy đủ thì chuyển /profile?returnUrl=. Dùng sau farmerGuard. */
export const profileGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  await auth.ready;
  if (auth.role() !== 'farmer') return true;

  const profile = await auth.loadProfile().catch(() => null);
  if (!profile?.isComplete) {
    return router.createUrlTree(['/profile'], { queryParams: { returnUrl: state.url } });
  }
  return true;
};

/** Route '': chưa đăng nhập → /login; farmer → /dashboard; admin → /admin/review; support → /support. */
export const homeRedirect: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  await auth.ready;
  return router.parseUrl(auth.isLoggedIn() ? auth.homePath() : '/login');
};
