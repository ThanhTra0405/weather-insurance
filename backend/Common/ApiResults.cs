using Microsoft.AspNetCore.Mvc;

namespace backend.Common;

/// <summary>Trả lỗi API theo chuẩn { "error": "...", "code"?: "...", "fields"?: {...} } (SPEC-00 mục 4.2).</summary>
public static class ApiResults
{
    public static IActionResult Error(int status, string message, string? code = null,
        IDictionary<string, string>? fields = null)
    {
        var body = new Dictionary<string, object> { ["error"] = message };
        if (code != null) body["code"] = code;
        if (fields is { Count: > 0 }) body["fields"] = fields;
        return new ObjectResult(body) { StatusCode = status };
    }

    public static IActionResult BadRequest(string message, string? code = null) =>
        Error(StatusCodes.Status400BadRequest, message, code);

    public static IActionResult Validation(IDictionary<string, string> fields,
        string message = "Dữ liệu không hợp lệ") =>
        Error(StatusCodes.Status400BadRequest, message, "VALIDATION", fields);

    public static IActionResult Unauthorized(string message, string? code = null) =>
        Error(StatusCodes.Status401Unauthorized, message, code);

    public static IActionResult Forbidden(string message = "Bạn không có quyền thực hiện thao tác này", string? code = null) =>
        Error(StatusCodes.Status403Forbidden, message, code);

    public static IActionResult NotFound(string message, string? code = null) =>
        Error(StatusCodes.Status404NotFound, message, code);

    public static IActionResult Conflict(string message, string? code = null) =>
        Error(StatusCodes.Status409Conflict, message, code);

    public static IActionResult TooManyRequests(string message = "Thao tác quá nhanh, vui lòng thử lại sau",
        string code = "RATE_LIMITED") =>
        Error(StatusCodes.Status429TooManyRequests, message, code);

    public static IActionResult BadGateway(string message, string? code = null) =>
        Error(StatusCodes.Status502BadGateway, message, code);

    public static IActionResult ServiceUnavailable(string message, string? code = null) =>
        Error(StatusCodes.Status503ServiceUnavailable, message, code);
}
