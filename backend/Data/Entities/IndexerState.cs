namespace backend.Data.Entities;

/// <summary>Block cuối cùng indexer đã xử lý (luôn chỉ có một dòng, Id = 1).</summary>
public class IndexerState
{
    public int Id { get; set; } = 1;
    public long LastBlock { get; set; }
}
