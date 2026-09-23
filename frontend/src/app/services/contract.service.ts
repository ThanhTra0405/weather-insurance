import { Injectable, inject } from '@angular/core';
import { Contract, parseEther } from 'ethers';
import { Web3Service } from './web3.service';
import { environment } from '../../environments/environment';
import POLICY_MANAGER_ARTIFACT from '../../assets/abi/PolicyManager.json';

@Injectable({ providedIn: 'root' })
export class ContractService {
  private web3 = inject(Web3Service);

  private policyManager(): Contract {
    return new Contract(
      environment.policyManagerAddress,
      POLICY_MANAGER_ARTIFACT.abi,
      this.web3.getSigner()
    );
  }

  async buyPolicy(productId: number, latScaled: bigint, lngScaled: bigint, premiumEth: string) {
    const tx = await this.policyManager()['buyPolicy'](productId, latScaled, lngScaled, {
      value: parseEther(premiumEth),
    });
    return tx.wait();
  }

  async getActivePolicies(address: string): Promise<bigint[]> {
    return this.policyManager()['getPoliciesOf'](address);
  }

  async getPolicy(policyId: bigint) {
    return this.policyManager()['getPolicy'](policyId);
  }
}