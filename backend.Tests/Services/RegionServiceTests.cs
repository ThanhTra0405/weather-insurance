using backend.Services;
using backend.Services.interfaces;

namespace backend.Tests.Services
{
    public class RegionServiceTests
    {
        private readonly IRegionService _sut = new RegionService();

        // 4 test vector lay dung tu region.md, phai khop tuyet doi tung ky tu hex.
        // Neu fail, KHONG duoc sua test cho khop code — phai sua code cho khop
        // 4 gia tri chuan nay, vi day la nguon chan ly duy nhat da thong nhat
        // giua Hardhat/Backend/Frontend.

        [Theory]
        [InlineData(10.0452, 105.7469, "0xae1dc2ef3defcad6722db3e995085bc05d8f4d07316414b3835427aeea13a613")]
        [InlineData(21.0278, 105.8342, "0x0b32b1a522c55a4dd773f9b515988b98a8bc8033b8b9b04ae7f98730d86a5d8c")]
        [InlineData(10.2, 105.8, "0xaa364ee2cb9aaef891dd08fb64710bc1a7e228d5741afde933a610ed6b8f71bc")]
        [InlineData(10.099999, 105.699999, "0x1e87188762efab3bae5d6102260e952733a8dd24be189934c2c724b44bed21ac")]
        public void ComputeRegionId_KhopVoiTestVectorChuan(decimal lat, decimal lng, string expected)
        {
            var actual = _sut.ComputeRegionId(lat, lng);

            Assert.Equal(expected.ToLowerInvariant(), actual.ToLowerInvariant());
        }

        [Fact]
        public void ComputeRegionId_CungInput_LuonRaCungKetQua()
        {
            var r1 = _sut.ComputeRegionId(10.0452m, 105.7469m);
            var r2 = _sut.ComputeRegionId(10.0452m, 105.7469m);

            Assert.Equal(r1, r2);
        }

        [Fact]
        public void ComputeRegionId_2DiemGanNhauTrongCungOLuoi_RaCungRegionId()
        {
            // 10.05 va 10.09 deu lam tron ve 10.0 theo grid 0.2 do
            var r1 = _sut.ComputeRegionId(10.05m, 105.75m);
            var r2 = _sut.ComputeRegionId(10.09m, 105.75m);

            Assert.Equal(r1, r2);
        }
    }
}