using backend.Middleware;
using backend.Repository;
using backend.Services;
using backend.Services.interfaces;
using WeatherInsurance.Backend.Services;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers();

builder.Services.AddHttpClient<IWeatherService, WeatherService>();
builder.Services.AddSingleton<INearestStationService, NearestStationService>();
builder.Services.AddSingleton<IRegionService, RegionService>();
builder.Services.AddSingleton<IOracleSubmitter, OracleSubmitter>();
builder.Services.AddSingleton<IPolicyManagerClient, PolicyManagerClient>();
builder.Services.AddHostedService<OracleWorker>();
builder.Services.AddSingleton<StationRepository>();

builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowAngularDev", policy =>
        policy.WithOrigins("http://localhost:4200").AllowAnyHeader().AllowAnyMethod());
});

var app = builder.Build();
app.UseCors("AllowAngularDev");
app.UseMiddleware<AdminApiKeyMiddleware>();
app.UseHttpsRedirection();
app.UseAuthorization();
app.MapControllers();

app.Run();