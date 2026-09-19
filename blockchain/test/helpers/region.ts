// blockchain/test/helpers/region.ts
import { ethers } from "ethers";
export function computeRegionId(
  lat: number,
  lng: number,
  gridSizeDeg: number = 0.2
): string {
  const roundedLat = Math.round(lat / gridSizeDeg) * gridSizeDeg;
  const roundedLng = Math.round(lng / gridSizeDeg) * gridSizeDeg;
  return ethers.keccak256(
    ethers.solidityPacked(
      ["int256", "int256"],
      [Math.round(roundedLat * 1e6), Math.round(roundedLng * 1e6)]
    )
  );
}