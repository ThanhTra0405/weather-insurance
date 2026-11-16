const ICONS: Record<string, string> = {
  evidence_received: '📥',
  policy_approved: '✅',
  policy_rejected: '❌',
  payout_sent: '💰',
  policy_expired: '⌛',
  ticket_reply: '💬',
  ticket_status: '🎫',
};

export function notificationIcon(type: string): string {
  return ICONS[type] ?? '🔔';
}
