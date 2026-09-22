using System;
using System.Collections.Generic;

using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using backend.Models;

namespace backend.Repository
{
    public class StationRepository
    {
        private readonly List<RegionInfo> _stations;

        public StationRepository(IWebHostEnvironment env)
        {
            var path = Path.Combine(env.ContentRootPath, "Data", "stations.json");
            var json = File.ReadAllText(path);

            using var doc = JsonDocument.Parse(json);
            _stations = new List<RegionInfo>();
            foreach (var el in doc.RootElement.EnumerateArray())
            {
                var regionId = el.GetProperty("regionId").GetString()!;
                var lat = el.GetProperty("lat").GetDecimal();
                var lng = el.GetProperty("lng").GetDecimal();
                _stations.Add(new RegionInfo(regionId, lat, lng));
            }
        }

        public IReadOnlyList<RegionInfo> GetAll() => _stations;
    }
}