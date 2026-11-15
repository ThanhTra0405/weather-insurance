using backend.Auth;
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
    /// <summary>Ticket chăm sóc khách hàng (SPEC-B mục 6): nông dân tạo/trả lời/đánh giá, CSKH và admin xử lý.</summary>
    [ApiController]
    [Authorize]
    [Route("api/tickets")]
    public class TicketsController : ControllerBase
    {
        private const int MaxOpenTicketsPerWallet = 10;
        private const int SubjectMin = 5;
        private const int SubjectMax = 150;
        private const int BodyMax = 4000;
        private const int RatingCommentMax = 500;

        private readonly AppDbContext _db;
        private readonly INotificationService _notifier;
        private readonly IPolicyChainReader _chain;
        private readonly ILogger<TicketsController> _logger;

        public TicketsController(AppDbContext db, INotificationService notifier, IPolicyChainReader chain,
            ILogger<TicketsController> logger)
        {
            _db = db;
            _notifier = notifier;
            _chain = chain;
            _logger = logger;
        }

        // ============ Tạo ticket (nông dân) ============

        [Authorize(Roles = "farmer")]
        [HttpPost]
        public async Task<IActionResult> Create([FromBody] CreateTicketRequest? request, CancellationToken ct)
        {
            var wallet = User.GetWallet();
            if (wallet == null) return ApiResults.Unauthorized("Phiên đăng nhập không hợp lệ");
            if (request == null) return ApiResults.BadRequest("Thiếu dữ liệu yêu cầu hỗ trợ", "VALIDATION");

            var profile = await _db.FarmerProfiles.AsNoTracking()
                .FirstOrDefaultAsync(p => p.WalletAddress == wallet, ct);
            if (profile == null || !ProfileValidator.IsComplete(profile))
                return ApiResults.Forbidden("Bạn cần hoàn thiện hồ sơ trước khi tạo yêu cầu hỗ trợ", "PROFILE_REQUIRED");

            var fields = new Dictionary<string, string>();
            var category = request.Category?.Trim() ?? "";
            if (!TicketText.Categories.Contains(category))
                fields["category"] = "Loại yêu cầu không hợp lệ";

            var subject = request.Subject?.Trim() ?? "";
            if (subject.Length < SubjectMin || subject.Length > SubjectMax)
                fields["subject"] = $"Tiêu đề phải từ {SubjectMin} đến {SubjectMax} ký tự";

            var body = request.Body?.Trim() ?? "";
            if (body.Length < 1 || body.Length > BodyMax)
                fields["body"] = $"Nội dung phải từ 1 đến {BodyMax} ký tự";

            if (request.PolicyId is <= 0)
                fields["policyId"] = "Policy không hợp lệ";

            if (fields.Count > 0) return ApiResults.Validation(fields);

            if (request.PolicyId is { } policyId)
            {
                var holder = await ResolveHolderAsync(policyId, ct);
                if (holder != wallet)
                    return ApiResults.Validation(new Dictionary<string, string>
                    {
                        ["policyId"] = "Không tìm thấy policy này trong tài khoản của bạn",
                    });
            }

            var openCount = await _db.Tickets.CountAsync(
                t => t.WalletAddress == wallet && TicketText.OpenStatuses.Contains(t.Status), ct);
            if (openCount >= MaxOpenTicketsPerWallet)
                return ApiResults.Conflict(
                    $"Bạn đang có {MaxOpenTicketsPerWallet} yêu cầu chưa xử lý xong, vui lòng đợi hoặc bổ sung vào yêu cầu cũ",
                    "TICKET_LIMIT");

            var now = DateTimeOffset.UtcNow;
            var ticket = new Ticket
            {
                WalletAddress = wallet,
                PolicyId = request.PolicyId,
                Category = category,
                Subject = subject,
                Status = "open",
                Priority = "normal",
                CreatedAt = now,
                UpdatedAt = now,
            };
            ticket.Messages.Add(new TicketMessage
            {
                SenderType = "farmer",
                SenderRef = wallet,
                Body = body,
                IsInternal = false,
                CreatedAt = now,
            });
            _db.Tickets.Add(ticket);
            await _db.SaveChangesAsync(ct);

            return Ok(new { id = ticket.Id, status = ticket.Status, createdAt = ticket.CreatedAt });
        }

        // ============ Danh sách ============

        /// <summary>
        /// Nông dân: ticket của mình. Nhân viên: hàng đợi có lọc. Cả hai trả { items, total };
        /// nhân viên có thêm counts { mine, unassigned, all } (số ticket đang mở theo từng tab).
        /// </summary>
        [HttpGet]
        public async Task<IActionResult> List(
            [FromQuery] string? status, [FromQuery] string? assignedTo, [FromQuery] string? category,
            [FromQuery] string? priority, [FromQuery] string? q,
            [FromQuery] int page = 1, [FromQuery] int pageSize = 0, CancellationToken ct = default)
        {
            var role = User.GetRole();
            if (page < 1) page = 1;

            var fields = new Dictionary<string, string>();
            if (!string.IsNullOrEmpty(status) && !TicketText.Statuses.Contains(status))
                fields["status"] = "Trạng thái không hợp lệ";
            if (!string.IsNullOrEmpty(category) && !TicketText.Categories.Contains(category))
                fields["category"] = "Loại yêu cầu không hợp lệ";
            if (!string.IsNullOrEmpty(priority) && !TicketText.Priorities.Contains(priority))
                fields["priority"] = "Mức ưu tiên không hợp lệ";

            if (role == "farmer")
            {
                var wallet = User.GetWallet();
                if (wallet == null) return ApiResults.Unauthorized("Phiên đăng nhập không hợp lệ");
                if (fields.Count > 0) return ApiResults.Validation(fields);

                var size = pageSize <= 0 ? 50 : Math.Min(pageSize, 50);
                var mine = _db.Tickets.AsNoTracking().Where(t => t.WalletAddress == wallet);
                if (!string.IsNullOrEmpty(status)) mine = mine.Where(t => t.Status == status);

                var total = await mine.CountAsync(ct);
                var rows = await mine
                    .OrderByDescending(t => t.UpdatedAt).ThenByDescending(t => t.Id)
                    .Skip((page - 1) * size).Take(size)
                    .ToListAsync(ct);

                var last = await LoadLastMessagesAsync(rows.Select(t => t.Id).ToList(), ct);
                var staffNames = await LoadStaffNamesAsync(rows.Where(t => t.AssignedTo != null).Select(t => t.AssignedTo!.Value), ct);
                var items = rows.Select(t => ToListItem(t, null, staffNames, last)).ToList();
                return Ok(new { items, total });
            }

            if (role != "admin" && role != "support") return ApiResults.Forbidden();
            var staffId = User.GetStaffId();
            if (staffId == null) return ApiResults.Unauthorized("Phiên đăng nhập không hợp lệ");

            Guid? assigneeFilter = null;
            var unassignedOnly = false;
            if (!string.IsNullOrEmpty(assignedTo))
            {
                if (assignedTo == "me") assigneeFilter = staffId;
                else if (assignedTo == "unassigned") unassignedOnly = true;
                else if (Guid.TryParse(assignedTo, out var g)) assigneeFilter = g;
                else fields["assignedTo"] = "Người xử lý không hợp lệ";
            }
            if (fields.Count > 0) return ApiResults.Validation(fields);

            var query = from t in _db.Tickets.AsNoTracking()
                        join p in _db.FarmerProfiles.AsNoTracking() on t.WalletAddress equals p.WalletAddress
                        select new { t, p };

            if (!string.IsNullOrEmpty(status)) query = query.Where(x => x.t.Status == status);
            if (!string.IsNullOrEmpty(category)) query = query.Where(x => x.t.Category == category);
            if (!string.IsNullOrEmpty(priority)) query = query.Where(x => x.t.Priority == priority);
            if (unassignedOnly) query = query.Where(x => x.t.AssignedTo == null);
            else if (assigneeFilter != null) query = query.Where(x => x.t.AssignedTo == assigneeFilter);

            if (!string.IsNullOrWhiteSpace(q))
            {
                var term = q.Trim();
                var pattern = SqlLike.Contains(term);
                var lowerTerm = term.ToLowerInvariant();
                long? policyIdFilter = term.All(char.IsDigit) && long.TryParse(term, out var pid) ? pid : null;
                var digits = new string(term.Where(char.IsDigit).ToArray());
                string? phoneTail = digits.Length >= 6 ? (digits.Length > 9 ? digits[^9..] : digits) : null;

                query = query.Where(x =>
                    EF.Functions.ILike(x.t.Subject, pattern)
                    || EF.Functions.ILike(x.p.FullName, pattern)
                    || x.t.WalletAddress.StartsWith(lowerTerm)
                    || (policyIdFilter != null && x.t.PolicyId == policyIdFilter)
                    || (phoneTail != null && x.p.Phone.EndsWith(phoneTail)));
            }

            var staffSize = pageSize <= 0 ? 20 : Math.Min(pageSize, 50);
            var staffTotal = await query.CountAsync(ct);
            var staffRows = await query
                .OrderByDescending(x => x.t.UpdatedAt).ThenByDescending(x => x.t.Id)
                .Skip((page - 1) * staffSize).Take(staffSize)
                .Select(x => new { x.t, FarmerName = x.p.FullName })
                .ToListAsync(ct);

            var staffLast = await LoadLastMessagesAsync(staffRows.Select(r => r.t.Id).ToList(), ct);
            var names = await LoadStaffNamesAsync(
                staffRows.Where(r => r.t.AssignedTo != null).Select(r => r.t.AssignedTo!.Value), ct);
            var staffItems = staffRows.Select(r => ToListItem(r.t, r.FarmerName, names, staffLast)).ToList();

            var openQuery = _db.Tickets.AsNoTracking().Where(t => TicketText.OpenStatuses.Contains(t.Status));
            var me = staffId.Value;
            var counts = new
            {
                mine = await openQuery.CountAsync(t => t.AssignedTo == me, ct),
                unassigned = await openQuery.CountAsync(t => t.AssignedTo == null, ct),
                all = await openQuery.CountAsync(ct),
            };

            return Ok(new { items = staffItems, total = staffTotal, counts });
        }

        // ============ Chi tiết ============

        [HttpGet("{id:long}")]
        public async Task<IActionResult> Get(long id, CancellationToken ct)
        {
            var ticket = await _db.Tickets.AsNoTracking().FirstOrDefaultAsync(t => t.Id == id, ct);
            if (ticket == null) return ApiResults.NotFound("Không tìm thấy yêu cầu hỗ trợ");

            var access = CheckAccess(ticket, out var isStaff);
            if (access != null) return access;

            var messages = await _db.TicketMessages.AsNoTracking()
                .Where(m => m.TicketId == id && (isStaff || !m.IsInternal))
                .OrderBy(m => m.CreatedAt).ThenBy(m => m.Id)
                .ToListAsync(ct);

            var staffIds = messages
                .Where(m => m.SenderType == "staff" && Guid.TryParse(m.SenderRef, out _))
                .Select(m => Guid.Parse(m.SenderRef!))
                .ToList();
            if (ticket.AssignedTo != null) staffIds.Add(ticket.AssignedTo.Value);
            var names = await LoadStaffNamesAsync(staffIds, ct);

            object? farmer = null;
            object? policy = null;
            if (isStaff)
            {
                var mask = User.GetRole() == "support";
                var profile = await _db.FarmerProfiles.AsNoTracking()
                    .FirstOrDefaultAsync(p => p.WalletAddress == ticket.WalletAddress, ct);
                if (profile != null)
                {
                    farmer = new
                    {
                        walletAddress = profile.WalletAddress,
                        fullName = profile.FullName,
                        phone = mask ? PiiMask.Phone(profile.Phone) : profile.Phone,
                        email = mask ? PiiMask.Email(profile.Email) : profile.Email,
                        province = profile.Province,
                        district = profile.District,
                        commune = profile.Commune,
                        cropType = profile.CropType,
                        farmAreaHa = profile.FarmAreaHa,
                        createdAt = profile.CreatedAt,
                    };
                }

                if (ticket.PolicyId != null)
                    policy = await LoadPolicySummaryAsync(ticket.PolicyId.Value, ct);
            }

            return Ok(new
            {
                id = ticket.Id,
                walletAddress = ticket.WalletAddress,
                policyId = ticket.PolicyId,
                category = ticket.Category,
                subject = ticket.Subject,
                status = ticket.Status,
                priority = ticket.Priority,
                assignedTo = ticket.AssignedTo,
                assignedToName = ticket.AssignedTo != null && names.TryGetValue(ticket.AssignedTo.Value, out var an) ? an : null,
                rating = ticket.Rating,
                ratingComment = ticket.RatingComment,
                createdAt = ticket.CreatedAt,
                updatedAt = ticket.UpdatedAt,
                closedAt = ticket.ClosedAt,
                messages = messages.Select(m => ToMessageDto(m, names)).ToList(),
                farmer,
                policy,
            });
        }

        // ============ Tin nhắn ============

        [HttpPost("{id:long}/messages")]
        public async Task<IActionResult> AddMessage(long id, [FromBody] TicketMessageRequest? request,
            CancellationToken ct)
        {
            if (request == null) return ApiResults.BadRequest("Thiếu nội dung tin nhắn", "VALIDATION");

            var body = request.Body?.Trim() ?? "";
            if (body.Length < 1 || body.Length > BodyMax)
                return ApiResults.Validation(new Dictionary<string, string>
                {
                    ["body"] = $"Nội dung phải từ 1 đến {BodyMax} ký tự",
                });

            var ticket = await _db.Tickets.FirstOrDefaultAsync(t => t.Id == id, ct);
            if (ticket == null) return ApiResults.NotFound("Không tìm thấy yêu cầu hỗ trợ");

            var access = CheckAccess(ticket, out var isStaff);
            if (access != null) return access;

            var now = DateTimeOffset.UtcNow;
            TicketMessage message;
            var notifyFarmer = false;

            if (!isStaff)
            {
                // Nông dân trả lời.
                if (ticket.Status == "closed")
                    return ApiResults.Conflict("Yêu cầu đã đóng, vui lòng tạo yêu cầu hỗ trợ mới", "TICKET_CLOSED");

                if (ticket.Status is "waiting_customer" or "resolved") ticket.Status = "open";

                message = new TicketMessage
                {
                    TicketId = ticket.Id,
                    SenderType = "farmer",
                    SenderRef = ticket.WalletAddress,
                    Body = body,
                    IsInternal = false,
                    CreatedAt = now,
                };
            }
            else
            {
                var staffId = User.GetStaffId();
                if (staffId == null) return ApiResults.Unauthorized("Phiên đăng nhập không hợp lệ");

                var internalNote = request.IsInternal == true;
                if (!internalNote)
                {
                    if (ticket.Status == "closed")
                        return ApiResults.Conflict("Yêu cầu đã đóng, chỉ có thể thêm ghi chú nội bộ", "TICKET_CLOSED");

                    if (ticket.Status is "open" or "in_progress") ticket.Status = "waiting_customer";
                    if (ticket.AssignedTo == null) ticket.AssignedTo = staffId;
                    notifyFarmer = true;
                }

                message = new TicketMessage
                {
                    TicketId = ticket.Id,
                    SenderType = "staff",
                    SenderRef = staffId.Value.ToString(),
                    Body = body,
                    IsInternal = internalNote,
                    CreatedAt = now,
                };
            }

            ticket.UpdatedAt = now;
            _db.TicketMessages.Add(message);
            await _db.SaveChangesAsync(ct);

            if (notifyFarmer)
            {
                await SafeNotifyAsync(ticket.WalletAddress, "ticket_reply",
                    "Có phản hồi mới cho yêu cầu hỗ trợ",
                    $"Yêu cầu #{ticket.Id} \"{TicketText.Preview(ticket.Subject, 80)}\" vừa được chăm sóc khách hàng trả lời.",
                    $"/tickets/{ticket.Id}");
            }

            var names = await LoadStaffNamesAsync(
                message.SenderType == "staff" && Guid.TryParse(message.SenderRef, out var sid)
                    ? new[] { sid }
                    : Array.Empty<Guid>(), ct);
            return Ok(ToMessageDto(message, names));
        }

        // ============ Đổi trạng thái / ưu tiên / người xử lý (nhân viên) ============

        [Authorize(Roles = "admin,support")]
        [HttpPatch("{id:long}")]
        public async Task<IActionResult> Update(long id, [FromBody] UpdateTicketRequest? request, CancellationToken ct)
        {
            if (request == null) return ApiResults.BadRequest("Thiếu dữ liệu cập nhật", "VALIDATION");

            var staffId = User.GetStaffId();
            if (staffId == null) return ApiResults.Unauthorized("Phiên đăng nhập không hợp lệ");
            var isAdmin = User.GetRole() == "admin";

            var actor = await _db.Staff.AsNoTracking().FirstOrDefaultAsync(s => s.Id == staffId.Value && s.Active, ct);
            if (actor == null) return ApiResults.Unauthorized("Tài khoản không tồn tại hoặc đã bị khoá");

            var ticket = await _db.Tickets.FirstOrDefaultAsync(t => t.Id == id, ct);
            if (ticket == null) return ApiResults.NotFound("Không tìm thấy yêu cầu hỗ trợ");

            var fields = new Dictionary<string, string>();
            if (request.Status != null && !TicketText.Statuses.Contains(request.Status))
                fields["status"] = "Trạng thái không hợp lệ";
            if (request.Priority != null && !TicketText.Priorities.Contains(request.Priority))
                fields["priority"] = "Mức ưu tiên không hợp lệ";

            // Người xử lý: "me" | id nhân viên | "" (bỏ gán).
            var assigneeChanging = false;
            Guid? newAssignee = ticket.AssignedTo;
            Staff? assigneeStaff = null;
            if (request.AssignedTo != null)
            {
                var raw = request.AssignedTo.Trim();
                Guid? target = null;
                var valid = true;
                if (raw.Length == 0 || raw == "unassigned") target = null;
                else if (raw == "me") target = staffId.Value;
                else if (Guid.TryParse(raw, out var parsed)) target = parsed;
                else
                {
                    valid = false;
                    fields["assignedTo"] = "Người xử lý không hợp lệ";
                }

                if (valid && target != ticket.AssignedTo)
                {
                    if (!isAdmin)
                    {
                        // CSKH chỉ tự nhận ticket cho mình, hoặc trả lại ticket của chính mình.
                        if (target != null && target != staffId.Value)
                            return ApiResults.Forbidden("CSKH chỉ được tự nhận ticket cho chính mình");
                        if (target == null && ticket.AssignedTo != staffId.Value)
                            return ApiResults.Forbidden("Bạn chỉ được bỏ gán ticket của chính mình");
                    }

                    if (target != null)
                    {
                        assigneeStaff = await _db.Staff.AsNoTracking()
                            .FirstOrDefaultAsync(s => s.Id == target.Value && s.Active, ct);
                        if (assigneeStaff == null)
                            fields["assignedTo"] = "Không tìm thấy nhân viên đang hoạt động này";
                    }

                    if (!fields.ContainsKey("assignedTo"))
                    {
                        assigneeChanging = true;
                        newAssignee = target;
                    }
                }
            }

            if (fields.Count > 0) return ApiResults.Validation(fields);

            var now = DateTimeOffset.UtcNow;
            var notes = new List<string>();
            var statusChanged = false;

            if (request.Status != null && request.Status != ticket.Status)
            {
                var old = ticket.Status;
                ticket.Status = request.Status;
                ticket.ClosedAt = request.Status == "closed" ? now : null;
                statusChanged = true;
                notes.Add($"Trạng thái chuyển từ {TicketText.Status(old)} sang {TicketText.Status(request.Status)} bởi {actor.FullName}");
            }

            if (request.Priority != null && request.Priority != ticket.Priority)
            {
                var old = ticket.Priority;
                ticket.Priority = request.Priority;
                notes.Add($"Ưu tiên chuyển từ {TicketText.Priority(old)} sang {TicketText.Priority(request.Priority)} bởi {actor.FullName}");
            }

            if (assigneeChanging)
            {
                ticket.AssignedTo = newAssignee;
                if (newAssignee == null)
                    notes.Add($"{actor.FullName} đã bỏ gán ticket");
                else if (newAssignee == staffId.Value)
                    notes.Add($"{actor.FullName} đã nhận ticket");
                else
                    notes.Add($"Ticket được gán cho {assigneeStaff!.FullName} bởi {actor.FullName}");
            }

            if (notes.Count > 0)
            {
                ticket.UpdatedAt = now;
                foreach (var note in notes)
                {
                    _db.TicketMessages.Add(new TicketMessage
                    {
                        TicketId = ticket.Id,
                        SenderType = "system",
                        SenderRef = staffId.Value.ToString(),
                        Body = note,
                        IsInternal = false,
                        CreatedAt = now,
                    });
                }
                await _db.SaveChangesAsync(ct);
            }

            if (statusChanged)
            {
                await SafeNotifyAsync(ticket.WalletAddress, "ticket_status",
                    "Yêu cầu hỗ trợ đã đổi trạng thái",
                    $"Yêu cầu #{ticket.Id} \"{TicketText.Preview(ticket.Subject, 80)}\" chuyển sang: {TicketText.Status(ticket.Status)}.",
                    $"/tickets/{ticket.Id}");
            }

            return Ok(new
            {
                id = ticket.Id,
                status = ticket.Status,
                priority = ticket.Priority,
                assignedTo = ticket.AssignedTo,
                closedAt = ticket.ClosedAt,
                updatedAt = ticket.UpdatedAt,
            });
        }

        // ============ Đánh giá ============

        [Authorize(Roles = "farmer")]
        [HttpPost("{id:long}/rating")]
        public async Task<IActionResult> Rate(long id, [FromBody] TicketRatingRequest? request, CancellationToken ct)
        {
            var wallet = User.GetWallet();
            if (wallet == null) return ApiResults.Unauthorized("Phiên đăng nhập không hợp lệ");
            if (request == null) return ApiResults.BadRequest("Thiếu dữ liệu đánh giá", "VALIDATION");

            var fields = new Dictionary<string, string>();
            if (request.Rating is not (>= 1 and <= 5))
                fields["rating"] = "Điểm đánh giá phải từ 1 đến 5";
            var comment = string.IsNullOrWhiteSpace(request.Comment) ? null : request.Comment.Trim();
            if (comment != null && comment.Length > RatingCommentMax)
                fields["comment"] = $"Nhận xét tối đa {RatingCommentMax} ký tự";
            if (fields.Count > 0) return ApiResults.Validation(fields);

            var ticket = await _db.Tickets.FirstOrDefaultAsync(t => t.Id == id, ct);
            if (ticket == null) return ApiResults.NotFound("Không tìm thấy yêu cầu hỗ trợ");
            if (ticket.WalletAddress != wallet) return ApiResults.Forbidden("Đây không phải yêu cầu của bạn");

            if (ticket.Status is not ("resolved" or "closed"))
                return ApiResults.Conflict("Chỉ đánh giá được khi yêu cầu đã giải quyết hoặc đã đóng", "TICKET_NOT_RESOLVED");
            if (ticket.Rating != null)
                return ApiResults.Conflict("Bạn đã đánh giá yêu cầu này rồi", "ALREADY_RATED");

            ticket.Rating = (short)request.Rating!.Value;
            ticket.RatingComment = comment;
            await _db.SaveChangesAsync(ct);

            return Ok(new { rating = ticket.Rating, ratingComment = ticket.RatingComment });
        }

        // ============ Hàm phụ ============

        /// <summary>Nông dân chỉ truy cập ticket của mình; nhân viên truy cập mọi ticket. Trả null nếu hợp lệ.</summary>
        private IActionResult? CheckAccess(Ticket ticket, out bool isStaff)
        {
            var role = User.GetRole();
            isStaff = role is "admin" or "support";
            if (isStaff) return null;

            if (role == "farmer" && ticket.WalletAddress == User.GetWallet()) return null;
            return ApiResults.Forbidden("Đây không phải yêu cầu của bạn");
        }

        /// <summary>Chủ policy: ưu tiên policies_cache (A), chưa có thì đọc trực tiếp từ blockchain.</summary>
        private async Task<string?> ResolveHolderAsync(long policyId, CancellationToken ct)
        {
            var cached = await _db.PoliciesCache.AsNoTracking()
                .Where(p => p.PolicyId == policyId)
                .Select(p => p.Holder)
                .FirstOrDefaultAsync(ct);
            if (cached != null) return cached.ToLowerInvariant();

            try
            {
                var onChain = await _chain.GetPolicyAsync((ulong)policyId, ct);
                return onChain.Exists ? onChain.Holder : null;
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Không xác định được chủ của policy {PolicyId}", policyId);
                return null;
            }
        }

        private async Task<object?> LoadPolicySummaryAsync(long policyId, CancellationToken ct)
        {
            var policy = await _db.PoliciesCache.AsNoTracking().FirstOrDefaultAsync(p => p.PolicyId == policyId, ct);
            if (policy == null) return null;

            var productName = await _db.ProductsCache.AsNoTracking()
                .Where(p => p.ProductId == policy.ProductId)
                .Select(p => p.Name)
                .FirstOrDefaultAsync(ct);
            var hasEvidence = await _db.EvidenceMetas.AsNoTracking().AnyAsync(m => m.PolicyId == policyId, ct);
            var rejectReason = policy.Rejected
                ? await _db.ReviewLogs.AsNoTracking()
                    .Where(r => r.PolicyId == policyId && !r.Approved)
                    .OrderByDescending(r => r.CreatedAt)
                    .Select(r => r.Note)
                    .FirstOrDefaultAsync(ct)
                : null;

            return new
            {
                policyId = policy.PolicyId,
                productName,
                perilType = policy.PerilType,
                status = policy.Status,
                rejected = policy.Rejected,
                startTime = policy.StartTime,
                endTime = policy.EndTime,
                premiumWei = policy.PremiumWei.ToString(),
                coverageWei = policy.CoverageWei.ToString(),
                hasEvidence,
                rejectReason,
            };
        }

        private async Task<Dictionary<Guid, string>> LoadStaffNamesAsync(IEnumerable<Guid> ids, CancellationToken ct)
        {
            var list = ids.Distinct().ToList();
            if (list.Count == 0) return new Dictionary<Guid, string>();

            return await _db.Staff.AsNoTracking()
                .Where(s => list.Contains(s.Id))
                .ToDictionaryAsync(s => s.Id, s => s.FullName, ct);
        }

        /// <summary>Tin công khai (không nội bộ, không hệ thống) mới nhất của mỗi ticket, dùng cho xem trước.</summary>
        private async Task<Dictionary<long, (string Sender, string Preview)>> LoadLastMessagesAsync(
            List<long> ticketIds, CancellationToken ct)
        {
            if (ticketIds.Count == 0) return new Dictionary<long, (string, string)>();

            var lastIds = await _db.TicketMessages.AsNoTracking()
                .Where(m => ticketIds.Contains(m.TicketId) && !m.IsInternal && m.SenderType != "system")
                .GroupBy(m => m.TicketId)
                .Select(g => g.Max(m => m.Id))
                .ToListAsync(ct);

            var rows = await _db.TicketMessages.AsNoTracking()
                .Where(m => lastIds.Contains(m.Id))
                .Select(m => new { m.TicketId, m.SenderType, m.Body })
                .ToListAsync(ct);

            return rows.ToDictionary(r => r.TicketId, r => (r.SenderType, TicketText.Preview(r.Body)));
        }

        private static object ToListItem(Ticket t, string? farmerName, Dictionary<Guid, string> staffNames,
            Dictionary<long, (string Sender, string Preview)> last)
        {
            last.TryGetValue(t.Id, out var lastMessage);
            return new
            {
                id = t.Id,
                walletAddress = t.WalletAddress,
                farmerName,
                policyId = t.PolicyId,
                category = t.Category,
                subject = t.Subject,
                status = t.Status,
                priority = t.Priority,
                assignedTo = t.AssignedTo,
                assignedToName = t.AssignedTo != null && staffNames.TryGetValue(t.AssignedTo.Value, out var n) ? n : null,
                rating = t.Rating,
                createdAt = t.CreatedAt,
                updatedAt = t.UpdatedAt,
                closedAt = t.ClosedAt,
                lastMessagePreview = lastMessage.Preview,
                lastSenderType = lastMessage.Sender,
            };
        }

        private static object ToMessageDto(TicketMessage m, Dictionary<Guid, string> staffNames)
        {
            string? senderName = null;
            if (m.SenderType == "system") senderName = "Hệ thống";
            else if (m.SenderType == "staff" && Guid.TryParse(m.SenderRef, out var g) && staffNames.TryGetValue(g, out var n))
                senderName = n;

            return new
            {
                id = m.Id,
                senderType = m.SenderType,
                senderName,
                body = m.Body,
                isInternal = m.IsInternal,
                createdAt = m.CreatedAt,
            };
        }

        /// <summary>Gửi thông báo nhưng không để lỗi thông báo làm hỏng thao tác chính.</summary>
        private async Task SafeNotifyAsync(string wallet, string type, string title, string body, string link)
        {
            try
            {
                await _notifier.NotifyAsync(wallet, type, title, body, link, CancellationToken.None);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Không gửi được thông báo {Type} cho {Wallet}", type, wallet);
            }
        }
    }

    public record CreateTicketRequest(long? PolicyId, string? Category, string? Subject, string? Body);

    public record TicketMessageRequest(string? Body, bool? IsInternal);

    /// <summary>AssignedTo: "me", id nhân viên, hoặc chuỗi rỗng để bỏ gán; null = không đổi.</summary>
    public record UpdateTicketRequest(string? Status, string? Priority, string? AssignedTo);

    public record TicketRatingRequest(int? Rating, string? Comment);
}
