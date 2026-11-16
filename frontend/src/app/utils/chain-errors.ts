/** Lỗi nghiệp vụ trong luồng giao dịch, message đã là tiếng Việt, hiển thị nguyên văn. */
export class FlowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FlowError';
  }
}

interface Rule {
  match: RegExp;
  text: string;
}

// Chuỗi revert của contract (không dấu) → thông báo tiếng Việt có dấu.
const RULES: Rule[] = [
  { match: /Pool khong du von/i, text: 'Quỹ bảo hiểm tạm hết hạn mức, vui lòng thử lại sau' },
  { match: /Premium khong dung/i, text: 'Phí bảo hiểm không khớp với gói. Hãy tải lại trang và chọn lại gói' },
  { match: /lat ngoai pham vi|lng ngoai pham vi/i, text: 'Vị trí nằm ngoài phạm vi hỗ trợ (lãnh thổ Việt Nam)' },
  { match: /chi ho tro toa do duong/i, text: 'Hệ thống chỉ hỗ trợ toạ độ dương' },
  { match: /San pham khong ton tai hoac ngung ban/i, text: 'Gói bảo hiểm không tồn tại hoặc đã ngừng bán' },
  { match: /Policy khong ton tai/i, text: 'Policy không tồn tại' },
  { match: /Chi chu policy moi duoc gui/i, text: 'Chỉ chủ policy mới được gửi hồ sơ xác minh' },
  { match: /Policy khong o trang thai cho xac minh/i, text: 'Policy không còn ở trạng thái chờ xác minh' },
  { match: /Da gui bang chung roi/i, text: 'Hồ sơ đã được gửi lên blockchain trước đó' },
  { match: /Hash rong/i, text: 'Hash hồ sơ bị rỗng, vui lòng chọn lại ảnh' },
  { match: /EnforcedPause|Pausable: paused|\bpaused\b/i, text: 'Hệ thống đang tạm dừng, vui lòng thử lại sau' },
  { match: /insufficient funds|INSUFFICIENT_FUNDS/i, text: 'Ví không đủ ETH để trả phí bảo hiểm và phí gas' },
  { match: /user rejected|ACTION_REJECTED/i, text: 'Bạn đã huỷ giao dịch' },
  { match: /NETWORK_ERROR|could not detect network|failed to fetch|ECONNREFUSED|SERVER_ERROR/i, text: 'Không kết nối được blockchain, vui lòng kiểm tra mạng và thử lại' },
  { match: /nonce too low|replacement transaction underpriced/i, text: 'Giao dịch trước đó chưa xử lý xong, vui lòng đợi vài giây rồi thử lại' },
];

/** Gom mọi trường chứa thông điệp lỗi của ethers/hardhat/RPC thành một chuỗi để dò. */
function collectMessages(e: unknown): string {
  const anyErr = e as Record<string, any> | null;
  if (!anyErr || typeof anyErr !== 'object') return String(e ?? '');

  const parts = [
    anyErr['reason'],
    anyErr['shortMessage'],
    anyErr['info']?.error?.message,
    anyErr['error']?.message,
    anyErr['data']?.message,
    anyErr['message'],
  ].filter((p): p is string => typeof p === 'string' && p.length > 0);
  return parts.join(' | ');
}

/** Đổi lỗi giao dịch/RPC thành thông báo tiếng Việt. */
export function describeChainError(e: unknown, fallback = 'Giao dịch thất bại, vui lòng thử lại'): string {
  if (e instanceof FlowError) return e.message;

  const text = collectMessages(e);
  for (const rule of RULES) {
    if (rule.match.test(text)) return rule.text;
  }
  return fallback;
}
