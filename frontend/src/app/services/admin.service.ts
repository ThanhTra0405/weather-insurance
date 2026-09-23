import { Injectable, signal } from '@angular/core';
import { environment } from '../../environments/environment';

export interface PendingPolicy {
  policyId: number;
  holder: string;
  lat: string;
  lng: string;
  coverageAmountWei: string;
  endTime: string;
}

@Injectable({ providedIn: 'root' })
export class AdminService {
  readonly apiKey = signal<string | null>(sessionStorage.getItem('adminApiKey'));

  private readonly baseUrl = environment.backendUrl;

  login(key: string): void {
    this.apiKey.set(key);
    sessionStorage.setItem('adminApiKey', key);
  }

  logout(): void {
    this.apiKey.set(null);
    sessionStorage.removeItem('adminApiKey');
  }

  private headers(): HeadersInit {
    return { 'X-Admin-Key': this.apiKey() ?? '', 'Content-Type': 'application/json' };
  }

  async getPendingPolicies(): Promise<PendingPolicy[]> {
    const res = await fetch(`${this.baseUrl}/api/admin/pending-policies`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error('Khong lay duoc danh sach — kiem tra admin key');
    return res.json();
  }

  async reviewPolicy(policyId: number, approved: boolean): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/admin/review/${policyId}`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ approved }),
    });
    if (!res.ok) throw new Error('Duyet policy that bai');
  }
}