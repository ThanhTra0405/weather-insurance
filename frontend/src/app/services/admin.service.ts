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

export interface EvidenceMeta {
  declaredLat: number;
  declaredLng: number;
  gpsAccuracy: number;
  exifGpsPresent: boolean;
  exifLat: number | null;
  exifLng: number | null;
  distanceMeters: number | null;
  fieldPhotoHash: string;
  documentHash: string;
}

export type EvidenceKind = 'selfie' | 'field' | 'document';

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

  private checkAuth(res: Response): void {
    if (res.status === 401 || res.status === 403) {
      this.logout();
      throw new Error('Admin key không đúng');
    }
  }

  async getPendingPolicies(): Promise<PendingPolicy[]> {
    const res = await fetch(`${this.baseUrl}/api/admin/pending-policies`, {
      headers: this.headers(),
    });
    this.checkAuth(res);
    if (!res.ok) throw new Error('Không lấy được danh sách hồ sơ chờ duyệt');
    return res.json();
  }

  async reviewPolicy(policyId: number, approved: boolean): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/admin/review/${policyId}`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ approved }),
    });
    this.checkAuth(res);
    if (!res.ok) throw new Error('Duyệt policy thất bại');
  }

  async getEvidenceMeta(policyId: number): Promise<EvidenceMeta | null> {
    const res = await fetch(`${this.baseUrl}/api/evidence/${policyId}/meta`, {
      headers: this.headers(),
    });
    this.checkAuth(res);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error('Không lấy được thông tin hồ sơ');
    return res.json();
  }

  /** Trả về blob URL (gửi key qua header, không để key lên URL) */
  async getEvidenceImage(policyId: number, kind: EvidenceKind): Promise<string> {
    const res = await fetch(`${this.baseUrl}/api/evidence/${policyId}/${kind}`, {
      headers: { 'X-Admin-Key': this.apiKey() ?? '' },
    });
    this.checkAuth(res);
    if (!res.ok) throw new Error(`Không tải được ảnh ${kind}`);
    return URL.createObjectURL(await res.blob());
  }
}