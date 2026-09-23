import { Routes } from '@angular/router';
import { BuyPolicy } from './pages/buy-policy/buy-policy';
import { Dashboard } from './pages/dashboard/dashboard';

export const routes: Routes = [
  { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
  { path: 'dashboard', component: Dashboard },
  { path: 'buy-policy', component: BuyPolicy },
];