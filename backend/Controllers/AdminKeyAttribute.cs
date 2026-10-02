using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;

namespace backend.Controllers
{
    [AttributeUsage(AttributeTargets.Class | AttributeTargets.Method)]
    public class AdminKeyAttribute : Attribute, IActionFilter
    {
        public void OnActionExecuting(ActionExecutingContext context)
        {
            var config = context.HttpContext.RequestServices.GetRequiredService<IConfiguration>();
            var expected = config["Admin:ApiKey"];
            var req = context.HttpContext.Request;
            var provided = req.Headers["X-Admin-Key"].FirstOrDefault() ?? req.Query["key"].FirstOrDefault();

            var ok = !string.IsNullOrEmpty(expected)
                  && !string.IsNullOrEmpty(provided)
                  && CryptographicOperations.FixedTimeEquals(
                        Encoding.UTF8.GetBytes(expected),
                        Encoding.UTF8.GetBytes(provided));

            if (!ok) context.Result = new UnauthorizedObjectResult(new { error = "Admin key khong dung" });
        }

        public void OnActionExecuted(ActionExecutedContext context) { }
    }
}