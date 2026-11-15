import { Injectable, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Observable, firstValueFrom } from 'rxjs';
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
const API_KEY_STORAGE = 'adminApiKey';

@Injectable({ providedIn: 'root' })
export class AdminService {
  private readonly http = inject(HttpClient);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  readonly apiKey = signal<string | null>(
    this.isBrowser ? sessionStorage.getItem(API_KEY_STORAGE) : null
  );

  private readonly baseUrl = environment.backendUrl;

  login(key: string): void {
    this.apiKey.set(key);
    if (this.isBrowser) sessionStorage.setItem(API_KEY_STORAGE, key);
  }

  logout(): void {
    this.apiKey.set(null);
    if (this.isBrowser) sessionStorage.removeItem(API_KEY_STORAGE);
  }

  private headers(): HttpHeaders {
    return new HttpHeaders({ 'X-Admin-Key': this.apiKey() ?? '' });
  }

  /** Gọi request, xử lý 401/403 (logout), 404 (tuỳ chọn trả null), lỗi khác -> errMsg */
  private async call<T>(obs: Observable<T>, errMsg: string, nullOn404 = false): Promise<T> {
    try {
      return await firstValueFrom(obs);
    } catch (e) {
      if (e instanceof HttpErrorResponse) {
        if (e.status === 401 || e.status === 403) {
          this.logout();
          throw new Error('Admin key không đúng');
        }
        if (e.status === 404 && nullOn404) return null as T;
      }
      throw new Error(errMsg);
    }
  }

  getPendingPolicies(): Promise<PendingPolicy[]> {
    return this.call(
      this.http.get<PendingPolicy[]>(`${this.baseUrl}/api/admin/pending-policies`, {
        headers: this.headers(),
      }),
      'Không lấy được danh sách hồ sơ chờ duyệt'
    );
  }

  async reviewPolicy(policyId: number, approved: boolean): Promise<void> {
    await this.call(
      this.http.post(
        `${this.baseUrl}/api/admin/review/${policyId}`,
        { approved },
        { headers: this.headers(), responseType: 'text' }
      ),
      'Duyệt policy thất bại'
    );
  }

  getEvidenceMeta(policyId: number): Promise<EvidenceMeta | null> {
    return this.call(
      this.http.get<EvidenceMeta | null>(`${this.baseUrl}/api/evidence/${policyId}/meta`, {
        headers: this.headers(),
      }),
      'Không lấy được thông tin hồ sơ',
      true
    );
  }

  /** Trả về blob URL (gửi key qua header, không để key lên URL) */
  async getEvidenceImage(policyId: number, kind: EvidenceKind): Promise<string> {
    const blob = await this.call(
      this.http.get(`${this.baseUrl}/api/evidence/${policyId}/${kind}`, {
        headers: this.headers(),
        responseType: 'blob',
      }),
      `Không tải được ảnh ${kind}`
    );
    return URL.createObjectURL(blob);
  }
}