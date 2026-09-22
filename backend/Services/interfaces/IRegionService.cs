namespace backend.Services.interfaces
{
    public interface IRegionService
    {
        string ComputeRegionId(decimal lat, decimal lng);
    }
}