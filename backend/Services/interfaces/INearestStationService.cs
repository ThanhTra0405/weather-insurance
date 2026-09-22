using backend.Models;

namespace backend.Services.interfaces
{
    public interface INearestStationService
    {
        (RegionInfo station, double distanceKm) FindNearest(decimal lat, decimal lng, IEnumerable<RegionInfo> stations);
    }
}