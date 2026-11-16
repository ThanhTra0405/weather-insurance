import { formatEther } from 'ethers';
import { environment } from '../../environments/environment';

const VN_TZ = 'Asia/Ho_Chi_Minh';

/** Số wei (bigint | chuỗi số) → chuỗi ETH tối đa 6 chữ số thập phân, bỏ số 0 thừa. */
export function formatEth(wei: bigint | string | number | null | undefined): string {
  if (wei === null || wei === undefined || wei === '') return '0';
  let value: bigint;
  try {
    value = BigInt(wei);
  } catch {
    return '0';
  }

  const negative = value < 0n;
  const [intPart, fracPart = ''] = formatEther(negative ? -value : value).split('.');
  const frac = fracPart.slice(0, 6).replace(/0+$/, '');
  return `${negative ? '-' : ''}${intPart}${frac ? '.' + frac : ''}`;
}

/** Unix giây, mili giây, chuỗi ISO hoặc Date → Date (null nếu không hợp lệ). */
export function toDate(input: number | string | Date | null | undefined): Date | null {
  if (input === null || input === undefined || input === '') return null;
  let date: Date;
  if (input instanceof Date) date = input;
  else if (typeof input === 'number') date = new Date(input < 1e12 ? input * 1000 : input);
  else date = new Date(input);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Hiển thị giờ Việt Nam: "14:30 15/11/2026". */
export function formatVnDateTime(input: number | string | Date | null | undefined): string {
  const date = toDate(input);
  if (!date) return '—';
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: VN_TZ,
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour12: false,
  }).format(date);
}

export function formatVnDate(input: number | string | Date | null | undefined): string {
  const date = toDate(input);
  if (!date) return '—';
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: VN_TZ,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

export function shortHash(hash: string | null | undefined): string {
  if (!hash) return '';
  return hash.length > 18 ? `${hash.slice(0, 10)}…${hash.slice(-6)}` : hash;
}

/** Link xem giao dịch: environment.explorerTxBase (A thêm), nếu chưa có thì dùng Etherscan Sepolia khi chạy Sepolia. */
export function explorerTxUrl(txHash: string | null | undefined): string | null {
  if (!txHash) return null;
  const configured = (environment as Record<string, unknown>)['explorerTxBase'];
  const base =
    typeof configured === 'string' && configured
      ? configured
      : environment.chainId === 11155111
        ? 'https://sepolia.etherscan.io/tx/'
        : '';
  return base ? base + txHash : null;
}

export function mapUrl(latE6: number, lngE6: number): string {
  const lat = (latE6 / 1e6).toFixed(6);
  const lng = (lngE6 / 1e6).toFixed(6);
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=15/${lat}/${lng}`;
}

export const PERIL_LABELS = ['Hạn hán', 'Lũ', 'Gió mạnh'];
export const PERIL_ICONS = ['🌵', '🌊', '💨'];

export function perilLabel(peril: number): string {
  return PERIL_LABELS[peril] ?? 'Khác';
}

export function perilIcon(peril: number): string {
  return PERIL_ICONS[peril] ?? '☁️';
}

/** Ngưỡng kích hoạt (thang ×100) → chữ hiển thị, dùng khi API chưa trả thresholdDisplay. */
export function thresholdText(peril: number, thresholdScaled: string | bigint): string {
  const value = Number(thresholdScaled) / 100;
  const text = value.toLocaleString('vi-VN', { maximumFractionDigits: 2 });
  switch (peril) {
    case 0:
      return `dưới ${text} mm mưa / 30 ngày`;
    case 1:
      return `trên ${text} mm mưa / 3 ngày`;
    case 2:
      return `gió giật trên ${text} km/h`;
    default:
      return text;
  }
}

export interface StatusView {
  label: string;
  cls: string;
}

/** Trạng thái policy: 0 chờ xác minh, 1 hiệu lực, 2 đã bồi thường, 3 đã đóng (rejected = bị từ chối). */
export function policyStatusView(status: number, rejected: boolean | null | undefined): StatusView {
  switch (status) {
    case 0:
      return { label: 'Chờ xác minh', cls: 'badge-pending' };
    case 1:
      return { label: 'Đang hiệu lực', cls: 'badge-active' };
    case 2:
      return { label: 'Đã bồi thường', cls: 'badge-paid' };
    case 3:
      return rejected ? { label: 'Bị từ chối', cls: 'badge-rejected' } : { label: 'Đã đóng', cls: 'badge-closed' };
    default:
      return { label: 'Không rõ', cls: 'badge-closed' };
  }
}

/** Thời hạn còn lại / thông tin hiệu lực của policy. */
export function remainingText(status: number, startTime: number, endTime: number, nowSec = Date.now() / 1000): string {
  if (status === 0) return 'Chờ xác minh hồ sơ';
  if (status === 2) return 'Đã bồi thường';
  if (status === 3) return 'Đã đóng';
  if (nowSec < startTime) return `Có hiệu lực từ ${formatVnDate(startTime)}`;

  const left = endTime - nowSec;
  if (left <= 0) return 'Đã hết hạn';
  const days = Math.floor(left / 86400);
  if (days >= 1) return `Còn ${days} ngày`;
  const hours = Math.max(1, Math.floor(left / 3600));
  return `Còn ${hours} giờ`;
}
