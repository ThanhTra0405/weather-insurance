namespace backend.Middleware
{
    public class AdminApiKeyMiddleware
    {
        private readonly RequestDelegate _next;

        public AdminApiKeyMiddleware(RequestDelegate next)
        {
            _next = next;
        }

        public async Task InvokeAsync(HttpContext context, IConfiguration config)
        {
            if (context.Request.Path.StartsWithSegments("/api/admin"))
            {
                var expectedKey = config["Admin:ApiKey"];
                var providedKey = context.Request.Headers["X-Admin-Key"].FirstOrDefault();

                if (string.IsNullOrEmpty(expectedKey) || providedKey != expectedKey)
                {
                    context.Response.StatusCode = 401;
                    await context.Response.WriteAsJsonAsync(new { error = "Sai hoac thieu admin key" });
                    return;
                }
            }

            await _next(context);
        }
    }
}