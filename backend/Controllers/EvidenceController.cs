using System.Security.Cryptography;
using backend.Common;
using backend.Data;
using backend.Data.Entities;
using backend.Services.App;
using MetadataExtractor;
using MetadataExtractor.Formats.Exif;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;

namespace backend.Controllers
{
    /// <summary>
    /// Hồ sơ bằng chứng xác minh policy (SPEC-B mục 4). Ảnh lưu ở Supabase Storage (bucket riêng tư),
    /// thông tin và hash lưu ở bảng evidence_meta.
    /// </summary>
    [ApiController]
    [Route("api/evidence")]
    [EnableRateLimiting("evidence")]
    public class EvidenceController : ControllerBase
    {
        private static readonly string[] Kinds = { "selfie", "field", "document" };
        private const long MaxFileBytes = 10_000_000;
        private const int SignedUrlSeconds = 300;

        private readonly AppDbContext _db;
        private readonly IPolicyChainReader _chain;
        private readonly IEvidenceStorage _storage;
        private readonly ILogger<EvidenceController> _logger;

        public EvidenceController(AppDbContext db, IPolicyChainReader chain, IEvidenceStorage storage,
            ILogger<EvidenceController> logger)
        {
            _db = db;
            _chain = chain;
            _storage = storage;
            _logger = logger;
        }

        // ============ Nông dân gửi ảnh ============

        [Authorize(Roles = "farmer")]
        [HttpPost("{policyId}")]
        [RequestSizeLimit(35_000_000)]
        public async Task<IActionResult> Upload(ulong policyId, [FromForm] EvidenceForm form, CancellationToken ct)
        {
            var wallet = User.GetWallet();
            if (wallet == null) return ApiResults.Unauthorized("Phiên đăng nhập không hợp lệ");
            if (policyId == 0 || policyId > long.MaxValue) return ApiResults.NotFound("Không tìm thấy policy");
            var id = (long)policyId;

            // 1. Policy phải tồn tại on-chain
            ChainPolicy policy;
            try
            {
                policy = await _chain.GetPolicyAsync(policyId, ct);
            }
            catch (ChainNotConfiguredException ex)
            {
                return ApiResults.ServiceUnavailable(ex.Message);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Không đọc được policy {PolicyId} từ blockchain", policyId);
                return ApiResults.BadGateway("Không đọc được dữ liệu blockchain, vui lòng thử lại sau");
            }
            if (!policy.Exists) return ApiResults.NotFound("Không tìm thấy policy");

            // 2. Chỉ chủ policy
            if (policy.Holder != wallet)
                return ApiResults.Forbidden("Bạn không phải chủ của policy này");

            // 3. Phải đang chờ xác minh
            if (policy.Status != 0)
                return ApiResults.Conflict("Policy không còn ở trạng thái chờ xác minh");

            // 4. Chưa khoá và chưa có evidence on-chain
            var meta = await _db.EvidenceMetas.FirstOrDefaultAsync(m => m.PolicyId == id, ct);
            bool onChain;
            try
            {
                onChain = await _chain.HasEvidenceOnChainAsync(policyId, ct);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Không đọc được evidence on-chain của policy {PolicyId}", policyId);
                return ApiResults.BadGateway("Không đọc được dữ liệu blockchain, vui lòng thử lại sau");
            }

            if (onChain && meta is { Locked: false })
            {
                meta.Locked = true;
                await _db.SaveChangesAsync(ct);
            }
            if (onChain || meta is { Locked: true })
                return ApiResults.Conflict("Hồ sơ đã gửi lên blockchain, không thể thay thế");

            // 5–6. Kiểm tra ảnh, đọc vào bộ nhớ, tính SHA-256
            if (!IsValidCoordinate(form.Lat, form.Lng))
                return ApiResults.BadRequest("Toạ độ khai báo không hợp lệ", "VALIDATION");

            var inputs = new (string Kind, IFormFile? File)[]
            {
                ("selfie", form.Selfie),
                ("field", form.Field),
                ("document", form.Document),
            };

            var images = new Dictionary<string, LoadedImage>();
            foreach (var (kind, file) in inputs)
            {
                var label = Label(kind);
                if (file == null || file.Length == 0)
                    return ApiResults.BadRequest($"Thiếu ảnh {label}", "VALIDATION");
                if (file.Length > MaxFileBytes)
                    return ApiResults.BadRequest($"Ảnh {label} vượt quá 10 MB", "VALIDATION");
                if (!file.ContentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase))
                    return ApiResults.BadRequest($"File {label} không phải ảnh", "VALIDATION");

                byte[] bytes;
                using (var ms = new MemoryStream((int)file.Length))
                {
                    await file.CopyToAsync(ms, ct);
                    bytes = ms.ToArray();
                }

                var format = DetectFormat(bytes);
                if (format == null)
                    return ApiResults.BadRequest(
                        $"Ảnh {label} không đúng định dạng (chỉ nhận JPEG, PNG, WEBP, HEIC)", "VALIDATION");

                images[kind] = new LoadedImage(bytes, format.Value.Ext, format.Value.ContentType, Sha256Hex(bytes));
            }

