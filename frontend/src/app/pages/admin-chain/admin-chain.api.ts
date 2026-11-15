import { Injectable, inject } from '@angular/core';
import { ApiService } from '../../services/api.service';

export interface AdminStats {
  policies: { total: number; pending: number; active: number; paidOut: number; closed: number };
  pool: { balanceWei: string; depositedWei: string; lockedWei: string; availableWei: string };
  payouts: { count: number; totalWei: string };
  tickets: { open: number; inProgress: number; unassigned: number };
  operatorBalanceWei: string;
  faucetBalanceWei: string;
  oracle: { lastRunAt: number | null; lastRunOk: boolean };
  indexer: { lastBlock: number; latestBlock: number; lag: number };
  chainError: string | null;
}

export interface ProductRow {
  productId: number;
  name: string;
  perilType: number;
  threshold: string;
  thresholdDisplay: string;
  durationDays: number;
  premiumWei: string;
  coverageWei: string;
  active: boolean;
}

export interface SystemInfo {
  owner: string;
  verifier: string;
  oracleSigner: string;
  operatorAddress: string;
  faucetAddress: string | null;
  signerMatches: boolean;
  coolingOffSeconds: number;
  paused: { policyManager: boolean; pool: boolean; payoutEngine: boolean };
  operatorBalanceWei: string;
  faucetBalanceWei: string;
}

export interface TxResult {
  txHash: string | null;
}

export interface PauseResult {
  target: string;
  txHash: string | null;
  changed: boolean;
  error: string | null;
}

export interface CycleResult {
  submittedCount: number;
  payoutCount: number;
  expiredCount: number;
  errors: string[];
  startedAt: number;
  finishedAt: number;
}

export interface OracleItem {
  regionId: string;
  perilType: number;
  activePolicies: number;
  lastValueScaled: string | null;
  lastDataTs: number | null;
  ageMinutes: number | null;
  lastTxHash: string | null;
  lastStatus: string | null;
  lastError: string | null;
}

export interface OracleStatus {
  items: OracleItem[];
  runner: {
    lastRunAt: number | null;
    lastRunOk: boolean | null;
    intervalMinutes: number;
    lastResult: CycleResult | null;
  };
  oracleSigner: string | null;
  operatorAddress: string | null;
  signerMatches: boolean | null;
  simulateEnabled: boolean;
}

export interface PayoutRow {
  policyId: number | null;
  holder: string | null;
  amountWei: string;
  txHash: string;
  time: number;
}

export interface PayoutPage {
  page: number;
  pageSize: number;
  count: number;
  totalWei: string;
  items: PayoutRow[];
}

export interface CreateProductBody {
  name: string;
  perilType: number;
  threshold: number;
  durationDays: number;
  premiumEth: number;
  coverageEth: number;
}

export interface SimulateBody {
  regionId?: string;
  lat?: number;
  lng?: number;
  perilType: number;
  value: number;
}

@Injectable({ providedIn: 'root' })
export class AdminChainApi {
  private readonly api = inject(ApiService);

  stats() {
    return this.api.get<AdminStats>('/api/admin/stats');
  }
  products() {
    return this.api.get<ProductRow[]>('/api/products');
  }
  system() {
    return this.api.get<SystemInfo>('/api/admin/system');
  }
  pause(target: string) {
    return this.api.post<PauseResult[]>('/api/admin/system/pause', { target });
  }
  unpause(target: string) {
    return this.api.post<PauseResult[]>('/api/admin/system/unpause', { target });
  }
  createProduct(body: CreateProductBody) {
    return this.api.post<TxResult>('/api/admin/products', body);
  }
  setProductActive(id: number, active: boolean) {
    return this.api.patch<TxResult>(`/api/admin/products/${id}/active`, { active });
  }
  setCoolingOff(seconds: number) {
    return this.api.post<TxResult>('/api/admin/cooling-off', { seconds });
  }
  oracleStatus() {
    return this.api.get<OracleStatus>('/api/admin/oracle-status');
  }
  runOracle(skipWeather: boolean) {
    return this.api.post<CycleResult>(`/api/admin/oracle/run-now?skipWeather=${skipWeather}`);
  }
  simulate(body: SimulateBody) {
    return this.api.post<{ txHash: string }>('/api/admin/oracle/simulate', body);
  }
  payouts(page: number) {
    return this.api.get<PayoutPage>('/api/admin/payouts', { page, pageSize: 20 });
  }
}
