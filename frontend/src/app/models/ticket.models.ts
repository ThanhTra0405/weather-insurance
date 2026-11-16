export type TicketStatus = 'open' | 'in_progress' | 'waiting_customer' | 'resolved' | 'closed';
export type TicketCategory = 'review_rejected' | 'payout_missing' | 'policy_info' | 'technical' | 'other';
export type TicketPriority = 'low' | 'normal' | 'high';
export type TicketSender = 'farmer' | 'staff' | 'system';

/** Một dòng trong GET /api/tickets. */
export interface TicketListItem {
  id: number;
  policyId: number | null;
  category: TicketCategory;
  subject: string;
  status: TicketStatus;
  priority: TicketPriority;
  assignedToName: string | null;
  rating: number | null;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  lastMessagePreview: string | null;
  lastSenderType: TicketSender | null;
}

export interface TicketListResponse {
  items: TicketListItem[];
  total: number;
}

export interface TicketMessageDto {
  id: number;
  senderType: TicketSender;
  senderName: string | null;
  body: string;
  isInternal: boolean;
  createdAt: string;
}

/** GET /api/tickets/{id} (phía nông dân). */
export interface TicketDetail {
  id: number;
  policyId: number | null;
  category: TicketCategory;
  subject: string;
  status: TicketStatus;
  priority: TicketPriority;
  assignedToName: string | null;
  rating: number | null;
  ratingComment: string | null;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  messages: TicketMessageDto[];
}

export interface CreateTicketInput {
  policyId: number | null;
  category: TicketCategory;
  subject: string;
  body: string;
}

// ===== Phía nhân viên (SPEC-B mục 6, 9.4) =====

/** Một dòng trong GET /api/tickets khi đăng nhập bằng admin/support. */
export interface StaffTicketItem extends TicketListItem {
  walletAddress: string;
  farmerName: string | null;
  assignedTo: string | null;
}

export interface StaffTicketCounts {
  mine: number;
  unassigned: number;
  all: number;
}

export interface StaffTicketListResponse {
  items: StaffTicketItem[];
  total: number;
  counts: StaffTicketCounts;
}

export interface StaffTicketQuery {
  status?: TicketStatus | '';
  assignedTo?: string; // 'me' | 'unassigned' | id nhân viên
  category?: TicketCategory | '';
  priority?: TicketPriority | '';
  q?: string;
  page?: number;
  pageSize?: number;
}

/** Hồ sơ nông dân trong chi tiết ticket / tra cứu (support nhận dữ liệu đã che). */
export interface FarmerSummary {
  walletAddress: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  province: string;
  district: string;
  commune: string | null;
  cropType: string;
  farmAreaHa: number;
  createdAt: string;
}

/** Tóm tắt policy gắn với ticket (từ policies_cache). */
export interface PolicySummaryLite {
  policyId: number;
  productName: string | null;
  perilType: number;
  status: number;
  rejected: boolean;
  startTime: number;
  endTime: number;
  premiumWei: string;
  coverageWei: string;
  hasEvidence?: boolean;
  rejectReason?: string | null;
}

/** GET /api/tickets/{id} phía nhân viên: có thêm tin nội bộ, hồ sơ nông dân và policy. */
export interface StaffTicketDetail extends TicketDetail {
  walletAddress: string;
  assignedTo: string | null;
  farmer: FarmerSummary | null;
  policy: PolicySummaryLite | null;
}

export interface TicketPatch {
  status?: TicketStatus;
  priority?: TicketPriority;
  /** 'me' | id nhân viên | '' (bỏ gán) */
  assignedTo?: string;
}

export interface CannedReply {
  id: number;
  title: string;
  body: string;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string;
  canEdit: boolean;
}

export type LookupKind = 'wallet' | 'policy' | 'phone' | 'name';

export interface LookupPolicy {
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
  hasEvidence: boolean;
}

export interface LookupItem {
  profile: FarmerSummary;
  policies: LookupPolicy[];
  evidenceSummary: { hasEvidence: boolean; exifWarning: boolean };
  openTickets: { id: number; subject: string; status: TicketStatus; updatedAt: string }[];
}

export interface LookupResponse {
  kind: LookupKind;
  query: string;
  matchedPolicyId: number | null;
  items: LookupItem[];
}

// ===== Quản trị =====

export interface StaffAccount {
  id: string;
  email: string;
  fullName: string;
  role: 'admin' | 'support';
  active: boolean;
  createdAt: string;
  isSelf: boolean;
}

export interface AuditLogItem {
  id: number;
  actorType: string;
  actorRef: string | null;
  actorName: string | null;
  action: string;
  target: string | null;
  detail: unknown;
  createdAt: string;
}

export interface AuditPage {
  items: AuditLogItem[];
  total: number;
  page: number;
  pageSize: number;
}
