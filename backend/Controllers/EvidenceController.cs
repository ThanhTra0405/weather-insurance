using System.Security.Cryptography;
using System.Text.Json;
using MetadataExtractor;
using MetadataExtractor.Formats.Exif;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.StaticFiles;
using Directory = System.IO.Directory;

namespace backend.Controllers
{
    [ApiController]
    [Route("api/evidence")]
    public class EvidenceController : ControllerBase
    {
        private static readonly string[] Kinds = { "selfie", "field", "document" };
        private static readonly string[] AllowedExt = { ".jpg", ".jpeg", ".png", ".webp", ".heic" };
        private const long MaxFileBytes = 10_000_000;

        private readonly string _root;
        private readonly ILogger<EvidenceController> _logger;

        public EvidenceController(IWebHostEnvironment env, ILogger<EvidenceController> logger)
        {
            _root = Path.Combine(env.ContentRootPath, "EvidenceStore");
            _logger = logger;
        }

        [HttpPost("{policyId}")]
        [RequestSizeLimit(35_000_000)]
        public async Task<IActionResult> Upload(ulong policyId, [FromForm] EvidenceForm form, CancellationToken ct)
        {
            var files = new Dictionary<string, IFormFile>
            {
                ["selfie"] = form.Selfie,
                ["field"] = form.Field,
                ["document"] = form.Document,
            };

            foreach (var (kind, file) in files)
            {
                if (file.Length == 0 || file.Length > MaxFileBytes)
                    return BadRequest(new { error = $"Anh {kind} rong hoac qua 10MB" });
                if (!file.ContentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase))
                    return BadRequest(new { error = $"File {kind} khong phai anh" });
            }

            var dir = Path.Combine(_root, policyId.ToString());
            Directory.CreateDirectory(dir);

            var paths = new Dictionary<string, string>();
            foreach (var (kind, file) in files)
            {
                var ext = Path.GetExtension(file.FileName).ToLowerInvariant();
                if (!AllowedExt.Contains(ext)) ext = ".jpg";

                foreach (var old in Directory.GetFiles(dir, kind + ".*")) System.IO.File.Delete(old);

                var path = Path.Combine(dir, kind + ext);
                await using var fs = System.IO.File.Create(path);
                await file.CopyToAsync(fs, ct);
                paths[kind] = path;
            }

            var exif = ReadExifGps(paths["field"]);
            double? distance = exif is null
                ? null
                : HaversineMeters(form.Lat, form.Lng, exif.Value.lat, exif.Value.lng);

            var meta = new
            {
                policyId,
                form.Holder,
                declaredLat = form.Lat,
                declaredLng = form.Lng,
                gpsAccuracy = form.Accuracy,
                exifLat = exif?.lat,
                exifLng = exif?.lng,
                exifGpsPresent = exif is not null,
                distanceMeters = distance,
                fieldPhotoHash = await HashAsync(paths["field"], ct),
                documentHash = await HashAsync(paths["document"], ct),
                uploadedAt = DateTime.UtcNow,
            };

            await System.IO.File.WriteAllTextAsync(
                Path.Combine(dir, "meta.json"),
                JsonSerializer.Serialize(meta), ct);

            _logger.LogInformation("Nhan ho so policy {PolicyId}, lech EXIF = {Distance} m", policyId, distance);
            return Ok(meta);
        }

        [AdminKey]
        [HttpGet("{policyId}/meta")]
        public IActionResult GetMeta(ulong policyId)
        {
            var path = Path.Combine(_root, policyId.ToString(), "meta.json");
            if (!System.IO.File.Exists(path)) return NotFound();
            return Content(System.IO.File.ReadAllText(path), "application/json");
        }

        [AdminKey]
        [HttpGet("{policyId}/{kind}")]
        public IActionResult GetImage(ulong policyId, string kind)
        {
            if (!Kinds.Contains(kind)) return NotFound();
            var dir = Path.Combine(_root, policyId.ToString());
            if (!Directory.Exists(dir)) return NotFound();

            var file = Directory.GetFiles(dir, kind + ".*").FirstOrDefault();
            if (file is null) return NotFound();

            new FileExtensionContentTypeProvider().TryGetContentType(file, out var contentType);
            return PhysicalFile(file, contentType ?? "application/octet-stream");
        }

        private static (double lat, double lng)? ReadExifGps(string path)
        {
            try
            {
                var gps = ImageMetadataReader.ReadMetadata(path).OfType<GpsDirectory>().FirstOrDefault();
                var loc = gps?.GetGeoLocation();
                if (loc is null) return null;
                return (loc.Value.Latitude, loc.Value.Longitude);
            }
            catch
            {
                return null; // định dạng không đọc được (VD HEIC) hoặc EXIF bị xoá
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

        private static async Task<string> HashAsync(string path, CancellationToken ct)
        {
            await using var fs = System.IO.File.OpenRead(path);
            var hash = await SHA256.HashDataAsync(fs, ct);
            return "0x" + Convert.ToHexString(hash).ToLowerInvariant();
        }
    }

    public class EvidenceForm
    {
        public string Holder { get; set; } = "";
        public double Lat { get; set; }
        public double Lng { get; set; }
        public double Accuracy { get; set; }
        public IFormFile Selfie { get; set; } = default!;
        public IFormFile Field { get; set; } = default!;
        public IFormFile Document { get; set; } = default!;
    }
}