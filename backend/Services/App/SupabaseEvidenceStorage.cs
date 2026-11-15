using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using backend.Options;
using Microsoft.Extensions.Options;

namespace backend.Services.App;

/// <summary>Cài đặt IEvidenceStorage bằng REST API của Supabase Storage (khoá service_role, chỉ dùng ở backend).</summary>
public class SupabaseEvidenceStorage : IEvidenceStorage
{
    private readonly IHttpClientFactory _httpFactory;
    private readonly SupabaseOptions _options;
    private readonly ILogger<SupabaseEvidenceStorage> _logger;

    public SupabaseEvidenceStorage(IHttpClientFactory httpFactory, IOptions<SupabaseOptions> options,
        ILogger<SupabaseEvidenceStorage> logger)
    {
        _httpFactory = httpFactory;
        _options = options.Value;
        _logger = logger;
    }

    public async Task UploadAsync(string path, Stream data, string contentType, CancellationToken ct = default)
    {
        using var request = CreateRequest(HttpMethod.Post, $"object/{_options.EvidenceBucket}/{EncodePath(path)}");
        request.Headers.Add("x-upsert", "true");
        var content = new StreamContent(data);
        content.Headers.ContentType = new MediaTypeHeaderValue(contentType);
        request.Content = content;

        await SendAsync(request, "tải ảnh lên", ct);
    }

    public async Task<string> CreateSignedUrlAsync(string path, int expiresInSeconds, CancellationToken ct = default)
    {
        using var request = CreateRequest(HttpMethod.Post, $"object/sign/{_options.EvidenceBucket}/{EncodePath(path)}");
        request.Content = JsonContent.Create(new { expiresIn = expiresInSeconds });

        using var response = await SendAsync(request, "tạo đường dẫn xem ảnh", ct);
        var body = await response.Content.ReadFromJsonAsync<SignedUrlResponse>(cancellationToken: ct);
        var signed = body?.SignedURL;
        if (string.IsNullOrEmpty(signed))
            throw new InvalidOperationException("Supabase Storage không trả về signedURL");

        // signedURL có dạng "/object/sign/{bucket}/{path}?token=..." (không kèm /storage/v1).
        if (!signed.StartsWith('/')) signed = "/" + signed;
        if (!signed.StartsWith("/storage/v1", StringComparison.Ordinal)) signed = "/storage/v1" + signed;
        return BaseUrl() + signed;
    }

    public async Task DeleteAsync(string path, CancellationToken ct = default)
    {
        using var request = CreateRequest(HttpMethod.Delete, $"object/{_options.EvidenceBucket}/{EncodePath(path)}");
        using var response = await _httpFactory.CreateClient().SendAsync(request, ct);
        if (response.StatusCode == HttpStatusCode.NotFound) return;
        await EnsureSuccessAsync(response, "xoá ảnh");
    }

    public async Task EnsureBucketAsync(CancellationToken ct = default)
    {
        var bucket = _options.EvidenceBucket;
        var client = _httpFactory.CreateClient();

        using (var check = CreateRequest(HttpMethod.Get, $"bucket/{Uri.EscapeDataString(bucket)}"))
        using (var checkResponse = await client.SendAsync(check, ct))
        {
            if (checkResponse.IsSuccessStatusCode) return;

            // Supabase có thể trả 404 hoặc 400 kèm "Bucket not found".
            var text = await checkResponse.Content.ReadAsStringAsync(ct);
            var notFound = checkResponse.StatusCode == HttpStatusCode.NotFound
                || text.Contains("not found", StringComparison.OrdinalIgnoreCase);
            if (!notFound)
                throw new InvalidOperationException(
                    $"Không kiểm tra được bucket '{bucket}' ({(int)checkResponse.StatusCode}): {Truncate(text)}");
        }

        using var create = CreateRequest(HttpMethod.Post, "bucket");
        create.Content = JsonContent.Create(new { id = bucket, name = bucket, @public = false });
        using var createResponse = await client.SendAsync(create, ct);
        if (createResponse.StatusCode == HttpStatusCode.Conflict) return; // đã có (tạo song song)
        await EnsureSuccessAsync(createResponse, "tạo bucket");

        _logger.LogInformation("Đã tạo bucket Storage riêng tư '{Bucket}'.", bucket);
    }

    // ---------- hàm phụ ----------

    private HttpRequestMessage CreateRequest(HttpMethod method, string relative)
    {
        if (string.IsNullOrWhiteSpace(_options.Url) || string.IsNullOrWhiteSpace(_options.ServiceRoleKey))
            throw new InvalidOperationException("Chưa cấu hình Supabase:Url hoặc Supabase:ServiceRoleKey");

        var request = new HttpRequestMessage(method, $"{BaseUrl()}/storage/v1/{relative}");
        request.Headers.Add("apikey", _options.ServiceRoleKey);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _options.ServiceRoleKey);
        return request;
    }

    private async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, string action, CancellationToken ct)
    {
        var response = await _httpFactory.CreateClient().SendAsync(request, ct);
        try
        {
            await EnsureSuccessAsync(response, action);
            return response;
        }
        catch
        {
            response.Dispose();
            throw;
        }
    }

    private async Task EnsureSuccessAsync(HttpResponseMessage response, string action)
    {
        if (response.IsSuccessStatusCode) return;
        var text = await response.Content.ReadAsStringAsync();
        _logger.LogError("Supabase Storage lỗi khi {Action}: {Status} {Body}", action, (int)response.StatusCode, Truncate(text));
        throw new InvalidOperationException($"Supabase Storage lỗi khi {action} ({(int)response.StatusCode})");
    }

    private string BaseUrl() => _options.Url.TrimEnd('/');

    private static string EncodePath(string path) =>
        string.Join('/', path.Split('/').Select(Uri.EscapeDataString));

    private static string Truncate(string text) => text.Length <= 300 ? text : text[..300];

    private sealed record SignedUrlResponse(string? SignedURL);
}
