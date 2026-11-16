import { Injectable, inject } from '@angular/core';
import { ApiError, ApiService } from './api.service';

export interface EvidenceFiles {
  selfie: File;
  field: File;
  document: File;
}

/** Kết quả POST /api/evidence/{policyId}: hash do server tính (so với hash tính cục bộ trước khi ghi lên chain). */
export interface EvidenceUploadResult {
  policyId: number;
  selfieHash: string;
  fieldPhotoHash: string;
  documentHash: string;
  exifGpsPresent: boolean;
  distanceMeters: number | null;
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
  async upload(policyId: bigint, files: EvidenceFiles, gps: GpsInfo, holder: string): Promise<EvidenceUploadResult> {
    const form = new FormData();
    form.append('holder', holder); // server bỏ qua, giữ để tương thích
    form.append('lat', String(gps.lat));
    form.append('lng', String(gps.lng));
    form.append('accuracy', String(gps.accuracy));
    form.append('selfie', files.selfie);
    form.append('field', files.field);
    form.append('document', files.document);

    try {
      return await this.api.postForm<EvidenceUploadResult>(`/api/evidence/${policyId}`, form);
    } catch (e) {
      // Giữ nguyên ApiError (message tiếng Việt của server) để nơi gọi xử lý theo status, ví dụ 409.
      if (e instanceof ApiError) throw e;
      throw new Error('Tải ảnh lên máy chủ thất bại');
    }
  }
}
