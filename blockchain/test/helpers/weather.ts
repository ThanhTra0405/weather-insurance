export async function setWeatherAboveThreshold(
    oracle: any, owner: any, regionId: string, threshold: bigint, timestamp: number
): Promise<void> {
    await oracle.connect(owner).setWeatherData(regionId, threshold + 1n, BigInt(timestamp));
}

export async function setWeatherBelowThreshold(
    oracle: any, owner: any, regionId: string, threshold: bigint, timestamp: number
): Promise<void> {
    if (threshold === 0n) throw new Error("threshold = 0, khong tao duoc gia tri nho hon");
    await oracle.connect(owner).setWeatherData(regionId, threshold - 1n, BigInt(timestamp));
}

export async function setWeatherStale(
    oracle: any, owner: any, regionId: string, value: bigint, staleTimestamp: number
): Promise<void> {
    await oracle.connect(owner).setWeatherData(regionId, value, BigInt(staleTimestamp));
}

export async function setWeatherNotMet(
    oracle: any, owner: any, regionId: string, threshold: bigint, perilType: number, timestamp: number
): Promise<void> {
    if (perilType === 0) {
        await setWeatherAboveThreshold(oracle, owner, regionId, threshold, timestamp);
    } else {
        await setWeatherBelowThreshold(oracle, owner, regionId, threshold, timestamp);
    }
}