            // 7. EXIF GPS của ảnh ruộng, so với toạ độ khai báo
            var exif = ReadExifGps(images["field"].Bytes);
            double? distance = exif is null
                ? null
                : HaversineMeters(form.Lat, form.Lng, exif.Value.lat, exif.Value.lng);

            // 8. Upload (ghi đè được vì chưa khoá), rồi upsert evidence_meta
            var paths = Kinds.ToDictionary(k => k, k => $"{policyId}/{k}{images[k].Ext}");
            try
            {
                foreach (var kind in Kinds)
                {
                    using var stream = new MemoryStream(images[kind].Bytes, writable: false);
                    await _storage.UploadAsync(paths[kind], stream, images[kind].ContentType, ct);
                }
            }
            catch (InvalidOperationException ex)
            {
                _logger.LogError(ex, "Không lưu được ảnh bằng chứng của policy {PolicyId}", policyId);
                return ApiResults.BadGateway("Không lưu được ảnh, vui lòng thử lại sau");
            }

            var oldPaths = meta == null
                ? Array.Empty<string>()
                : new[] { meta.SelfiePath, meta.FieldPath, meta.DocumentPath };

            if (meta == null)
            {
                meta = new EvidenceMeta { PolicyId = id };
                _db.EvidenceMetas.Add(meta);
            }
            meta.Holder = wallet;
            meta.DeclaredLat = form.Lat;
            meta.DeclaredLng = form.Lng;
            meta.GpsAccuracy = form.Accuracy;
            meta.ExifGpsPresent = exif is not null;
            meta.ExifLat = exif?.lat;
            meta.ExifLng = exif?.lng;
            meta.DistanceMeters = distance;
            meta.SelfieHash = images["selfie"].Hash;
            meta.FieldHash = images["field"].Hash;
            meta.DocumentHash = images["document"].Hash;
            meta.SelfiePath = paths["selfie"];
            meta.FieldPath = paths["field"];
            meta.DocumentPath = paths["document"];
            meta.UploadedAt = DateTimeOffset.UtcNow;
            await _db.SaveChangesAsync(ct);

            // Dọn file cũ nếu lần trước dùng đuôi khác (ví dụ .png rồi nay .jpg). Lỗi dọn không ảnh hưởng kết quả.
            foreach (var old in oldPaths.Where(o => !paths.ContainsValue(o)))
            {
                try
                {
                    await _storage.DeleteAsync(old, ct);
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Không xoá được ảnh cũ {Path}", old);
                }
            }

            _logger.LogInformation("Nhận hồ sơ policy {PolicyId}, lệch EXIF = {Distance} m", policyId, distance);

            // 9.
            return Ok(new
            {
                policyId,
                selfieHash = meta.SelfieHash,
                fieldPhotoHash = meta.FieldHash,
                documentHash = meta.DocumentHash,
                exifGpsPresent = meta.ExifGpsPresent,
                distanceMeters = meta.DistanceMeters,
            });
        }

        // ============ Xem hồ sơ ============

        [Authorize]
        [HttpGet("{policyId}/meta")]
        public async Task<IActionResult> GetMeta(ulong policyId, CancellationToken ct)
        {
            var (meta, error) = await LoadAccessibleMetaAsync(policyId, ct);
            if (error != null) return error;

            // Giữ tên field cũ của frontend admin, thêm selfieHash, uploadedAt, locked.
            return Ok(new
            {
                policyId = meta!.PolicyId,
                holder = meta.Holder,
                declaredLat = meta.DeclaredLat,
                declaredLng = meta.DeclaredLng,
                gpsAccuracy = meta.GpsAccuracy,
                exifGpsPresent = meta.ExifGpsPresent,
                exifLat = meta.ExifLat,
                exifLng = meta.ExifLng,
                distanceMeters = meta.DistanceMeters,
                selfieHash = meta.SelfieHash,
                fieldPhotoHash = meta.FieldHash,
                documentHash = meta.DocumentHash,
                uploadedAt = meta.UploadedAt,
                locked = meta.Locked,
            });
        }

        [Authorize]
        [HttpGet("{policyId}/{kind}")]
        public async Task<IActionResult> GetImageUrl(ulong policyId, string kind, CancellationToken ct)
        {
            if (!Kinds.Contains(kind))
                return ApiResults.BadRequest("Loại ảnh không hợp lệ (selfie, field hoặc document)", "VALIDATION");

            var (meta, error) = await LoadAccessibleMetaAsync(policyId, ct);
            if (error != null) return error;

            var path = kind switch
            {
                "selfie" => meta!.SelfiePath,
                "field" => meta!.FieldPath,
                _ => meta!.DocumentPath,
            };

            try
            {
                var url = await _storage.CreateSignedUrlAsync(path, SignedUrlSeconds, ct);
                return Ok(new { url, expiresIn = SignedUrlSeconds });
            }
            catch (InvalidOperationException ex)
            {
                _logger.LogError(ex, "Không tạo được signed URL cho {Path}", path);
                return ApiResults.BadGateway("Không lấy được ảnh, vui lòng thử lại sau");
            }
        }

