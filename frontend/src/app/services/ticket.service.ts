import { Injectable, inject } from '@angular/core';
import { CreateTicketInput, TicketDetail, TicketListResponse, TicketMessageDto } from '../models/ticket.models';
import { ApiService } from './api.service';

/** API ticket phía nông dân (SPEC-B mục 6). Phía nhân viên thêm ở Ngày 3. */
@Injectable({ providedIn: 'root' })
export class TicketService {
  private readonly api = inject(ApiService);

  list(page = 1, pageSize = 50): Promise<TicketListResponse> {
    return this.api.get<TicketListResponse>('/api/tickets', { page, pageSize });
  }

  create(input: CreateTicketInput): Promise<{ id: number; status: string; createdAt: string }> {
    return this.api.post('/api/tickets', {
      policyId: input.policyId,
      category: input.category,
      subject: input.subject,
      body: input.body,
    });
  }

  get(id: number): Promise<TicketDetail> {
    return this.api.get<TicketDetail>(`/api/tickets/${id}`);
  }

  send(id: number, body: string): Promise<TicketMessageDto> {
    return this.api.post<TicketMessageDto>(`/api/tickets/${id}/messages`, { body });
  }

  rate(id: number, rating: number, comment: string | null): Promise<{ rating: number; ratingComment: string | null }> {
    return this.api.post(`/api/tickets/${id}/rating`, { rating, comment });
  }
}
