namespace backend.Data.Entities
{
    public class OracleSubmission
    {
        public long Id { get; set; }
        public string RegionId { get; set; } = string.Empty;
        public decimal RainfallMm { get; set; } 
        public DateTimeOffset DateTimeStamp { get; set; }
        public string TxHash{ get; set; } = string.Empty;
        public DateTimeOffset CreatedAt { get; set; }
    }
}