        /// <summary>Admin/CSKH xem mọi hồ sơ; nông dân chỉ xem hồ sơ của chính mình.</summary>
        private async Task<(EvidenceMeta? Meta, IActionResult? Error)> LoadAccessibleMetaAsync(
            ulong policyId, CancellationToken ct)
        {
            if (policyId == 0 || policyId > long.MaxValue)
                return (null, ApiResults.NotFound("Chưa có hồ sơ bằng chứng cho policy này"));

            var role = User.GetRole();
            if (role != "admin" && role != "support" && role != "farmer")
                return (null, ApiResults.Forbidden());

            var meta = await _db.EvidenceMetas.AsNoTracking()
                .FirstOrDefaultAsync(m => m.PolicyId == (long)policyId, ct);
            if (meta == null)
                return (null, ApiResults.NotFound("Chưa có hồ sơ bằng chứng cho policy này"));

            if (role == "farmer" && meta.Holder != User.GetWallet())
                return (null, ApiResults.Forbidden());

            return (meta, null);
        }

        // ============ Hàm phụ ============

        private sealed record LoadedImage(byte[] Bytes, string Ext, string ContentType, string Hash);

        private static string Label(string kind) => kind switch
        {
            "selfie" => "chân dung",
            "field" => "ruộng",
            _ => "giấy tờ",
        };

        private static bool IsValidCoordinate(double lat, double lng) =>
            !double.IsNaN(lat) && !double.IsNaN(lng) && lat is >= -90 and <= 90 && lng is >= -180 and <= 180;

        /// <summary>Nhận diện định dạng ảnh bằng magic bytes: JPEG, PNG, WEBP, HEIC.</summary>
        private static (string Ext, string ContentType)? DetectFormat(byte[] b)
        {
            if (b.Length >= 3 && b[0] == 0xFF && b[1] == 0xD8 && b[2] == 0xFF)
                return (".jpg", "image/jpeg");

            if (b.Length >= 4 && b[0] == 0x89 && b[1] == 0x50 && b[2] == 0x4E && b[3] == 0x47)
                return (".png", "image/png");

            // WEBP: "RIFF" + 4 byte kích thước + "WEBP"
            if (b.Length >= 12 && b[0] == 'R' && b[1] == 'I' && b[2] == 'F' && b[3] == 'F'
                && b[8] == 'W' && b[9] == 'E' && b[10] == 'B' && b[11] == 'P')
                return (".webp", "image/webp");

            // HEIC: 4 byte kích thước + "ftyp" + brand
            if (b.Length >= 12 && b[4] == 'f' && b[5] == 't' && b[6] == 'y' && b[7] == 'p')
            {
                var brand = System.Text.Encoding.ASCII.GetString(b, 8, 4);
                if (brand is "heic" or "heix" or "heim" or "heis" or "hevc" or "hevx" or "mif1" or "msf1")
                    return (".heic", "image/heic");
            }

            return null;
        }

        private static string Sha256Hex(byte[] bytes) =>
            "0x" + Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();

        private static (double lat, double lng)? ReadExifGps(byte[] bytes)
        {
            try
            {
                using var ms = new MemoryStream(bytes);
                var gps = ImageMetadataReader.ReadMetadata(ms).OfType<GpsDirectory>().FirstOrDefault();
                var loc = gps?.GetGeoLocation();
                if (loc is null) return null;
                return (loc.Value.Latitude, loc.Value.Longitude);
            }
            catch
            {
                return null; // định dạng không đọc được (ví dụ HEIC) hoặc EXIF bị xoá
            }
        }

        private static double HaversineMeters(double lat1, double lng1, double lat2, double lng2)
        {
            const double R = 6_371_000;
            static double Rad(double d) => d * Math.PI / 180;
            var dLat = Rad(lat2 - lat1);
            var dLng = Rad(lng2 - lng1);
            var a = Math.Sin(dLat / 2) * Math.Sin(dLat / 2)
                  + Math.Cos(Rad(lat1)) * Math.Cos(Rad(lat2)) * Math.Sin(dLng / 2) * Math.Sin(dLng / 2);
            return 2 * R * Math.Asin(Math.Sqrt(a));
        }
    }

    /// <summary>Form multipart giữ nguyên như trước: holder không còn dùng (server lấy chủ từ JWT).</summary>
    public class EvidenceForm
    {
        public string? Holder { get; set; }
        public double Lat { get; set; }
        public double Lng { get; set; }
        public double Accuracy { get; set; }
        public IFormFile? Selfie { get; set; }
        public IFormFile? Field { get; set; }
        public IFormFile? Document { get; set; }
    }
}
