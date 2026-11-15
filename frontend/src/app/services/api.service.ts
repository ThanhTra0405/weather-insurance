import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpHeaders, HttpParams } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

/** Lỗi trả về từ backend theo chuẩn { error, code?, fields? } (status 0 = không kết nối được). */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
    public readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export type ApiParams = Record<string, string | number | boolean | undefined>;

/**
 * Gọi backend: gắn Bearer token, đổi lỗi HTTP thành ApiError.
 * Không import AuthService (tránh vòng phụ thuộc): AuthService gọi configure() khi khởi tạo.
 */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);

  private tokenProvider: () => string | null = () => null;
  private unauthorizedHandler: () => void = () => {};

  configure(options: { getToken: () => string | null; onUnauthorized: () => void }): void {
    this.tokenProvider = options.getToken;
    this.unauthorizedHandler = options.onUnauthorized;
  }

  get<T>(path: string, params?: ApiParams): Promise<T> {
    return this.request<T>('GET', path, undefined, params);
  }

  post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  put<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PUT', path, body);
  }

  patch<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PATCH', path, body);
  }

  del<T>(path: string): Promise<T> {
    return this.request<T>('DELETE', path);
  }

  /** Gửi multipart: không tự đặt Content-Type để trình duyệt thêm boundary. */
  postForm<T>(path: string, form: FormData): Promise<T> {
    return this.request<T>('POST', path, form);
  }

  private async request<T>(method: string, path: string, body?: unknown, params?: ApiParams): Promise<T> {
    let httpParams = new HttpParams();
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) httpParams = httpParams.set(key, String(value));
      }
    }

    let headers = new HttpHeaders();
    const token = this.tokenProvider();
    if (token) headers = headers.set('Authorization', `Bearer ${token}`);

    try {
      return await firstValueFrom(
        this.http.request<T>(method, `${environment.backendUrl}${path}`, { body, params: httpParams, headers }),
      );
    } catch (e) {
      const error = this.toApiError(e);
      // 401 ở endpoint không phải /api/auth/*: phiên hết hạn hoặc bị từ chối.
      if (error.status === 401 && !path.startsWith('/api/auth/')) {
        this.unauthorizedHandler();
      }
      throw error;
    }
  }

  private toApiError(e: unknown): ApiError {
    if (e instanceof HttpErrorResponse) {
      if (e.status === 0) return new ApiError(0, 'Không kết nối được máy chủ');

      const body = e.error as { error?: unknown; code?: unknown; fields?: unknown } | string | null;
      if (body && typeof body === 'object') {
        const message = typeof body.error === 'string' ? body.error : `Lỗi máy chủ (${e.status})`;
        const code = typeof body.code === 'string' ? body.code : undefined;
        const fields =
          body.fields && typeof body.fields === 'object' ? (body.fields as Record<string, string>) : undefined;
        return new ApiError(e.status, message, code, fields);
      }
      return new ApiError(e.status, `Lỗi máy chủ (${e.status})`);
    }
    return new ApiError(0, e instanceof Error ? e.message : 'Lỗi không xác định');
  }
}
