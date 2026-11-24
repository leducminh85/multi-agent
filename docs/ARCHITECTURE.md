# Kiến trúc – AI Multi-Agent Office

Tài liệu này ghi lại phần phân tích trước khi code (mục 15 của yêu cầu): kiến trúc tổng thể, module, database schema, luồng Orchestrator, đánh giá tích hợp từng Provider, giới hạn kỹ thuật và kế hoạch triển khai.

## 1. Phân tích yêu cầu → quyết định kiến trúc

| Yêu cầu | Quyết định |
|---|---|
| Hệ thống điều hành AI thực tế, không phải demo | Backend là nguồn sự thật duy nhất: mọi trạng thái (task, bước, tiến độ, usage) đều được ghi DB và đẩy realtime. Không có dữ liệu demo/seed ngoài cấu hình bắt buộc (9 vai trò mẫu, project "General"). |
| Nhiều provider, mở rộng không giới hạn | Provider Adapter Layer + Registry. Thêm provider = viết 1 adapter (hoặc dùng adapter `openai-compatible` không cần code). |
| Phân biệt API / CLI / SDK / Desktop | Mỗi adapter khai báo `integration: api \| cli \| local-server \| tracking-only` và `capabilities` (streaming, vision, transcription, agenticTools, usageReporting, billingApi, subscriptionQuotaApi). |
| Nhiều agent đồng thời, bất đồng bộ | Scheduler dựa trên DB với 3 tầng giới hạn: global, per-provider, per-agent. Mọi lời gọi provider là async + AbortSignal. |
| Không giả lập tiến độ/usage | Tiến độ = các bước thực thi thật (`task_steps`), % chỉ ở cấp mission (task hoàn thành / tổng). Usage chỉ ghi khi provider báo cáo; chi phí gắn nhãn `reported` / `estimated` / `unknown`. |
| Bảo mật | AES-256-GCM vault cho credential, scrypt cho mật khẩu, token phiên băm SHA-256, audit log, rate limit, xác nhận bắt buộc (server-side) cho thao tác phá huỷ, phê duyệt cho hành động nhạy cảm của agent, quyền theo agent. |
| Virtual Office mở rộng được | Engine Canvas 2D tách biệt (`web/src/office`), layout thuần dữ liệu có test; React chỉ cấp dữ liệu và nhận sự kiện click. Có thể thay renderer bằng PixiJS/Phaser mà không đụng phần còn lại. |

### Lựa chọn stack (đã đánh giá, không dùng máy móc)

- **Node.js 24 + TypeScript** cho backend: cùng ngôn ngữ với frontend, SDK chính thức của Anthropic cho TypeScript, spawn CLI dễ dàng.
- **SQLite tích hợp sẵn (`node:sqlite`)** thay vì PostgreSQL: zero-config cho một văn phòng chạy trên máy cá nhân, giao dịch ACID, WAL. Toàn bộ truy cập qua lớp `Database` nhỏ → chuyển sang PostgreSQL chỉ cần thay lớp này + migration.
- **Không dùng Redis** ở phiên bản đầu: Event Bus và Task Queue là in-process, nhưng **DB là nguồn sự thật** của hàng đợi (task có `status`, `not_before`, `pinned`…), nên khởi động lại không mất việc. Giao diện `EventBus` cố ý nhỏ để thay bằng Redis Pub/Sub/NATS khi chạy nhiều máy.
- **Không dùng Docker cho mỗi agent**: agent API không cần sandbox; agent CLI chạy trong **thư mục workspace riêng của project**, quyền công cụ được map sang cờ chính thức của từng CLI (`--allowedTools`, `--sandbox`, `--mode plan`). Dockerfile được cung cấp cho việc triển khai cả hệ thống.
- **Frontend**: React 18 + Vite + TypeScript + Tailwind + TanStack Query + Framer Motion + Recharts. Virtual Office dùng Canvas 2D tự viết (pixel-art procedural, không cần asset) thay vì PixiJS để giảm phụ thuộc – kiến trúc cho phép đổi sau.

## 2. Kiến trúc tổng thể

