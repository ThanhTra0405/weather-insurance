/** Gói bảo hiểm (GET /api/products, SPEC-00 mục 4.3). Số tiền là chuỗi wei. */
export interface ProductDto {
  productId: number;
  name: string;
  perilType: number;
  threshold: string;
  thresholdDisplay: string;
  durationDays: number;
  premiumWei: string;
  coverageWei: string;
  active: boolean;
}

/** Một dòng trong danh sách policy của tôi. */
export interface PolicySummary {
  policyId: number;
  productId: number;
  productName: string | null;
  perilType: number;
  status: number;
  rejected: boolean;
  startTime: number;
  endTime: number;
  premiumWei: string;
  coverageWei: string;
  /** undefined = chưa biết (sẽ hỏi blockchain cho policy đang chờ xác minh). */
  hasEvidence?: boolean;
}

export type TimelineType = 'created' | 'evidence' | 'verified' | 'payout' | 'expired';

export interface TimelineEvent {
  type: TimelineType;
  time: number;
  txHash: string | null;
  data: Record<string, unknown>;
}

/** GET /api/policies/{id}. source = 'chain' khi backend chưa có endpoint và dữ liệu đọc thẳng từ blockchain. */
export interface PolicyDetail {
  policyId: number;
  productId: number;
  productName: string | null;
  perilType: number;
  holder: string;
  latE6: number;
  lngE6: number;
  regionId: string;
  status: number;
  startTime: number;
  endTime: number;
  premiumWei: string;
  coverageWei: string;
  rejectReason: string | null;
  timeline: TimelineEvent[];
  source: 'api' | 'chain';
}

/** GET /api/evidence/{id}/meta */
export interface EvidenceMetaDto {
  policyId: number;
  declaredLat: number;
  declaredLng: number;
  gpsAccuracy: number;
  exifGpsPresent: boolean;
  exifLat: number | null;
  exifLng: number | null;
  distanceMeters: number | null;
  selfieHash: string;
  fieldPhotoHash: string;
  documentHash: string;
  uploadedAt: string;
  locked: boolean;
}

export type EvidenceKind = 'selfie' | 'field' | 'document';

/** GET /api/notifications */
export interface NotificationDto {
  id: number;
  type: string;
  title: string;
  body: string;
  link: string | null;
  isRead: boolean;
  createdAt: string;
}

export interface NotificationPage {
  items: NotificationDto[];
  total: number;
  unread: number;
}
