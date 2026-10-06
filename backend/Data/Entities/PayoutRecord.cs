namespace backend.Data.Entities
{
    public class PayoutRecord
    {
        public long Id { get; set; }
        public long PolicyId { get; set; }
        public string TxHash { get; set; } = string.Empty;
        public DateTimeOffset CreatedAt { get; set; }
    }
}