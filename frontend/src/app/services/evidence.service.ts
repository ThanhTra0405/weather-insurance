import { Injectable, inject } from '@angular/core';
import { ApiError, ApiService } from './api.service';

export interface EvidenceFiles {
  selfie: File;
  field: File;
  document: File;
}

export interface GpsInfo {
  lat: number;
  lng: number;
  accuracy: number;
}

@Injectable({ providedIn: 'root' })
export class EvidenceService {
  private readonly api = inject(ApiService);

  async sha256(file: File): Promise<string> {
    if (!crypto?.subtle) throw new Error('Cần mở trang bằng HTTPS (hoặc localhost) để băm ảnh');
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    const hex = Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    return '0x' + hex;
  }

  /** Gửi 3 ảnh + toạ độ lên backend (cần đăng nhập nông dân). Chủ policy do server lấy từ JWT. */
  async upload(policyId: bigint, files: EvidenceFiles, gps: GpsInfo, holder: string): Promise<void> {
    const form = new FormData();
    form.append('holder', holder); // server bỏ qua, giữ để tương thích
    form.append('lat', String(gps.lat));
    form.append('lng', String(gps.lng));
    form.append('accuracy', String(gps.accuracy));
    form.append('selfie', files.selfie);
    form.append('field', files.field);
    form.append('document', files.document);

    try {
      await this.api.postForm(`/api/evidence/${policyId}`, form);
    } catch (e) {
      throw new Error(e instanceof ApiError && e.message ? e.message : 'Tải ảnh lên máy chủ thất bại');
    }
  }
}
