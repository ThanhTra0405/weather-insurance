import { Injectable, inject } from '@angular/core';
import { AuditPage, StaffAccount } from '../models/ticket.models';
import { ApiParams, ApiService } from './api.service';

export interface AuditQuery {
  page?: number;
  pageSize?: number;
  action?: string;
  actor?: string;
  from?: string; // ISO 8601
  to?: string;
}

/** Quản lý nhân viên và nhật ký hoạt động (admin, SPEC-B mục 8). */
@Injectable({ providedIn: 'root' })
export class AdminStaffService {
  private readonly api = inject(ApiService);

  list(): Promise<StaffAccount[]> {
    return this.api.get<StaffAccount[]>('/api/admin/staff');
  }

  create(input: { email: string; fullName: string; role: string; password: string }): Promise<StaffAccount> {
    return this.api.post<StaffAccount>('/api/admin/staff', input);
  }

  update(id: string, patch: { fullName?: string; role?: string; active?: boolean; password?: string }): Promise<StaffAccount> {
    return this.api.patch<StaffAccount>(`/api/admin/staff/${id}`, patch);
  }

  audit(query: AuditQuery): Promise<AuditPage> {
    const params: ApiParams = {
      page: query.page ?? 1,
      pageSize: query.pageSize ?? 50,
      action: query.action?.trim() || undefined,
      actor: query.actor?.trim() || undefined,
      from: query.from || undefined,
      to: query.to || undefined,
    };
    return this.api.get<AuditPage>('/api/admin/audit', params);
  }
}
