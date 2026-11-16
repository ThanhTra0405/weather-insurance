import { TicketCategory, TicketStatus } from '../models/ticket.models';

export const TICKET_CATEGORIES: { value: TicketCategory; label: string }[] = [
  { value: 'review_rejected', label: 'Hồ sơ bị từ chối' },
  { value: 'payout_missing', label: 'Chưa nhận được bồi thường' },
  { value: 'policy_info', label: 'Thông tin về policy' },
  { value: 'technical', label: 'Lỗi kỹ thuật' },
  { value: 'other', label: 'Khác' },
];

export function ticketCategoryLabel(category: string): string {
  return TICKET_CATEGORIES.find((c) => c.value === category)?.label ?? 'Khác';
}

export function ticketStatusLabel(status: TicketStatus | string): string {
  switch (status) {
    case 'open':
      return 'Mới';
    case 'in_progress':
      return 'Đang xử lý';
    case 'waiting_customer':
      return 'Chờ bạn phản hồi';
    case 'resolved':
      return 'Đã giải quyết';
    case 'closed':
      return 'Đã đóng';
    default:
      return String(status);
  }
}

/** Ticket còn đang được xử lý (chưa giải quyết/đóng). */
export function isTicketOpen(status: TicketStatus | string): boolean {
  return status === 'open' || status === 'in_progress' || status === 'waiting_customer';
}

export const TICKET_STATUSES: { value: TicketStatus; label: string }[] = [
  { value: 'open', label: 'Mới' },
  { value: 'in_progress', label: 'Đang xử lý' },
  { value: 'waiting_customer', label: 'Chờ nông dân' },
  { value: 'resolved', label: 'Đã giải quyết' },
  { value: 'closed', label: 'Đã đóng' },
];

export const TICKET_PRIORITIES: { value: 'low' | 'normal' | 'high'; label: string }[] = [
  { value: 'low', label: 'Thấp' },
  { value: 'normal', label: 'Bình thường' },
  { value: 'high', label: 'Cao' },
];

export function ticketPriorityLabel(priority: string): string {
  return TICKET_PRIORITIES.find((p) => p.value === priority)?.label ?? priority;
}

/** Nhãn trạng thái theo góc nhìn nhân viên ("Chờ nông dân" thay cho "Chờ bạn phản hồi"). */
export function staffStatusLabel(status: string): string {
  return TICKET_STATUSES.find((s) => s.value === status)?.label ?? status;
}

/** Thay {farmer_name}, {policy_id} trong mẫu trả lời (SPEC-B mục 9.4.3). */
export function fillCannedTemplate(body: string, farmerName: string | null | undefined, policyId: number | null | undefined): string {
  return body
    .replace(/\{farmer_name\}/g, farmerName?.trim() || 'bạn')
    .replace(/\{policy_id\}/g, policyId ? String(policyId) : '');
}
