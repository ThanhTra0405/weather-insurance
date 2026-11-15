using backend.Common;
using backend.Data;
using backend.Data.Entities;
using backend.Services.App;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace backend.Controllers
{
    /// <summary>Mẫu trả lời và tra cứu nông dân cho CSKH (SPEC-B mục 6.2 và 6.3). Admin và support dùng được.</summary>
    [ApiController]
    [Authorize(Roles = "admin,support")]
    [Route("api/support")]
    public class SupportController : ControllerBase
    {
        private const int TitleMin = 2;
        private const int TitleMax = 100;
        private const int BodyMax = 2000;
        private const int LookupLimit = 20;
        private const double ExifWarningMeters = 300; // cùng ngưỡng với trang duyệt hồ sơ của admin

        private readonly AppDbContext _db;
        private readonly IPolicyChainReader _chain;
        private readonly ILogger<SupportController> _logger;

        public SupportController(AppDbContext db, IPolicyChainReader chain, ILogger<SupportController> logger)
        {
            _db = db;
            _chain = chain;
            _logger = logger;
        }

        // ============ Mẫu trả lời ============

        [HttpGet("canned-replies")]
        public async Task<IActionResult> ListCanned(CancellationToken ct)
        {
            var rows = await _db.CannedReplies.AsNoTracking()
                .OrderBy(r => r.Title).ThenBy(r => r.Id)
                .ToListAsync(ct);
            var names = await LoadStaffNamesAsync(
                rows.Where(r => r.CreatedBy != null).Select(r => r.CreatedBy!.Value), ct);

            return Ok(rows.Select(r => ToCannedDto(r, names)).ToList());
        }

        [HttpPost("canned-replies")]
        public async Task<IActionResult> CreateCanned([FromBody] CannedReplyRequest? request, CancellationToken ct)
        {
            var staffId = User.GetStaffId();
            if (staffId == null) return ApiResults.Unauthorized("Phiên đăng nhập không hợp lệ");

            var fields = ValidateCanned(request, out var title, out var body);
            if (fields.Count > 0) return ApiResults.Validation(fields);

            var reply = new CannedReply
            {
                Title = title,
                Body = body,
                CreatedBy = staffId.Value,
                CreatedAt = DateTimeOffset.UtcNow,
            };
            _db.CannedReplies.Add(reply);
            await _db.SaveChangesAsync(ct);

            var names = await LoadStaffNamesAsync(new[] { staffId.Value }, ct);
            return Ok(ToCannedDto(reply, names));
        }

        [HttpPut("canned-replies/{id:long}")]
        public async Task<IActionResult> UpdateCanned(long id, [FromBody] CannedReplyRequest? request,
            CancellationToken ct)
        {
            var reply = await _db.CannedReplies.FirstOrDefaultAsync(r => r.Id == id, ct);
            if (reply == null) return ApiResults.NotFound("Không tìm thấy mẫu trả lời");
            if (!CanModify(reply)) return ApiResults.Forbidden("Chỉ người tạo hoặc admin được sửa mẫu này");

            var fields = ValidateCanned(request, out var title, out var body);
            if (fields.Count > 0) return ApiResults.Validation(fields);

            reply.Title = title;
            reply.Body = body;
            await _db.SaveChangesAsync(ct);

            var names = await LoadStaffNamesAsync(
                reply.CreatedBy != null ? new[] { reply.CreatedBy.Value } : Array.Empty<Guid>(), ct);
            return Ok(ToCannedDto(reply, names));
        }

        [HttpDelete("canned-replies/{id:long}")]
        public async Task<IActionResult> DeleteCanned(long id, CancellationToken ct)
        {
            var reply = await _db.CannedReplies.FirstOrDefaultAsync(r => r.Id == id, ct);
            if (reply == null) return ApiResults.NotFound("Không tìm thấy mẫu trả lời");
            if (!CanModify(reply)) return ApiResults.Forbidden("Chỉ người tạo hoặc admin được xoá mẫu này");

            _db.CannedReplies.Remove(reply);
            await _db.SaveChangesAsync(ct);
            return Ok(new { ok = true });
        }

        // ============ Tra cứu ============

        /// <summary>
        /// q là ví (bắt đầu 0x), policyId (1–9 chữ số), số điện thoại (bắt đầu 0 hoặc +84, 9–11 chữ số) hoặc tên.
        /// Trả { kind, query, matchedPolicyId, items } với tối đa 20 nông dân; support thấy email/số điện thoại đã che.
        /// </summary>
        [HttpGet("lookup")]
        public async Task<IActionResult> Lookup([FromQuery] string? q, CancellationToken ct)
        {
            var term = (q ?? "").Trim();
            if (term.Length == 0)
                return ApiResults.Validation(new Dictionary<string, string>
                {
                    ["q"] = "Nhập địa chỉ ví, mã policy, số điện thoại hoặc tên nông dân",
                });

            var mask = User.GetRole() == "support";
            var compact = term.Replace(" ", "").Replace(".", "").Replace("-", "");
            var digitsOnly = compact.TrimStart('+');

            IQueryable<FarmerProfile> query = _db.FarmerProfiles.AsNoTracking();
            string kind;
            long? matchedPolicyId = null;

            if (term.StartsWith("0x", StringComparison.OrdinalIgnoreCase))
            {
                kind = "wallet";
                var lower = term.ToLowerInvariant();
                if (WalletAddress.TryNormalize(term, out var wallet))
                {
                    query = query.Where(p => p.WalletAddress == wallet);
                }
                else
                {
                    if (lower.Length < 6)
                        return ApiResults.Validation(new Dictionary<string, string>
                        {
                            ["q"] = "Nhập ít nhất 6 ký tự của địa chỉ ví",
                        });
                    query = query.Where(p => p.WalletAddress.StartsWith(lower));
                }
            }
            else if (compact.Length is >= 1 and <= 9 && compact.All(char.IsDigit))
            {
                kind = "policy";
                var policyId = long.Parse(compact);
                matchedPolicyId = policyId;
                var holder = await FindPolicyHolderAsync(policyId, ct);
                if (holder == null)
                    return Ok(new { kind, query = term, matchedPolicyId, items = Array.Empty<object>() });
                query = query.Where(p => p.WalletAddress == holder);
            }
            else if ((compact.StartsWith('0') || compact.StartsWith("+84", StringComparison.Ordinal))
                     && digitsOnly.All(char.IsDigit) && digitsOnly.Length is >= 9 and <= 11)
            {
                kind = "phone";
                // Khớp theo 9 số cuối để không phụ thuộc cách nhập 0912… hay +84912…
                var tail = digitsOnly.Length > 9 ? digitsOnly[^9..] : digitsOnly;
                query = query.Where(p => p.Phone.EndsWith(tail));
            }
            else
            {
                kind = "name";
                var pattern = SqlLike.Contains(term);
                query = query.Where(p => EF.Functions.ILike(p.FullName, pattern));
            }

            var profiles = await query.OrderBy(p => p.FullName).ThenBy(p => p.WalletAddress)
                .Take(LookupLimit).ToListAsync(ct);
            if (profiles.Count == 0)
                return Ok(new { kind, query = term, matchedPolicyId, items = Array.Empty<object>() });

            var wallets = profiles.Select(p => p.WalletAddress).ToList();

            var policies = await _db.PoliciesCache.AsNoTracking()
                .Where(p => wallets.Contains(p.Holder))
                .OrderByDescending(p => p.PolicyId)
                .ToListAsync(ct);

            var productIds = policies.Select(p => p.ProductId).Distinct().ToList();
            var productNames = await _db.ProductsCache.AsNoTracking()
                .Where(p => productIds.Contains(p.ProductId))
                .ToDictionaryAsync(p => p.ProductId, p => p.Name, ct);

            var evidences = await _db.EvidenceMetas.AsNoTracking()
                .Where(m => wallets.Contains(m.Holder))
                .Select(m => new { m.Holder, m.PolicyId, m.ExifGpsPresent, m.DistanceMeters })
                .ToListAsync(ct);

            var openTickets = await _db.Tickets.AsNoTracking()
                .Where(t => wallets.Contains(t.WalletAddress) && TicketText.OpenStatuses.Contains(t.Status))
                .OrderByDescending(t => t.UpdatedAt)
                .Select(t => new { t.Id, t.WalletAddress, t.Subject, t.Status, t.UpdatedAt })
                .ToListAsync(ct);

            var evidencePolicyIds = evidences.Select(e => e.PolicyId).ToHashSet();

            var items = profiles.Select(p =>
            {
                var myEvidence = evidences.Where(e => e.Holder == p.WalletAddress).ToList();
                return new
                {
                    profile = new
                    {
                        walletAddress = p.WalletAddress,
                        fullName = p.FullName,
                        phone = mask ? PiiMask.Phone(p.Phone) : p.Phone,
                        email = mask ? PiiMask.Email(p.Email) : p.Email,
                        province = p.Province,
                        district = p.District,
                        commune = p.Commune,
                        cropType = p.CropType,
                        farmAreaHa = p.FarmAreaHa,
                        createdAt = p.CreatedAt,
                    },
                    policies = policies.Where(x => x.Holder == p.WalletAddress).Select(x => new
                    {
                        policyId = x.PolicyId,
                        productId = x.ProductId,
                        productName = productNames.TryGetValue(x.ProductId, out var name) ? name : null,
                        perilType = x.PerilType,
                        status = x.Status,
                        rejected = x.Rejected,
                        startTime = x.StartTime,
                        endTime = x.EndTime,
                        premiumWei = x.PremiumWei.ToString(),
                        coverageWei = x.CoverageWei.ToString(),
                        hasEvidence = evidencePolicyIds.Contains(x.PolicyId),
                    }).ToList(),
                    evidenceSummary = new
                    {
                        hasEvidence = myEvidence.Count > 0,
                        exifWarning = myEvidence.Any(e =>
                            !e.ExifGpsPresent || (e.DistanceMeters ?? 0) > ExifWarningMeters),
                    },
                    openTickets = openTickets.Where(t => t.WalletAddress == p.WalletAddress).Take(5)
                        .Select(t => new { id = t.Id, subject = t.Subject, status = t.Status, updatedAt = t.UpdatedAt })
                        .ToList(),
                };
            }).ToList();

            return Ok(new { kind, query = term, matchedPolicyId, items });
        }

        // ============ Hàm phụ ============

        private bool CanModify(CannedReply reply) =>
            User.GetRole() == "admin" || (reply.CreatedBy != null && reply.CreatedBy == User.GetStaffId());

        private static Dictionary<string, string> ValidateCanned(CannedReplyRequest? request,
            out string title, out string body)
        {
            var fields = new Dictionary<string, string>();
            title = request?.Title?.Trim() ?? "";
            body = request?.Body?.Trim() ?? "";

            if (title.Length < TitleMin || title.Length > TitleMax)
                fields["title"] = $"Tiêu đề phải từ {TitleMin} đến {TitleMax} ký tự";
            if (body.Length < 1 || body.Length > BodyMax)
                fields["body"] = $"Nội dung phải từ 1 đến {BodyMax} ký tự";
            return fields;
        }

        private object ToCannedDto(CannedReply r, Dictionary<Guid, string> names) => new
        {
            id = r.Id,
            title = r.Title,
            body = r.Body,
            createdBy = r.CreatedBy,
            createdByName = r.CreatedBy != null && names.TryGetValue(r.CreatedBy.Value, out var n) ? n : null,
            createdAt = r.CreatedAt,
            canEdit = CanModify(r),
        };

        private async Task<Dictionary<Guid, string>> LoadStaffNamesAsync(IEnumerable<Guid> ids, CancellationToken ct)
        {
            var list = ids.Distinct().ToList();
            if (list.Count == 0) return new Dictionary<Guid, string>();

            return await _db.Staff.AsNoTracking()
                .Where(s => list.Contains(s.Id))
                .ToDictionaryAsync(s => s.Id, s => s.FullName, ct);
        }

        /// <summary>Chủ policy: policies_cache (A) → evidence_meta → đọc blockchain.</summary>
        private async Task<string?> FindPolicyHolderAsync(long policyId, CancellationToken ct)
        {
            var cached = await _db.PoliciesCache.AsNoTracking()
                .Where(p => p.PolicyId == policyId).Select(p => p.Holder).FirstOrDefaultAsync(ct);
            if (cached != null) return cached.ToLowerInvariant();

            var fromEvidence = await _db.EvidenceMetas.AsNoTracking()
                .Where(m => m.PolicyId == policyId).Select(m => m.Holder).FirstOrDefaultAsync(ct);
            if (fromEvidence != null) return fromEvidence.ToLowerInvariant();

            try
            {
                var onChain = await _chain.GetPolicyAsync((ulong)policyId, ct);
                return onChain.Exists ? onChain.Holder : null;
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Không đọc được chủ của policy {PolicyId} khi tra cứu", policyId);
                return null;
            }
        }
    }

    public record CannedReplyRequest(string? Title, string? Body);
}
