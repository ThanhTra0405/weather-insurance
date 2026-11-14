using backend.Services.interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace backend.Controllers
{
    [ApiController]
    [Authorize]
    [Route("api/admin")]
    public class AdminReviewController : ControllerBase
    {
        private readonly IPolicyManagerClient _policyManagerClient;
        private readonly ILogger<AdminReviewController> _logger;

        public AdminReviewController(IPolicyManagerClient policyManagerClient, ILogger<AdminReviewController> logger)
        {
            _policyManagerClient = policyManagerClient;
            _logger = logger;
        }

        [Authorize(Roles = "admin")]
        [HttpPost("review/{policyId}")]
        public async Task<IActionResult> ReviewPolicy(ulong policyId, [FromBody] ReviewRequest request, CancellationToken ct)
        {
            try
            {
                var txHash = await _policyManagerClient.VerifyPolicyAsync(policyId, request.Approved, ct);
                _logger.LogInformation("Da verify policy {PolicyId}, tx = {TxHash}", policyId, txHash);

                return Ok(new { policyId, request.Approved, txHash });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Loi khi verify policy {PolicyId}", policyId);
                return StatusCode(500, new { error = ex.Message });
            }
        }

        // TODO(ngày 2): chuyển sang AdminPendingController của A (đọc policies_cache), xoá action này.
        [Authorize(Roles = "admin,support")]
        [HttpGet("pending-policies")]
        public async Task<IActionResult> GetPendingPolicies(CancellationToken ct)
        {
            try
            {
                var policies = await _policyManagerClient.GetPendingPoliciesAsync(ct);
                return Ok(policies);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Loi khi lay danh sach policy cho duyet");
                return StatusCode(500, new { error = ex.Message });
            }
        }
    }

    public record ReviewRequest(bool Approved, string? Note);
}