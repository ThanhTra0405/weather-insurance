import { RenderMode, ServerRoute } from '@angular/ssr';

// Mọi route cần ví/localStorage/JWT nên chỉ render ở trình duyệt (tránh lỗi SSR/prerender).
export const serverRoutes: ServerRoute[] = [
  {
    path: '**',
    renderMode: RenderMode.Client,
  },
];
