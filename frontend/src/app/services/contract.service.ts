import { Injectable, inject } from '@angular/core';
import { Contract, parseEther } from 'ethers';
import { Web3Service } from './web3.service';
import { environment } from '../../environments/environment';
import POLICY_MANAGER_ARTIFACT from '../../assets/abi/PolicyManager.json';

@Injectable({ providedIn: 'root' })
export class ContractService {
  private web3 = inject(Web3Service);

  private policyManager(write = false): Contract {
    return new Contract(
      environment.policyManagerAddress,
      POLICY_MANAGER_ARTIFACT.abi,
      write ? this.web3.getSigner() : this.web3.getProvider()
    );
  }

  async buyPolicy(productId: number, latScaled: bigint, lngScaled: bigint, premiumEth: string) {
    const tx = await this.policyManager(true)['buyPolicy'](productId, latScaled, lngScaled, {
      value: parseEther(premiumEth),
    });
    return tx.wait();
  }

  async submitVerificationEvidence(policyId: bigint, fieldPhotoHash: string, documentHash: string) {
    const tx = await this.policyManager(true)['submitVerificationEvidence'](
      policyId,
      fieldPhotoHash,
      documentHash
    );
    return tx.wait();
  }

  async getProduct(productId: number) {
    return this.policyManager()['products'](productId);
  }

  async getEvidence(policyId: bigint) {
    return this.policyManager()['evidenceOf'](policyId);
  }

  async getActivePolicies(address: string): Promise<bigint[]> {
    return this.policyManager()['getPoliciesOf'](address);
  }

  async getPolicy(policyId: bigint) {
    return this.policyManager()['getPolicy'](policyId);
  }
}