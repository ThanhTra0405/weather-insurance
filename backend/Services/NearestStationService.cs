using backend.Models;
using backend.Services.interfaces;

namespace backend.Services
{
    public class NearestStationService : INearestStationService
    {
        private const double EarthRadiusKm = 6371;

        public (RegionInfo station, double distanceKm) FindNearest(
            decimal lat, decimal lng, IEnumerable<RegionInfo> stations)
        {
            double userLat = (double)lat;
            double userLng = (double)lng;

            RegionInfo? nearest = null;
            double minDist = double.MaxValue;

            foreach (var station in stations)
            {
                double stationLat = (double)station.Lat;
                double stationLng = (double)station.Lng;

                double dLat = ToRad(stationLat - userLat);
                double dLng = ToRad(stationLng - userLng);
                double a = Math.Pow(Math.Sin(dLat / 2), 2) +
                           Math.Cos(ToRad(userLat)) * Math.Cos(ToRad(stationLat)) *
                           Math.Pow(Math.Sin(dLng / 2), 2);
                double dist = 2 * EarthRadiusKm * Math.Asin(Math.Sqrt(a));

                if (dist < minDist)
                {
                    minDist = dist;
                    nearest = station;
                }
            }

            if (nearest is null)
                throw new InvalidOperationException("Khong tim thay tram nao trong danh sach");

            return (nearest, minDist);
        }

        private static double ToRad(double deg) => deg * Math.PI / 180;
    }
}