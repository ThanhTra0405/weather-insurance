import { formatEther } from 'ethers';
import { environment } from '../../../environments/environment';
import { ApiError } from '../../services/api.service';

export const PERIL_LABELS = ['Hạn hán', 'Lũ', 'Gió mạnh'];
export const LOW_BALANCE_WEI = 50_000_000_000_000_000n; // 0.05 ETH

export function perilLabel(p: number | null | undefined): string {
  return p === null || p === undefined ? '—' : (PERIL_LABELS[p] ?? `#${p}`);
}

/** wei (chuỗi/bigint) -> "0.0123" ETH, tối đa `digits` chữ số thập phân. */
export function fmtEth(wei: string | bigint | null | undefined, digits = 4): string {
  if (wei === null || wei === undefined || wei === '') return '—';
  try {
    const n = Number(formatEther(BigInt(wei)));
    return n.toLocaleString('vi-VN', { maximumFractionDigits: digits });
  } catch {
    return '—';
  }
}

export function isLow(wei: string | null | undefined): boolean {
  try {
    return BigInt(wei ?? '0') < LOW_BALANCE_WEI;
  } catch {
    return false;
  }
}

/** Giá trị oracle đã scale x100 -> "150 mm" / "60 km/h". */
export function fmtOracleValue(scaled: string | null | undefined, peril: number): string {
  if (!scaled) return '—';
  const v = Number(scaled) / 100;
  return `${v.toLocaleString('vi-VN', { maximumFractionDigits: 2 })} ${peril === 2 ? 'km/h' : 'mm'}`;
}

export function fmtTime(unix: number | null | undefined): string {
  if (!unix) return '—';
  return new Date(unix * 1000).toLocaleString('vi-VN', { hour12: false });
}

export function fmtAge(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return '—';
  if (minutes < 60) return `${minutes} phút trước`;
  const h = Math.floor(minutes / 60);
  return h < 48 ? `${h} giờ trước` : `${Math.floor(h / 24)} ngày trước`;
}

export function shortHex(s: string | null | undefined, head = 6, tail = 4): string {
  if (!s) return '—';
  return s.length <= head + tail + 2 ? s : `${s.slice(0, head)}…${s.slice(-tail)}`;
}

/** Link giao dịch trên Etherscan; rỗng khi chạy local (không có explorer). */
export function txUrl(hash: string | null | undefined): string | null {
  if (!hash || !environment.explorerTxBase) return null;
  return environment.explorerTxBase + hash;
}

export function errMsg(e: unknown, fallback = 'Có lỗi xảy ra'): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error && e.message) return e.message;
  return fallback;
}
