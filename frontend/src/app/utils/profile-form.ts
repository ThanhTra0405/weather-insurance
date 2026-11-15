import { ProfileDto, ProfileInput } from '../models/auth.models';

// Bounding box Việt Nam: đúng các hằng số trong PolicyManager.sol (đã chia 1e6) và ProfileValidator.cs.
export const MIN_LAT = 8.18;
export const MAX_LAT = 23.4;
export const MIN_LNG = 102.14;
export const MAX_LNG = 109.47;

const PHONE_REGEX = /^(0|\+84)\d{9,10}$/;
const EMAIL_REGEX = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Giá trị trong ô nhập (mọi thứ là chuỗi để người dùng gõ dở vẫn giữ nguyên). */
export interface ProfileFormValue {
  fullName: string;
  phone: string;
  email: string;
  province: string;
  district: string;
  commune: string;
  cropType: string;
  farmAreaHa: string;
  farmLat: string;
  farmLng: string;
  notifyEmail: boolean;
}

export type ProfileErrors = Partial<Record<keyof ProfileFormValue | 'consent', string>>;

export function emptyProfileForm(): ProfileFormValue {
  return {
    fullName: '',
    phone: '',
    email: '',
    province: '',
    district: '',
    commune: '',
    cropType: '',
    farmAreaHa: '',
    farmLat: '',
    farmLng: '',
    notifyEmail: true,
  };
}

export function formFromDto(dto: ProfileDto): ProfileFormValue {
  return {
    fullName: dto.fullName ?? '',
    phone: dto.phone ?? '',
    email: dto.email ?? '',
    province: dto.province ?? '',
    district: dto.district ?? '',
    commune: dto.commune ?? '',
    cropType: dto.cropType ?? '',
    farmAreaHa: dto.farmAreaHa != null ? String(dto.farmAreaHa) : '',
    farmLat: dto.farmLat != null ? String(dto.farmLat) : '',
    farmLng: dto.farmLng != null ? String(dto.farmLng) : '',
    notifyEmail: dto.notifyEmail,
  };
}

/** Đổi chuỗi người dùng gõ sang số (chấp nhận dấu phẩy thập phân). NaN nếu rỗng/sai. */
export function parseNumber(text: string): number {
  const t = (text ?? '').trim().replace(',', '.');
  if (t === '') return NaN;
  return Number(t);
}

/** Kiểm tra theo đúng quy tắc của server (SPEC-B mục 3, ProfileValidator.cs). Rỗng = hợp lệ. */
export function validateProfile(v: ProfileFormValue): ProfileErrors {
  const e: ProfileErrors = {};

  const fullName = v.fullName.trim();
  if (fullName.length < 2 || fullName.length > 100) e.fullName = 'Họ tên phải từ 2 đến 100 ký tự';

  if (!PHONE_REGEX.test(v.phone.trim())) e.phone = 'Số điện thoại không hợp lệ';

  const email = v.email.trim();
  if (email && (email.length > 254 || !EMAIL_REGEX.test(email))) e.email = 'Email không hợp lệ';

  const province = v.province.trim();
  if (!province) e.province = 'Vui lòng nhập tỉnh/thành phố';
  else if (province.length > 100) e.province = 'Tỉnh/thành phố tối đa 100 ký tự';

  const district = v.district.trim();
  if (!district) e.district = 'Vui lòng nhập quận/huyện';
  else if (district.length > 100) e.district = 'Quận/huyện tối đa 100 ký tự';

  if (v.commune.trim().length > 100) e.commune = 'Phường/xã tối đa 100 ký tự';

  const crop = v.cropType.trim();
  if (!crop) e.cropType = 'Vui lòng nhập loại cây trồng';
  else if (crop.length > 50) e.cropType = 'Loại cây trồng tối đa 50 ký tự';

  const area = parseNumber(v.farmAreaHa);
  if (v.farmAreaHa.trim() === '') e.farmAreaHa = 'Vui lòng nhập diện tích';
  else if (Number.isNaN(area) || Math.round(area * 100) / 100 < 0.01 || area > 10000)
    e.farmAreaHa = 'Diện tích phải từ 0,01 đến 10000 ha';

  if (v.farmLat.trim() !== '') {
    const lat = parseNumber(v.farmLat);
    if (Number.isNaN(lat) || lat < MIN_LAT || lat > MAX_LAT)
      e.farmLat = `Vĩ độ phải nằm trong khoảng ${MIN_LAT} đến ${MAX_LAT}`;
  }
  if (v.farmLng.trim() !== '') {
    const lng = parseNumber(v.farmLng);
    if (Number.isNaN(lng) || lng < MIN_LNG || lng > MAX_LNG)
      e.farmLng = `Kinh độ phải nằm trong khoảng ${MIN_LNG} đến ${MAX_LNG}`;
  }

  return e;
}

/** Chuyển giá trị form sang body gửi server. Gọi sau khi validateProfile trả rỗng. */
export function toProfileInput(v: ProfileFormValue, extra?: { notifyTelegram?: boolean }): ProfileInput {
  const lat = parseNumber(v.farmLat);
  const lng = parseNumber(v.farmLng);
  return {
    fullName: v.fullName.trim(),
    phone: v.phone.trim(),
    email: v.email.trim() || null,
    province: v.province.trim(),
    district: v.district.trim(),
    commune: v.commune.trim() || null,
    cropType: v.cropType.trim(),
    farmAreaHa: parseNumber(v.farmAreaHa),
    farmLat: Number.isNaN(lat) ? null : lat,
    farmLng: Number.isNaN(lng) ? null : lng,
    notifyEmail: v.notifyEmail,
    ...(extra?.notifyTelegram !== undefined ? { notifyTelegram: extra.notifyTelegram } : {}),
  };
}

/** Rút gọn địa chỉ ví: 0x12ab…89cd. */
export function shortAddress(addr: string | null | undefined): string {
  return addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : '';
}
