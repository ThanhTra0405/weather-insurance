import { Injectable, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Router } from '@angular/router';
import { Wallet } from 'ethers';
import { ApiError, ApiService } from './api.service';
import { ToastService } from './toast.service';
import { Web3Service } from './web3.service';
import { AuthResult, ProfileDto, ProfileInput, Role } from '../models/auth.models';

const FARMER_JWT_KEY = 'wi_jwt'; // localStorage: nông dân
const STAFF_JWT_KEY = 'wi_staff_jwt'; // sessionStorage: nhân viên (đóng tab là thoát)
const LOGGED_OUT_KEY = 'wi_logged_out'; // localStorage: đã chủ động đăng xuất, không tự đăng nhập lại

interface JwtPayload {
  sub?: string;
  role?: string;
  wallet?: string;
  name?: string;
  exp?: number;
}

interface FarmerAuthResponse {
  token: string;
  role: 'farmer';
  wallet: string;
  profile: ProfileDto;
  expiresAt: string;
}

interface StaffAuthResponse {
  token: string;
  role: 'admin' | 'support';
  fullName: string;
  staffId: string;
  expiresAt: string;
}

interface NonceResponse {
  nonce: string;
  message: string;
  expiresAt: string;
}

/** Giải mã phần payload của JWT (không kiểm tra chữ ký: việc đó do server làm). */
export function decodeJwt(token: string): JwtPayload | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes)) as JwtPayload;
  } catch {
    return null;
  }
}

