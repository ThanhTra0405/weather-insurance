/** Vai trò trong hệ thống: nông dân đăng nhập bằng ví, nhân viên bằng email + mật khẩu. */
export type Role = 'farmer' | 'admin' | 'support';

/** Hồ sơ nông dân do backend trả về (GET /api/profile/me, kết quả đăng ký/đăng nhập). */
export interface ProfileDto {
  hasProfile: boolean;
  fullName: string;
  phone: string;
  email: string | null;
  province: string;
  district: string;
  commune: string | null;
  cropType: string;
  farmAreaHa: number;
  farmLat: number | null;
  farmLng: number | null;
  notifyEmail: boolean;
  notifyTelegram: boolean;
  telegramLinked: boolean;
  isComplete: boolean;
}

/** Dữ liệu hồ sơ client gửi lên (đăng ký và PUT /api/profile/me). */
export interface ProfileInput {
  fullName: string;
  phone: string;
  email?: string | null;
  province: string;
  district: string;
  commune?: string | null;
  cropType: string;
  farmAreaHa: number;
  farmLat?: number | null;
  farmLng?: number | null;
  notifyEmail?: boolean;
  notifyTelegram?: boolean;
}

/** Kết quả đăng ký/đăng nhập nông dân. gasWarning có giá trị khi không nạp được gas (không chặn đăng nhập). */
export interface AuthResult {
  wallet: string;
  gasWarning?: string;
}