```
┌──────────────────────────── Web (React) ────────────────────────────┐
│ Overview · Virtual Office (Canvas engine) · Agents · Tasks (Kanban/  │
│ List/Timeline/Gantt/Feed) · Communication · Usage · Projects ·       │
│ Files · Settings          ── REST (/api) ──  WebSocket (/ws) ──      │
└──────────────────────────────────────────────────────────────────────┘
                 │                                   ▲ events
┌────────────────▼───────────────── Server ──────────┴─────────────────┐
│ Express API (auth, rate limit, confirm gate, audit)   WS hub          │
│        │                                              ▲               │
│ ┌──────▼──────────┐   ┌──────────────┐   ┌────────────┴──┐            │
│ │  Orchestrator   │──▶│ Agent Runtime│──▶│ Provider      │──▶ APIs / CLIs / Ollama
│ │ plan·DAG·assign │   │ usage·limits │   │ Adapter Layer │            │
│ │ retry·delegate  │   │ activity     │   └───────────────┘            │
│ └──┬───────┬──────┘   └──────┬───────┘                                │
│    │ Store (task queue)      │ UsageService (records·quotas·alerts·billing sync)
│    │ ContextBuilder ◀── Knowledge · Files (parsers, transcription, vision, ffmpeg)
│    │ Comms (global chat, agent channel) · Approvals                    │
│    └──────────────► EventBus ──────────────► Activity feed             │
│                         SQLite (node:sqlite, WAL)                      │
└───────────────────────────────────────────────────────────────────────┘
```

## 3. Module (server/src)

| Module | Trách nhiệm |
|---|---|
| `db/` | Wrapper SQLite + migration có version |
| `core/crypto.ts` | SecretBox AES-256-GCM, scrypt, token |
| `core/eventBus.ts` | Event bus (publish/subscribe) |
| `core/activity.ts` | Activity feed (DB + realtime) |
| `core/audit.ts` | Audit log (tự che secret) |
| `core/settings.ts` | Cấu hình runtime, ngưỡng cảnh báo, bảng giá |
| `auth/` | Thiết lập lần đầu, đăng nhập, phiên, middleware, cổng xác nhận |
| `providers/` | `types` (hợp đồng adapter), `registry`, adapter: Anthropic (SDK chính thức), OpenAI, Gemini, Ollama, OpenAI-compatible, Claude Code CLI, Codex CLI, Antigravity CLI, Subscription tracker; `service` (CRUD + credential mã hoá + health check) |
| `agents/` | Vai trò (9 mẫu + tuỳ chỉnh), agent CRUD, quyền & giới hạn |
| `orchestrator/` | `store` (mission/task/step = task queue), `protocol` (giao thức hành động của agent, parse plan), `context` (dựng prompt theo quyền), `runtime` (gọi provider, usage, activity), `approvals`, `orchestrator` (lập kế hoạch, lập lịch, thực thi, retry, uỷ quyền, hợp nhất) |
| `usage/` | Ghi usage, tổng hợp, chuỗi thời gian, quota, cảnh báo, đồng bộ billing API |
| `files/` | Lưu trữ, nhận dạng loại, parser tài liệu, phiên âm, mô tả ảnh, phân tích video (ffmpeg) |
| `knowledge/` | Kiến thức global / project / agent-memory, truy xuất có lọc quyền |
| `comms/` | Global chat & kênh agent-to-agent |
| `projects/` | Project + shared workspace |
| `routes/` | REST API |
| `ws.ts`, `jobs.ts` | WebSocket realtime, job nền (health check, billing sync, cảnh báo) |

## 4. Database schema (SQLite)

| Bảng | Nội dung chính |
|---|---|
| `users`, `sessions` | Tài khoản quản lý (scrypt), phiên (token hash, hết hạn) |
| `settings` | Cấu hình JSON theo section + cờ (emergency stop) |
| `providers` | type, config, `credentials_enc` (AES-GCM), `credential_hint` (đã che), status, rate_limit, max_concurrency, account_label, plan_name |
| `roles` | key, department, system_prompt, work_activity, builtin |
| `agents` | role, provider, model, prompt, specialties, permissions, limits, activity, current_task_id, paused/enabled |
| `projects` | Project |
| `missions` | Yêu cầu của quản lý, file đính kèm, plan, result, trạng thái |
| `tasks` | mission, parent (help), depends_on, agent/provider, status (9 trạng thái), attempts, waiting_reason, extra_context (kết quả hỗ trợ / câu trả lời / phê duyệt), pinned, not_before (retry), depth (uỷ quyền) |
| `task_steps` | Các bước thực thi thật của mỗi lần chạy |
| `messages` | channel `global`/`agents`, loại (message/result/help_request/error/question/report…) |
| `activities` | Activity feed |
| `usage_records` | Token in/out/cache/reasoning, cost + `cost_source`, `source` (api_response/cli_report/provider_api/manual) |
| `quota_entries` | metric, used, limit, unit, resets_at, `confidence` (actual/estimated/unknown), `source` (manual/provider_api/cli/computed), captured_at |
| `alerts` | Cảnh báo có dedupe, ack, resolve |
| `files` | Metadata, sha256, trạng thái trích xuất, văn bản trích xuất |
| `knowledge` | scope global/project/agent |
| `audit_log` | Ai làm gì, khi nào, với đối tượng nào |
| `approvals` | Yêu cầu phê duyệt hành động nhạy cảm |

