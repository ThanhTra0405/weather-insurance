using backend.Common;
using backend.Data;
using backend.Data.Entities;
using backend.Services.App;
using backend.Services.interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace backend.Controllers
{
    /// <summary>
    /// Duyệt / từ chối hồ sơ xác minh (SPEC-B mục 5). Danh sách chờ duyệt do AdminPendingController của A phục vụ.
    /// Controller này KHÔNG tự tạo thông báo: indexer (A) bắn thông báo khi thấy event PolicyVerified.
    /// </summary>
    [ApiController]
    [Authorize]
    [Route("api/admin")]
    public class AdminReviewController : ControllerBase
    {
        private const int NoteMinLength = 5;
        private const int NoteMaxLength = 500;

        private readonly AppDbContext _db;
        private readonly IPolicyManagerClient _policyManager;
        private readonly IPolicyChainReader _chain;
        private readonly IAuditLog _audit;
        private readonly ILogger<AdminReviewController> _logger;

        public AdminReviewController(AppDbContext db, IPolicyManagerClient policyManager, IPolicyChainReader chain,
            IAuditLog audit, ILogger<AdminReviewController> logger)
        {
            _db = db;
            _policyManager = policyManager;
            _chain = chain;
            _audit = audit;
            _logger = logger;
        }

        [Authorize(Roles = "admin")]
        [HttpPost("review/{policyId}")]
        public async Task<IActionResult> ReviewPolicy(ulong policyId, [FromBody] ReviewRequest? request,
            CancellationToken ct)
        {
            if (request == null)
                return ApiResults.BadRequest("Thiếu dữ liệu duyệt hồ sơ", "VALIDATION");
            if (policyId == 0 || policyId > long.MaxValue)
                return ApiResults.NotFound("Không tìm thấy policy");

            var staffId = User.GetStaffId();
            if (staffId == null)
                return ApiResults.Unauthorized("Phiên đăng nhập không hợp lệ");

            var id = (long)policyId;
            var approved = request.Approved;

            // Ghi chú: bắt buộc khi từ chối.
            var note = string.IsNullOrWhiteSpace(request.Note) ? null : request.Note.Trim();
            if (!approved && (note == null || note.Length < NoteMinLength))
                return ApiResults.Validation(new Dictionary<string, string>
                {
                    ["note"] = $"Phải nhập lý do từ chối (ít nhất {NoteMinLength} ký tự)",
                });
            if (note != null && note.Length > NoteMaxLength)
                return ApiResults.Validation(new Dictionary<string, string>
                {
                    ["note"] = $"Ghi chú tối đa {NoteMaxLength} ký tự",
                });

            // 1. Policy phải đang chờ xác minh (đọc on-chain).
            ChainPolicy policy;
            ChainEvidence onChain;
            try
            {
                policy = await _chain.GetPolicyAsync(policyId, ct);
                if (!policy.Exists) return ApiResults.NotFound("Không tìm thấy policy");
                if (policy.Status != 0)
                    return ApiResults.Conflict("Policy không còn ở trạng thái chờ xác minh");

                onChain = await _chain.GetEvidenceAsync(policyId, ct);
            }
            catch (ChainNotConfiguredException ex)
            {
                return ApiResults.ServiceUnavailable(ex.Message);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Không đọc được policy {PolicyId} từ blockchain khi duyệt", policyId);
                return ApiResults.BadGateway("Không đọc được dữ liệu blockchain, vui lòng thử lại sau");
            }

            // 3. Duyệt: phải có hồ sơ, có hash on-chain và hai bên khớp nhau (kiểm tra phía server).
            if (approved)
            {
                var meta = await _db.EvidenceMetas.AsNoTracking().FirstOrDefaultAsync(m => m.PolicyId == id, ct);
                if (meta == null)
                    return ApiResults.Error(StatusCodes.Status422UnprocessableEntity,
                        "Chưa có hồ sơ bằng chứng, không thể duyệt", "NO_EVIDENCE");
                if (!onChain.Exists)
                    return ApiResults.Error(StatusCodes.Status422UnprocessableEntity,
                        "Nông dân chưa gửi hash hồ sơ lên blockchain, không thể duyệt", "NO_EVIDENCE_ONCHAIN");

                var fieldOk = string.Equals(onChain.FieldPhotoHash, meta.FieldHash, StringComparison.OrdinalIgnoreCase);
                var documentOk = string.Equals(onChain.DocumentHash, meta.DocumentHash, StringComparison.OrdinalIgnoreCase);
                if (!fieldOk || !documentOk)
                {
                    _logger.LogWarning("Hash hồ sơ policy {PolicyId} không khớp (field={Field}, document={Document})",
                        policyId, fieldOk, documentOk);
                    return ApiResults.Error(StatusCodes.Status422UnprocessableEntity,
                        "Hash hồ sơ không khớp, không thể duyệt", "HASH_MISMATCH");
                }
            }

            // 4. Ghi review_logs TRƯỚC khi gửi tx để indexer (A) lấy được lý do khi bắn thông báo từ chối.
            var log = new ReviewLog
            {
                PolicyId = id,
                StaffId = staffId.Value,
                Approved = approved,
                Note = note,
                TxHash = null,
                CreatedAt = DateTimeOffset.UtcNow,
            };
            _db.ReviewLogs.Add(log);
            await _db.SaveChangesAsync(ct);

            // 5. Gửi tx. Từ đây về sau không dùng token huỷ của request: tx đã gửi thì phải ghi nốt kết quả.
            string txHash;
            try
            {
                txHash = await _policyManager.VerifyPolicyAsync(policyId, approved, CancellationToken.None);
                _logger.LogInformation("Đã verify policy {PolicyId} (approved={Approved}), tx = {TxHash}",
                    policyId, approved, txHash);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Lỗi khi verify policy {PolicyId}", policyId);
                await RollbackLogAsync(log);
                return ApiResults.BadGateway("Gửi giao dịch thất bại: " + TicketText.Preview(ex.Message, 200));
            }

            try
            {
                log.TxHash = txHash;
                await _db.SaveChangesAsync(CancellationToken.None);
            }
            catch (Exception ex)
            {
                // Tx đã gửi thành công: không trả lỗi, chỉ thiếu tx_hash trong review_logs.
                _logger.LogError(ex, "Không cập nhật được tx_hash cho review_logs của policy {PolicyId}", policyId);
            }

            // 6. Nhật ký kiểm toán.
            await _audit.WriteAsync("staff", staffId.Value.ToString(), "review", $"policy:{policyId}",
                new { approved, note, txHash }, CancellationToken.None);

            return Ok(new { policyId, approved, txHash });
        }

        /// <summary>Xoá dòng review_logs vừa tạo khi gửi tx thất bại (không dùng token của request).</summary>
        private async Task RollbackLogAsync(ReviewLog log)
        {
            try
            {
                _db.ReviewLogs.Remove(log);
                await _db.SaveChangesAsync(CancellationToken.None);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Không xoá được review_logs {LogId} sau khi gửi tx thất bại", log.Id);
            }
        }
    }

    public record ReviewRequest(bool Approved, string? Note);
}
