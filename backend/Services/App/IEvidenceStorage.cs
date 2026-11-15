namespace backend.Services.App;

/// <summary>Lưu ảnh bằng chứng ở Supabase Storage (bucket riêng tư, chỉ truy cập qua signed URL).</summary>
public interface IEvidenceStorage
{
    /// <summary>Ghi đè nếu đã tồn tại. path dạng "{policyId}/{kind}{ext}".</summary>
    Task UploadAsync(string path, Stream data, string contentType, CancellationToken ct = default);

    /// <summary>URL tạm thời (hết hạn sau expiresInSeconds) để xem ảnh.</summary>
    Task<string> CreateSignedUrlAsync(string path, int expiresInSeconds, CancellationToken ct = default);

    /// <summary>Xoá file; không lỗi nếu file không tồn tại.</summary>
    Task DeleteAsync(string path, CancellationToken ct = default);

    /// <summary>Tạo bucket (private) nếu chưa có.</summary>
    Task EnsureBucketAsync(CancellationToken ct = default);
}