## 5. Luồng Orchestrator

```
Quản lý gửi yêu cầu (text/voice/file)  ──▶  Mission (planning)
   │ 1. chờ xử lý file (parse / phiên âm / mô tả ảnh / video)
   │ 2. chọn Planner (cấu hình → Project Manager → CEO Assistant → bất kỳ)
   │ 3. Planner trả JSON {intent, title, summary, tasks[key,title,description,role,depends_on]}
   │    – kiểm tra: key trùng, phụ thuộc lạ, chu trình; sai 2 lần → kế hoạch 1 task (ghi rõ lý do)
   │ 4. tạo Task DAG (+ QA review nếu bật, + task tổng hợp cho Coordinator khi >1 task)
   ▼
Scheduler (tick khi có sự kiện + mỗi 5s)
   │ task pending/assigned, đã qua not_before, mọi phụ thuộc đã kết thúc
   │ phụ thuộc lỗi → huỷ task (task tổng hợp vẫn chạy nếu còn kết quả)
   │ chọn agent: pinned → đúng agent; khác → cùng role → general → bất kỳ
   │   loại agent bị pause/disabled/hết budget/provider tracking-only; tôn trọng giới hạn global/provider/agent
   │   retry ưu tiên agent khác (error recovery)
   ▼
Runtime chạy task  (bước: chuẩn bị context → gửi request → nhận output → hoàn tất)
   │ context = vai trò + persona + yêu cầu gốc + task + output phụ thuộc + kết quả hỗ trợ
   │           + câu trả lời của quản lý + tin nhắn đồng nghiệp + knowledge được phép + file được phép
   │ streaming → task.stream (live output), activity agent: reading → thinking → coding/writing…
   │ usage + rate-limit header được ghi lại
   ▼
Phân tích output (khối ```mao-actions```)
   ├─ messages        → kênh agents, agent nhận chuyển "discussing"
   ├─ help_requests   → tạo task con (kind=help, depth+1), task cha WAITING  (Hierarchical Delegation)
   ├─ question_for_manager → Global chat, task WAITING tới khi quản lý trả lời
   ├─ approval_request → Approvals, task WAITING tới khi duyệt/từ chối
   ├─ memory          → knowledge scope agent
   └─ không có gì cần chờ → COMPLETED, chia sẻ kết quả lên kênh agents
Lỗi → ghi error log; retry với backoff luỹ thừa nếu lỗi tạm thời hoặc có agent thay thế; hết lượt → FAILED
Task con kết thúc → task cha nhận kết quả & tiếp tục (tối đa 2 vòng)
Mọi task kết thúc → Mission COMPLETED/FAILED, CEO Assistant gửi báo cáo vào Global chat
```

Can thiệp của quản lý: huỷ task/mission, retry (mở lại cả các task phụ thuộc đã bị huỷ), giao lại cho agent khác (đang chạy thì huỷ lời gọi và chạy lại), trả lời câu hỏi, duyệt/từ chối, pause/stop agent, **Emergency Stop** (huỷ mọi lời gọi đang chạy, dừng hàng đợi, có Resume), giao việc trực tiếp cho một agent (bỏ qua lập kế hoạch).

Khởi động lại server: task đang chạy được đưa lại hàng đợi, mission đang lập kế hoạch được lập lại.

## 6. Đánh giá tích hợp Provider

Xem chi tiết trong [PROVIDERS.md](PROVIDERS.md). Tóm tắt:

