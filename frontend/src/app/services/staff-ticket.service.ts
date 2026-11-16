import { Injectable, inject } from '@angular/core';
import {
  CannedReply,
  LookupResponse,
  StaffTicketDetail,
  StaffTicketListResponse,
  StaffTicketQuery,
  TicketMessageDto,
  TicketPatch,
} from '../models/ticket.models';
import { ApiParams, ApiService } from './api.service';

/** API CSKH cho admin/support: hàng đợi, chi tiết, trả lời, đổi trạng thái, mẫu trả lời, tra cứu (SPEC-B mục 6). */
@Injectable({ providedIn: 'root' })
export class StaffTicketService {
  private readonly api = inject(ApiService);

  queue(query: StaffTicketQuery): Promise<StaffTicketListResponse> {
    const params: ApiParams = {
      status: query.status || undefined,
      assignedTo: query.assignedTo || undefined,
      category: query.category || undefined,
      priority: query.priority || undefined,
      q: query.q?.trim() || undefined,
      page: query.page ?? 1,
      pageSize: query.pageSize ?? 20,
    };
    return this.api.get<StaffTicketListResponse>('/api/tickets', params);
  }

  get(id: number): Promise<StaffTicketDetail> {
    return this.api.get<StaffTicketDetail>(`/api/tickets/${id}`);
  }

  reply(id: number, body: string, isInternal: boolean): Promise<TicketMessageDto> {
    return this.api.post<TicketMessageDto>(`/api/tickets/${id}/messages`, { body, isInternal });
  }

  patch(id: number, patch: TicketPatch): Promise<unknown> {
    return this.api.patch(`/api/tickets/${id}`, patch);
  }

  // ----- Mẫu trả lời -----
  cannedList(): Promise<CannedReply[]> {
    return this.api.get<CannedReply[]>('/api/support/canned-replies');
  }

  cannedCreate(title: string, body: string): Promise<CannedReply> {
    return this.api.post<CannedReply>('/api/support/canned-replies', { title, body });
  }

  cannedUpdate(id: number, title: string, body: string): Promise<CannedReply> {
    return this.api.put<CannedReply>(`/api/support/canned-replies/${id}`, { title, body });
  }

  cannedDelete(id: number): Promise<unknown> {
    return this.api.del(`/api/support/canned-replies/${id}`);
  }

  // ----- Tra cứu -----
  lookup(q: string): Promise<LookupResponse> {
    return this.api.get<LookupResponse>('/api/support/lookup', { q });
  }
}
