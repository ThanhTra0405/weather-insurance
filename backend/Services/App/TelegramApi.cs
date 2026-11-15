using System.Net.Http.Json;
using System.Text.Json;
using backend.Options;
using Microsoft.Extensions.Options;

namespace backend.Services.App;

/// <summary>Một tin nhắn văn bản gửi tới bot trong chat riêng.</summary>
public record TelegramMessageUpdate(long UpdateId, long ChatId, string Text);

/// <summary>Gọi Telegram Bot API (sendMessage, getUpdates) bằng HttpClient. Chỉ dùng khi đã cấu hình Telegram:BotToken.</summary>
public class TelegramApi
{
    private readonly IHttpClientFactory _httpFactory;
    private readonly TelegramOptions _options;

    public TelegramApi(IHttpClientFactory httpFactory, IOptions<TelegramOptions> options)
    {
        _httpFactory = httpFactory;
        _options = options.Value;
    }

    public bool IsConfigured => _options.IsConfigured;

    /// <summary>Gửi tin định dạng HTML. Lỗi (kể cả người dùng đã chặn bot) ném HttpRequestException.</summary>
    public async Task SendMessageAsync(long chatId, string html, CancellationToken ct = default)
    {
        using var response = await Client().PostAsJsonAsync(Url("sendMessage"), new
        {
            chat_id = chatId,
            text = html,
            parse_mode = "HTML",
            disable_web_page_preview = true,
        }, ct);

        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync(ct);
            throw new HttpRequestException($"Telegram sendMessage lỗi {(int)response.StatusCode}: {Truncate(body)}");
        }
    }

    /// <summary>Long polling. Chỉ trả các tin văn bản trong chat riêng (private); bỏ qua loại update khác.</summary>
    public async Task<List<TelegramMessageUpdate>> GetUpdatesAsync(long offset, int timeoutSeconds,
        CancellationToken ct = default)
    {
        using var response = await Client().GetAsync(
            Url($"getUpdates?offset={offset}&timeout={timeoutSeconds}&allowed_updates=%5B%22message%22%5D"), ct);

        var json = await response.Content.ReadAsStringAsync(ct);
        if (!response.IsSuccessStatusCode)
            throw new HttpRequestException($"Telegram getUpdates lỗi {(int)response.StatusCode}: {Truncate(json)}");

        var result = new List<TelegramMessageUpdate>();
        using var doc = JsonDocument.Parse(json);
        if (!doc.RootElement.TryGetProperty("result", out var updates) || updates.ValueKind != JsonValueKind.Array)
            return result;

        foreach (var update in updates.EnumerateArray())
        {
            if (!update.TryGetProperty("update_id", out var idProp)) continue;
            var updateId = idProp.GetInt64();

            // Vẫn trả về update_id của các update không phải tin nhắn để bộ đếm offset tiến lên.
            if (!update.TryGetProperty("message", out var message)
                || !message.TryGetProperty("chat", out var chat)
                || !chat.TryGetProperty("id", out var chatIdProp)
                || (chat.TryGetProperty("type", out var typeProp) && typeProp.GetString() != "private"))
            {
                result.Add(new TelegramMessageUpdate(updateId, 0, ""));
                continue;
            }

            var text = message.TryGetProperty("text", out var textProp) ? textProp.GetString() ?? "" : "";
            result.Add(new TelegramMessageUpdate(updateId, chatIdProp.GetInt64(), text));
        }

        return result;
    }

    private HttpClient Client()
    {
        var client = _httpFactory.CreateClient();
        client.Timeout = TimeSpan.FromSeconds(60); // lớn hơn thời gian giữ của long polling (30 giây)
        return client;
    }

    private string Url(string method) => $"https://api.telegram.org/bot{_options.BotToken}/{method}";

    private static string Truncate(string s) => s.Length <= 200 ? s : s[..200];
}
