import { Routes } from '@angular/router';

/**
 * Route con của '/admin' (gắn trong app.routes.ts):
 *   { path: 'admin', canActivate: [staffGuard('admin')], children: [...ADMIN_CHAIN_ROUTES, ...] }
 */
export const ADMIN_CHAIN_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./admin-chain-shell').then((m) => m.AdminChainShell),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      { path: 'dashboard', loadComponent: () => import('./admin-dashboard').then((m) => m.AdminDashboard) },
      { path: 'products', loadComponent: () => import('./admin-products').then((m) => m.AdminProducts) },
      { path: 'system', loadComponent: () => import('./admin-system').then((m) => m.AdminSystem) },
      { path: 'oracle', loadComponent: () => import('./admin-oracle').then((m) => m.AdminOracle) },
      { path: 'payouts', loadComponent: () => import('./admin-payouts').then((m) => m.AdminPayouts) },
    ],
  },
];
