namespace backend.Options;

/// <summary>Cấu hình Supabase Storage (khoá Supabase:*). ServiceRoleKey chỉ để trong user-secrets.</summary>
public class SupabaseOptions
{
    public const string SectionName = "Supabase";

    public string Url { get; set; } = "";
    public string ServiceRoleKey { get; set; } = "";
    public string EvidenceBucket { get; set; } = "evidence";
}
