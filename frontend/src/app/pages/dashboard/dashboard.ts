import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PolicySummary } from '../../models/policy.models';
import { PolicyService } from '../../services/policy.service';
import { errorMessage } from '../../utils/api-helpers';
import { formatEth, perilIcon, policyStatusView, remainingText } from '../../utils/format';

/** Tổng quan của nông dân (SPEC-B mục 9.3.3): thẻ tổng hợp + danh sách policy từ GET /api/policies/mine. */
@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css',
})
export class Dashboard implements OnInit {
  private readonly policyService = inject(PolicyService);

  readonly policies = signal<PolicySummary[]>([]);
  readonly isLoading = signal(true);
  readonly loadError = signal<string | null>(null);

  readonly totalCount = computed(() => this.policies().length);
  readonly activeCount = computed(() => this.policies().filter((p) => p.status === 1).length);
  /** Tổng mức bồi thường của các policy đã bồi thường (mức bồi thường = số tiền chi trả của gói). */
  readonly paidTotalWei = computed(() =>
    this.policies()
      .filter((p) => p.status === 2)
      .reduce((sum, p) => sum + BigInt(p.coverageWei || '0'), 0n),
  );

  ngOnInit(): void {
    void this.loadPolicies();
  }

  async loadPolicies(): Promise<void> {
    this.isLoading.set(true);
    this.loadError.set(null);
    try {
      this.policies.set(await this.policyService.mine());
    } catch (e) {
      this.loadError.set(errorMessage(e, 'Không tải được danh sách policy'));
    } finally {
      this.isLoading.set(false);
    }
  }

  statusView(p: PolicySummary) {
    return policyStatusView(p.status, p.rejected);
  }

  remaining(p: PolicySummary): string {
    return remainingText(p.status, p.startTime, p.endTime);
  }

  needsEvidence(p: PolicySummary): boolean {
    return p.status === 0 && p.hasEvidence === false;
  }

  perilIcon = perilIcon;
  formatEth = formatEth;
  formatEthWei(wei: bigint): string {
    return formatEth(wei);
  }
}