| Nền tảng | Cách tích hợp | Chạy task | Usage | Quota gói đăng ký |
|---|---|---|---|---|
| Anthropic Claude (API) | SDK TypeScript chính thức, streaming | ✓ | token/request + rate-limit header; chi phí ước tính; Admin analytics API (admin key) | Không áp dụng (API trả theo token) |
| Claude Code (CLI) | `claude -p --output-format json` | ✓ (agentic) | token + `total_cost_usd` do CLI báo | **Không có API chính thức** → nhập thủ công |
| OpenAI (API) | REST Chat Completions + Audio | ✓ | token + rate-limit header; Costs/Usage API (admin key) | Không áp dụng |
| OpenAI Codex (CLI) | `codex exec --json` | ✓ (agentic) | token từ sự kiện `turn.completed` | **Không có API** → thủ công |
| Google Gemini (API) | REST `streamGenerateContent` | ✓ (ảnh/âm thanh/video) | token | Không có billing API cho API key |
| Google Antigravity | CLI `agy --output-format json` (đã kiểm chứng) | ✓ (agentic) | token input/output/thinking | **Không có API** → thủ công; IDE desktop không có API |
| Ollama / OpenAI-compatible | REST | ✓ | token nếu server trả `usage` | Không áp dụng |

## 7. Giới hạn kỹ thuật & giải pháp thay thế

1. **Quota gói đăng ký (Claude Pro/Max, ChatGPT Plus/Pro, Google AI/Antigravity) không có API chính thức.** Hệ thống **không** scrape trang web hay đọc token đăng nhập. Giải pháp: provider loại *Subscription account (tracking only)* hoặc mục quota thủ công trên bất kỳ provider nào; mỗi mục có nguồn, độ tin cậy, thời điểm ghi, thời điểm reset; cảnh báo theo ngưỡng và tự đánh dấu "lỗi thời" khi qua giờ reset. Usage *thực đo* của các lời gọi do văn phòng thực hiện vẫn được ghi chính xác.
2. **Chi phí từng request**: API của Anthropic/OpenAI/Gemini trả token chứ không trả USD → chi phí là *ước tính* từ bảng giá có thể sửa (mặc định chỉ có giá niêm yết Anthropic; model chưa có giá hiển thị "unknown" chứ không đoán). Chi phí thật lấy từ Admin/Costs API khi cấu hình admin key.
3. **Phần trăm tiến độ của một task** không xác định được (LLM không báo %): hiển thị các bước thực thi thật + live output; % chỉ có ở cấp mission.
4. **Agent CLI không stream**: chỉ báo "process started/exited" và (Codex) từng lệnh đang chạy.
5. **OCR cho PDF scan** chưa có: báo rõ "không có lớp văn bản".
6. **Video**: cần ffmpeg (tách âm thanh + 4 khung hình chính) và provider phiên âm/vision; không có ffmpeg thì chỉ Gemini (< 18 MB).
7. **Live dictation** dùng Web Speech API của trình duyệt (Chrome/Edge); trình duyệt khác dùng nút Record → phiên âm phía server.
8. **Phân tán nhiều máy**: kiến trúc đã tách EventBus/Store/Runtime; phiên bản này chạy một node.

## 8. Kế hoạch & trạng thái triển khai

| Phase | Nội dung | Trạng thái |
|---|---|---|
| 1 – Core | Kiến trúc, Agent Manager, Provider Adapter, CRUD agent, Orchestrator, chạy task, trạng thái agent, Dashboard | ✅ |
| 2 – Multi-agent | Agent giao tiếp, chia task tự động, song song, phụ thuộc, shared workspace, realtime | ✅ |
| 3 – Usage | Ghi usage thật, kết nối tài khoản, quota, chi phí API, biểu đồ, cảnh báo, billing API | ✅ |
| 4 – Multimodal | Giọng nói (dictation + ghi âm), ảnh, âm thanh, video, tài liệu | ✅ (phụ thuộc provider media) |
| 5 – Virtual Office | Văn phòng 2D, nhân vật, hoạt ảnh theo trạng thái, tương tác, phòng ban & phòng họp | ✅ (renderer Canvas; có thể nâng cấp PixiJS/sprite sheet) |

Hướng mở rộng tiếp theo: MCP server cho agent API (tool use), browser automation, GitHub/Google Drive connector, runner từ xa (agent chạy trên máy khác qua hàng đợi Redis), PostgreSQL, nhiều người dùng với phân quyền.
