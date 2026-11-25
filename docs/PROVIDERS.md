# Provider – khả năng tích hợp thực tế

Mỗi provider là một adapter trong `server/src/providers`. Tất cả cùng tuân theo hợp đồng `ProviderAdapter` (`run`, `checkConnection`, và tuỳ chọn `fetchBilling`, `transcribe`, `describeMedia`).

## Anthropic Claude (API) – `anthropic-api`
- Gọi qua **SDK TypeScript chính thức** `@anthropic-ai/sdk`, streaming Messages API. Mặc định `claude-opus-5-5`; có thể đặt `effort` (`output_config.effort`).
- Fallback khi model từ chối (`server-side-fallback` beta) bật mặc định cho các model hỗ trợ; tắt được trong cấu hình provider.
- Usage: `input/output/cache` token từ stream; rate-limit từ header `anthropic-ratelimit-*`.
- Chi phí: ước tính từ bảng giá. Chi phí thật: nhập **Admin API key** → nút *Sync billing* gọi Usage & Cost Analytics API (`/v1/organizations/analytics/cost`, beta; dữ liệu có độ trễ vài giờ).
- Không liên quan tới giới hạn Claude Pro/Max.

## Claude Code (CLI) – `claude-code-cli`
- `claude -p --output-format json` với prompt qua stdin, chạy trong workspace của project.
- **Tự tìm CLI**: để lệnh là `claude` thì hệ thống tìm bản trên PATH, `~/.local/bin`, npm global, rồi bản đi kèm app Claude desktop (`Claude-Data/.../claude-code/<version>`) và extension VS Code/Cursor/Windsurf – chọn bản mới nhất, tự chuyển khi app cập nhật.
- **Đăng nhập**: `claude auth status` cho biết trạng thái thật; nút *Sign in to Claude* mở `claude auth login` trong cửa sổ console riêng (đăng nhập trên trình duyệt, office không thấy thông tin đăng nhập). Lỗi "Not logged in" được báo rõ và không retry vô ích.
- Biến môi trường của phiên Claude Code lồng nhau (`CLAUDECODE`, `CLAUDE_CODE_ENTRYPOINT`, …) được loại khỏi tiến trình agent.
- Quyền agent → `--allowedTools` / `--disallowedTools` (Read/Glob/Grep luôn có; Edit/Write khi cho phép ghi; Bash khi cho phép chạy lệnh; WebFetch/WebSearch khi cho phép mạng).
- Usage: token do CLI báo. Chi phí: đăng nhập bằng API key → ghi `total_cost_usd` là chi phí thật; đăng nhập gói Pro/Max (claude.ai) → **không** ghi chi phí (giá trị đó chỉ là quy đổi API, không bị tính tiền), chỉ lưu tham khảo `apiEquivalentUsd`. Đã chạy thật end-to-end với gói claude.ai (`claude-opus-5-5`).
- **Hạn mức gói (5 giờ / tuần)**: đọc từ chính Claude Code – chạy với `--output-format stream-json`, CLI phát sự kiện `rate_limit_event` (`unifiedWindows.five_hour / seven_day`: `utilization`, `resetsAt`). Cập nhật sau mỗi lần chạy; nút *Cập nhật mức dùng* gửi 1 yêu cầu rất nhỏ (haiku). Chạm 100% → AI tạm nghỉ tới giờ reset, việc chuyển sang AI khác.
- Web: khi agent được phép truy cập web → `WebSearch`, `WebFetch` (mở trang, link YouTube – đọc trang/mô tả, không xem được hình video).

## OpenAI (API) – `openai-api`
- REST Chat Completions (streaming, `stream_options.include_usage`), ảnh qua `image_url` data URL, phiên âm qua `/v1/audio/transcriptions` (mặc định `whisper-1`).
- Rate-limit từ header `x-ratelimit-*`. Admin key → Costs API + Usage API (completions).
- Không liên quan tới ChatGPT Plus/Pro.

## OpenAI Codex (CLI) – `codex-cli`
- `codex exec --json --skip-git-repo-check --sandbox read-only|workspace-write -` (prompt qua stdin). Mạng bật bằng `sandbox_workspace_write.network_access=true` khi agent được phép.
- Usage: tổng token từ sự kiện `turn.completed`. Không có chi phí.
- Giới hạn gói ChatGPT không có API → nhập thủ công.

## Google Gemini (API) – `gemini-api`
- REST `models/{model}:streamGenerateContent?alt=sse` với `x-goog-api-key`. Hiểu ảnh, âm thanh, video (inline ≤ ~18 MB). Dùng được làm provider phiên âm và vision.
- Không có billing API cho API key → chi phí ước tính.

## Google Antigravity (CLI) – `antigravity-cli`
- `agy --output-format json [--mode accept-edits] [--sandbox] --disable-slash-commands --print-timeout Ns --print=<prompt>`. **Không dùng `--mode plan`**: ở chế độ này agy chỉ viết kế hoạch và chờ duyệt thay vì làm việc (đã gây lỗi "Empty response"); agent chỉ-đọc chạy chế độ mặc định + `--sandbox`; đã kiểm chứng định dạng JSON thật: `{status, response, usage{input_tokens, output_tokens, thinking_tokens, cache_read_tokens}}`.
- Prompt dài (> 20k ký tự, do giới hạn dòng lệnh Windows) được ghi vào file trong workspace và agent được yêu cầu đọc file đó.
- **Hạn mức gói**: `agy --output-format json --print=/usage` (không tốn token) trả về các nhóm model (Gemini; Claude & GPT) với `remaining_fraction` và `reset_time` cho giới hạn 5 giờ và tuần. Tự cập nhật mỗi 10 phút và sau mỗi lần chạy.
- Web: `--sandbox` gỡ bỏ công cụ web (`search_web`, `read_url_content`, trình duyệt) → chỉ dùng `--sandbox` khi agent **không** được phép truy cập web. Lệnh terminal vẫn cần duyệt (print mode không tự duyệt).
- `agy` có đăng nhập riêng (khác app Antigravity): đổi tài khoản bằng `/logout` + `/login` trong `agy` (nút *Đổi tài khoản*).

## Ollama – `ollama` và OpenAI-compatible – `openai-compatible`
- Dùng chung phần cài đặt Chat Completions. Ollama kiểm tra kết nối qua `/api/tags`.
- `openai-compatible` cho phép thêm OpenRouter, LM Studio, vLLM, Groq, DeepSeek… **không cần viết code**.

## Subscription account (tracking only) – `subscription-tracker`
- Đại diện cho một tài khoản gói đăng ký chỉ để theo dõi quota; không chạy task.

## Thêm provider mới
1. Tạo file `server/src/providers/<ten>.ts` export một `ProviderAdapter` với `descriptor` (khai báo trung thực `integration`, `capabilities`, `limitations`).
2. Đăng ký trong `DEFAULT_ADAPTERS` (`registry.ts`). Giao diện (form cấu hình, bảng khả năng) tự sinh từ descriptor.
3. Nếu provider chỉ là một endpoint tương thích OpenAI, không cần code – dùng `openai-compatible`.
