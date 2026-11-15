using System.Globalization;
using System.Numerics;
using backend.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace backend.Controllers;

[ApiController]
[AllowAnonymous]
[Route("api/products")]
public class ProductsController : ControllerBase
{
    private readonly AppDbContext _db;

    public ProductsController(AppDbContext db) => _db = db;

    /// Tra tat ca san pham (ca dang tat) tu products_cache; UI tu loc theo `active`.
    [HttpGet]
    public async Task<IActionResult> List(CancellationToken ct)
    {
        var rows = await _db.ProductsCache.AsNoTracking().OrderBy(p => p.ProductId).ToListAsync(ct);

        return Ok(rows.Select(p => new
        {
            productId = p.ProductId,
            name = p.Name,
            perilType = (int)p.PerilType,
            threshold = p.Threshold.ToString(),
            thresholdDisplay = Display(p.PerilType, p.Threshold),
            durationDays = p.DurationDays,
            premiumWei = p.PremiumWei.ToString(),
            coverageWei = p.CoverageWei.ToString(),
            active = p.Active,
        }));
    }

    /// threshold luu x100: 15000 -> "150 mm / 30 ngày".
    public static string Display(short peril, BigInteger threshold)
    {
        var value = (decimal)threshold / 100m;
        var s = value.ToString("0.##", CultureInfo.InvariantCulture);
        return peril switch
        {
            0 => $"{s} mm / 30 ngày",
            1 => $"{s} mm / 3 ngày",
            _ => $"{s} km/h",
        };
    }
}
