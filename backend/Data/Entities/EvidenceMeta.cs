namespace backend.Data.Entities;

/// <summary>Thông tin hồ sơ bằng chứng của một policy (ảnh nằm ở Supabase Storage).</summary>
public class EvidenceMeta
{
    public long PolicyId { get; set; }
    public string Holder { get; set; } = "";
    public double DeclaredLat { get; set; }
    public double DeclaredLng { get; set; }
    public double GpsAccuracy { get; set; }
    public bool ExifGpsPresent { get; set; }
    public double? ExifLat { get; set; }
    public double? ExifLng { get; set; }
    public double? DistanceMeters { get; set; }
    public string SelfieHash { get; set; } = "";
    public string FieldHash { get; set; } = "";
    public string DocumentHash { get; set; } = "";
    public string SelfiePath { get; set; } = "";
    public string FieldPath { get; set; } = "";
    public string DocumentPath { get; set; } = "";

    /// <summary>true khi hash đã lên chain, cấm upload lại.</summary>
    public bool Locked { get; set; }
    public DateTimeOffset UploadedAt { get; set; }
}
