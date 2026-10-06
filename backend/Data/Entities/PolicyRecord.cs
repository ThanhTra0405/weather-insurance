namespace backend.Data.Entities
{
    public class PolicyRecord
    {
        public long PolicyId { get; set; }
        public long ProductId { get; set; }
        public string Holder { get; set; } = string.Empty;
        public decimal Lat { get; set; }
        public decimal Lng { get; set; }
        public string RegionId { get; set; } = string.Empty;
        public DateTimeOffset StartTime { get; set; }
        public DateTimeOffset EndTime { get; set; }
        public string PremiumPaidWei { get; set; } = string.Empty;
        public string CoverageAmountWei { get; set; } = string.Empty;
        public byte Status { get; set; }
        public DateTimeOffset SyncedAt { get; set; }
    }
}