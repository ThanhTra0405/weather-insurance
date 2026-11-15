using System.Numerics;
using Nethereum.ABI.FunctionEncoding.Attributes;
using Nethereum.Contracts;

namespace backend.Services.Chain;

// ===================== PolicyManager =====================

[Event("PolicyProductCreated")]
public class PolicyProductCreatedEvent : IEventDTO
{
    [Parameter("uint256", "productId", 1, true)]       public BigInteger ProductId { get; set; }
    [Parameter("string",  "name", 2, false)]           public string Name { get; set; } = "";
    [Parameter("uint256", "premium", 3, false)]        public BigInteger Premium { get; set; }
    [Parameter("uint256", "coverageAmount", 4, false)] public BigInteger CoverageAmount { get; set; }
}

[Event("PolicyCreated")]
public class PolicyCreatedEvent : IEventDTO
{
    [Parameter("uint256", "policyId", 1, true)]        public BigInteger PolicyId { get; set; }
    [Parameter("uint256", "productId", 2, true)]       public BigInteger ProductId { get; set; }
    [Parameter("address", "holder", 3, true)]          public string Holder { get; set; } = "";
    [Parameter("int256",  "lat", 4, false)]            public BigInteger Lat { get; set; }
    [Parameter("int256",  "lng", 5, false)]            public BigInteger Lng { get; set; }
    [Parameter("bytes32", "regionId", 6, false)]       public byte[] RegionId { get; set; } = Array.Empty<byte>();
    [Parameter("uint256", "premiumPaid", 7, false)]    public BigInteger PremiumPaid { get; set; }
    [Parameter("uint256", "coverageAmount", 8, false)] public BigInteger CoverageAmount { get; set; }
    [Parameter("uint256", "endTime", 9, false)]        public BigInteger EndTime { get; set; }
}

[Event("ProductStatusChanged")]
public class ProductStatusChangedEvent : IEventDTO
{
    [Parameter("uint256", "id", 1, false)]     public BigInteger Id { get; set; }
    [Parameter("bool",    "active", 2, false)] public bool Active { get; set; }
}

[Event("EvidenceSubmitted")]
public class EvidenceSubmittedEvent : IEventDTO
{
    [Parameter("uint256", "policyId", 1, true)]        public BigInteger PolicyId { get; set; }
    [Parameter("bytes32", "fieldPhotoHash", 2, false)] public byte[] FieldPhotoHash { get; set; } = Array.Empty<byte>();
    [Parameter("bytes32", "documentHash", 3, false)]   public byte[] DocumentHash { get; set; } = Array.Empty<byte>();
}

[Event("PolicyVerified")]
public class PolicyVerifiedEvent : IEventDTO
{
    [Parameter("uint256", "policyId", 1, true)]  public BigInteger PolicyId { get; set; }
    [Parameter("bool",    "approved", 2, false)] public bool Approved { get; set; }
}

[Event("PolicyExpired")]
public class PolicyExpiredEvent : IEventDTO
{
    [Parameter("uint256", "policyId", 1, true)]  public BigInteger PolicyId { get; set; }
    [Parameter("bool",    "refunded", 2, false)] public bool Refunded { get; set; }
}

[Event("PayoutMarked")]
public class PayoutMarkedEvent : IEventDTO
{
    [Parameter("uint256", "policyId", 1, true)] public BigInteger PolicyId { get; set; }
}

[Event("CoolingOffPeriodSet")]
public class CoolingOffPeriodSetEvent : IEventDTO
{
    [Parameter("uint256", "seconds_", 1, false)] public BigInteger Seconds { get; set; }
}

[Event("VerifierSet")]
public class VerifierSetEvent : IEventDTO
{
    [Parameter("address", "verifier", 1, true)] public string Verifier { get; set; } = "";
}

// ===================== LiquidityPool =====================

[Event("LiquidityAdded")]
public class LiquidityAddedEvent : IEventDTO
{
    [Parameter("address", "provider", 1, true)] public string Provider { get; set; } = "";
    [Parameter("uint256", "amount", 2, false)]  public BigInteger Amount { get; set; }
}

[Event("LiquidityWithdrawn")]
public class LiquidityWithdrawnEvent : IEventDTO
{
    [Parameter("address", "provider", 1, true)] public string Provider { get; set; } = "";
    [Parameter("uint256", "amount", 2, false)]  public BigInteger Amount { get; set; }
}

[Event("PolicyRefunded")]
public class PolicyRefundedEvent : IEventDTO
{
    [Parameter("uint256", "policyId", 1, true)]          public BigInteger PolicyId { get; set; }
    [Parameter("address", "to", 2, true)]                public string To { get; set; } = "";
    [Parameter("uint256", "refundAmount", 3, false)]     public BigInteger RefundAmount { get; set; }
    [Parameter("uint256", "unlockedCoverage", 4, false)] public BigInteger UnlockedCoverage { get; set; }
}

[Event("CoverageUnlocked")]
public class CoverageUnlockedEvent : IEventDTO
{
    [Parameter("uint256", "policyId", 1, true)] public BigInteger PolicyId { get; set; }
    [Parameter("uint256", "amount", 2, false)]  public BigInteger Amount { get; set; }
}

// ===================== PayoutEngine =====================

[Event("PayoutTriggered")]
public class PayoutTriggeredEvent : IEventDTO
{
    [Parameter("uint256", "policyId", 1, true)] public BigInteger PolicyId { get; set; }
    [Parameter("address", "holder", 2, true)]   public string Holder { get; set; } = "";
    [Parameter("uint256", "amount", 3, false)]  public BigInteger Amount { get; set; }
}
