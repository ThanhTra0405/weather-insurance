namespace backend.Services.interfaces
{
    public interface IRegionService
    {
        string ComputeRegionId(decimal lat, decimal lng);

        /// Tam vung (toa do da lam tron luoi 0.2 do), cung cong thuc voi ComputeRegionId.
        (decimal lat, decimal lng) GetRegionCenter(decimal lat, decimal lng);
    }
}