/** Chỉ chấp nhận đường dẫn nội bộ bắt đầu bằng "/" (không phải "//", không có "\" hay ký tự điều khiển). */
export function safeReturnUrl(url: string | null | undefined, fallback = '/'): string {
  if (!url || typeof url !== 'string') return fallback;
  if (!url.startsWith('/') || url.startsWith('//')) return fallback;
  if (url.includes('\\') || /[\x00-\x1f]/.test(url)) return fallback;
  return url;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly api = inject(ApiService);
  private readonly web3 = inject(Web3Service);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  readonly token = signal<string | null>(null);
  readonly role = signal<Role | null>(null);
  readonly wallet = signal<string | null>(null); // viết thường, khớp claim "wallet"
  readonly fullName = signal<string | null>(null);
  readonly staffId = signal<string | null>(null);
  readonly profile = signal<ProfileDto | null>(null);

  readonly isLoggedIn = computed(() => this.token() !== null && this.role() !== null);
  readonly isStaff = computed(() => this.role() === 'admin' || this.role() === 'support');

  /** Hoàn tất khi đã khôi phục phiên lúc khởi động. Guard phải await trước khi quyết định. */
  readonly ready: Promise<void>;

  constructor() {
    this.api.configure({
      getToken: () => this.token(),
      onUnauthorized: () => this.handleExpired(),
    });

    if (this.isBrowser) {
      window.addEventListener('storage', (event) => {
        if (event.key === FARMER_JWT_KEY || event.key === null) this.syncFromFarmerStorage();
      });
      this.ready = this.restore();
    } else {
      this.ready = Promise.resolve();
    }
  }

  /** Trang chủ theo vai trò. */
  homePath(): string {
    switch (this.role()) {
      case 'farmer':
        return '/dashboard';
      case 'admin':
        return '/admin/review';
      case 'support':
        return '/support';
      default:
        return '/login';
    }
  }

  safeReturnUrl(url: string | null | undefined, fallback?: string): string {
    return safeReturnUrl(url, fallback ?? this.homePath());
  }

  // ===== Nông dân: đăng ký / đăng nhập bằng chữ ký ví =====

  /** Đăng ký: ví phải đã được saveWallet() vào máy trước. Ném ApiError (ALREADY_REGISTERED, VALIDATION...). */
  async register(profile: ProfileInput): Promise<AuthResult> {
    await this.web3.ready;
    const address = this.web3.address();
    if (!address) throw new Error('Thiết bị chưa có ví');

    const res = await this.signedRequest<FarmerAuthResponse>(
      '/api/auth/register',
      address,
      (message) => this.web3.signMessage(message),
      { profile },
    );
    this.startFarmerSession(res);
    return { wallet: res.wallet, gasWarning: await this.tryEnsureGas() };
  }

  /**
   * Đăng nhập bằng ví đã lưu trên máy, hoặc (khôi phục) bằng privateKey truyền vào.
   * Ví vừa khôi phục chỉ được lưu vào máy SAU khi đăng nhập thành công.
   * Ném ApiError (NOT_REGISTERED, RATE_LIMITED...).
   */
  async loginWithWallet(options?: { privateKey?: string }): Promise<AuthResult> {
    let address: string;
    let sign: (message: string) => Promise<string>;

    if (options?.privateKey) {
      const signer = new Wallet(this.web3.importPrivateKey(options.privateKey).privateKey);
      address = signer.address;
      sign = (message) => signer.signMessage(message);
    } else {
      await this.web3.ready;
      const stored = this.web3.address();
      if (!stored) throw new Error('Thiết bị chưa có ví');
      address = stored;
      sign = (message) => this.web3.signMessage(message);
    }

    const res = await this.signedRequest<FarmerAuthResponse>('/api/auth/login', address, sign);

    if (options?.privateKey) await this.web3.saveWallet(options.privateKey);
    this.startFarmerSession(res);
    return { wallet: res.wallet, gasWarning: await this.tryEnsureGas() };
  }

  // ===== Nhân viên =====

  /** Trả về vai trò (admin | support). Ném ApiError (401 sai thông tin, 429 RATE_LIMITED). */
  async loginStaff(email: string, password: string): Promise<'admin' | 'support'> {
    const res = await this.api.post<StaffAuthResponse>('/api/auth/staff/login', { email, password });
    this.startStaffSession(res.token);
    return res.role;
  }

  async changeStaffPassword(currentPassword: string, newPassword: string): Promise<void> {
    await this.api.post('/api/auth/staff/change-password', { currentPassword, newPassword });
  }

  // ===== Hồ sơ =====

  /** Tải hồ sơ nông dân (cache trong signal profile). Trả null nếu chưa có hồ sơ. */
  async loadProfile(force = false): Promise<ProfileDto | null> {
    if (this.role() !== 'farmer') return null;
    if (!force && this.profile()) return this.profile();

    const dto = await this.api.get<ProfileDto | { hasProfile: false }>('/api/profile/me');
    if (!dto.hasProfile) {
      this.profile.set(null);
      return null;
    }
    this.setProfile(dto as ProfileDto);
    return dto as ProfileDto;
  }

  /** Cập nhật cache hồ sơ (trang hồ sơ gọi sau khi lưu). */
  setProfile(profile: ProfileDto): void {
    this.profile.set(profile);
    this.fullName.set(profile.fullName);
  }

  // ===== Đăng xuất và phiên =====

  /**
   * Đăng xuất. Nông dân: giữ ví trên máy và đặt cờ wi_logged_out (không tự đăng nhập lại);
   * forgetWallet = true thì xoá luôn private key khỏi máy.
   */
  async logout(options?: { forgetWallet?: boolean }): Promise<void> {
    const wasStaff = this.isStaff();
    this.clearSession();

    if (this.isBrowser && !wasStaff) {
      if (options?.forgetWallet) {
        this.web3.forgetWallet();
        localStorage.removeItem(LOGGED_OUT_KEY);
      } else {
        localStorage.setItem(LOGGED_OUT_KEY, '1');
      }
    }

    await this.router.navigate([wasStaff ? '/staff/login' : '/login']);
  }

  /** Xoá phiên trong bộ nhớ và storage (không đụng tới ví, không đặt cờ đăng xuất). */
  clearSession(): void {
    if (this.isBrowser) {
      localStorage.removeItem(FARMER_JWT_KEY);
      sessionStorage.removeItem(STAFF_JWT_KEY);
    }
    this.token.set(null);
    this.role.set(null);
    this.wallet.set(null);
    this.fullName.set(null);
    this.staffId.set(null);
    this.profile.set(null);
  }

  /** Server trả 401: xoá phiên và chuyển về trang đăng nhập đúng vai trò, kèm returnUrl. */
  handleExpired(): void {
    if (!this.isLoggedIn()) return; // đã xử lý rồi (nhiều request 401 cùng lúc)

    const wasStaff = this.isStaff();
    const currentUrl = this.router.url;
    this.clearSession();
    this.toast.warning('Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại');

    const onAuthPage = ['/login', '/register', '/staff/login'].some((p) => currentUrl.startsWith(p));
    void this.router.navigate([wasStaff ? '/staff/login' : '/login'], {
      queryParams: onAuthPage || currentUrl === '/' ? undefined : { returnUrl: currentUrl },
    });
  }

  /**
   * Khôi phục phiên lúc khởi động: JWT nhân viên (sessionStorage) hoặc nông dân (localStorage) còn hạn thì dùng.
   * JWT nông dân hết hạn mà ví còn trên máy và không có cờ wi_logged_out thì tự ký lại im lặng.
   */
  private async restore(): Promise<void> {
    const staff = this.readValidToken(sessionStorage.getItem(STAFF_JWT_KEY), ['admin', 'support']);
    if (staff) {
      this.applyToken(staff);
      return;
    }

    const farmerRaw = localStorage.getItem(FARMER_JWT_KEY);
    const farmer = this.readValidToken(farmerRaw, ['farmer']);
    if (farmer) {
      this.applyToken(farmer);
      return;
    }

    if (farmerRaw) {
      // JWT hết hạn hoặc hỏng
      localStorage.removeItem(FARMER_JWT_KEY);
      if (this.web3.hasStoredWallet() && !localStorage.getItem(LOGGED_OUT_KEY)) {
        try {
          await this.loginWithWallet();
        } catch {
          // im lặng: người dùng sẽ thấy trang đăng nhập
        }
      }
    }
  }

  /** Đồng bộ đăng nhập/đăng xuất của nông dân giữa các tab (sự kiện storage). */
  private syncFromFarmerStorage(): void {
    if (this.isStaff()) return; // phiên nhân viên chỉ thuộc về tab này

    const farmer = this.readValidToken(localStorage.getItem(FARMER_JWT_KEY), ['farmer']);
    if (farmer) {
      if (farmer !== this.token()) this.applyToken(farmer);
    } else if (this.isLoggedIn()) {
      this.clearSession();
      void this.router.navigate(['/login']);
    }
  }

  // ===== Hàm phụ =====

  private startFarmerSession(res: FarmerAuthResponse): void {
    if (this.isBrowser) {
      localStorage.setItem(FARMER_JWT_KEY, res.token);
      localStorage.removeItem(LOGGED_OUT_KEY);
      sessionStorage.removeItem(STAFF_JWT_KEY); // đăng nhập vai này xoá phiên vai kia
    }
    this.applyToken(res.token);
    if (res.profile?.hasProfile) this.setProfile(res.profile);
  }

  private startStaffSession(token: string): void {
    if (this.isBrowser) {
      sessionStorage.setItem(STAFF_JWT_KEY, token);
      localStorage.removeItem(FARMER_JWT_KEY);
    }
    this.profile.set(null);
    this.applyToken(token);
  }

  /** Đặt các signal từ JWT đã được readValidToken kiểm tra. */
  private applyToken(token: string): void {
    const payload = decodeJwt(token);
    if (!payload) return;
    this.token.set(token);
    this.role.set(payload.role as Role);
    this.wallet.set(payload.wallet ? payload.wallet.toLowerCase() : null);
    this.fullName.set(payload.name ?? null);
    this.staffId.set(payload.role === 'farmer' ? null : (payload.sub ?? null));
  }

  /** Trả về token nếu hợp lệ: giải mã được, đúng vai trò, còn hạn (nông dân phải có claim wallet). */
  private readValidToken(raw: string | null, roles: Role[]): string | null {
    if (!raw) return null;
    const payload = decodeJwt(raw);
    if (!payload || !payload.role || !roles.includes(payload.role as Role)) return null;
    if (!payload.exp || payload.exp * 1000 <= Date.now()) return null;
    if (payload.role === 'farmer' && !payload.wallet) return null;
    return raw;
  }

  /** Lấy nonce, ký message server dựng, gửi lên path. NONCE_EXPIRED thì tự thử lại đúng một lần. */
  private async signedRequest<T>(
    path: string,
    address: string,
    sign: (message: string) => Promise<string>,
    extraBody: Record<string, unknown> = {},
    allowRetry = true,
  ): Promise<T> {
    const challenge = await this.api.get<NonceResponse>('/api/auth/nonce', { address });
    const signature = await sign(challenge.message);
    try {
      return await this.api.post<T>(path, { address, signature, ...extraBody });
    } catch (e) {
      if (allowRetry && e instanceof ApiError && e.code === 'NONCE_EXPIRED') {
        return this.signedRequest<T>(path, address, sign, extraBody, false);
      }
      throw e;
    }
  }

  /** Nạp gas sau đăng nhập; lỗi chỉ trả về dạng cảnh báo, không chặn đăng nhập. */
  private async tryEnsureGas(): Promise<string | undefined> {
    try {
      await this.web3.ensureGas();
      return undefined;
    } catch (e) {
      return e instanceof Error ? e.message : 'Không nạp được gas';
    }
  }
}
