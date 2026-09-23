import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Web3Service } from '../../services/web3.service';
import { ContractService } from '../../services/contract.service';
import { formatEther } from 'ethers';

interface PolicyView {
  id: bigint;
  status: number;
  coverageAmount: bigint;
  endTime: bigint;
}

const STATUS_LABELS = ['Chờ xác minh', 'Đang hiệu lực', 'Đã bồi thường', 'Đã đóng'];
const STATUS_CLASSES = ['badge-pending', 'badge-active', 'badge-paid', 'badge-closed'];

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css',
})
export class Dashboard implements OnInit {
  private web3 = inject(Web3Service);
  private contractService = inject(ContractService);

  readonly policies = signal<PolicyView[]>([]);
  readonly isLoading = signal(false);
  readonly loadError = signal<string | null>(null);

  ngOnInit(): void {
    if (this.web3.isConnected) {
      this.loadPolicies();
    }
  }

  async loadPolicies(): Promise<void> {
    const address = this.web3.address();
    if (!address) return;

    this.isLoading.set(true);
    this.loadError.set(null);

    try {
      const ids = await this.contractService.getActivePolicies(address);
      const results: PolicyView[] = [];
      for (const id of ids) {
        const p = await this.contractService.getPolicy(id);
        results.push({
          id,
          status: Number(p.status),
          coverageAmount: p.coverageAmount,
          endTime: p.endTime,
        });
      }
      this.policies.set(results);
    } catch (err: any) {
      this.loadError.set(err?.message ?? 'Không tải được danh sách policy');
    } finally {
      this.isLoading.set(false);
    }
  }

  statusLabel(status: number): string {
    return STATUS_LABELS[status] ?? 'Không rõ';
  }

  statusClass(status: number): string {
    return STATUS_CLASSES[status] ?? 'badge-closed';
  }

  formatEth(wei: bigint): string {
    return formatEther(wei);
  }
}