import { ApiError } from '../services/api.service';

/**
 * true khi endpoint chưa tồn tại trên backend (ASP.NET trả 404 không có body { error }),
 * khác với 404 nghiệp vụ ("Không tìm thấy policy") luôn có message tiếng Việt từ server.
 */
export function isMissingEndpoint(e: unknown): boolean {
  return e instanceof ApiError && e.status === 404 && e.message.startsWith('Lỗi máy chủ');
}

/** Message hiển thị cho lỗi bất kỳ (ApiError dùng message của server). */
export function errorMessage(e: unknown, fallback = 'Đã có lỗi xảy ra, vui lòng thử lại'): string {
  if (e instanceof ApiError) return e.message || fallback;
  if (e instanceof Error && e.message) return e.message;
  return fallback;
}

/** 403: không đủ quyền hoặc không phải chủ dữ liệu. */
export function isForbidden(e: unknown): boolean {
  return e instanceof ApiError && e.status === 403;
}

/** 404 nghiệp vụ (có message từ server) hoặc endpoint chưa có. */
export function isNotFound(e: unknown): boolean {
  return e instanceof ApiError && e.status === 404;
}

/** Lỗi máy chủ hoặc mất kết nối (5xx / không có phản hồi): nên cho thử lại. */
export function isServerError(e: unknown): boolean {
  return e instanceof ApiError && (e.status === 0 || e.status >= 500);
}
