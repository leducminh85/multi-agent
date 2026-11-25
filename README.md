# AI Multi-Agent Office – Virtual AI Workforce

Văn phòng AI ảo: bạn là CEO, đưa ra yêu cầu (văn bản, giọng nói, ảnh, âm thanh, video, tài liệu); hệ thống **phân tích, lập kế hoạch, chia task, phân công cho các AI Agent** đến từ nhiều nền tảng (Claude, Codex/OpenAI, Gemini/Antigravity, Ollama…), theo dõi realtime, cho các agent phối hợp với nhau và tổng hợp kết quả – kèm **văn phòng 2D pixel-art** nơi bạn nhìn thấy từng agent đang làm gì.

> Đây không phải bản demo giao diện: mọi nút đều gọi API thật, tiến độ là các bước thực thi thật, usage chỉ ghi khi provider báo cáo, không có dữ liệu giả.

## Tính năng chính

- **Agent Management** – thêm/sửa/xoá, tạm dừng/kích hoạt, chọn provider & model, vai trò (9 mẫu + tự tạo), system prompt riêng, quyền (knowledge scope, file, ghi file/chạy lệnh/mạng cho agent CLI, uỷ quyền, nhắn tin), giới hạn tài nguyên (task đồng thời, token output, timeout, ngân sách token/ngày), kiểm tra kết nối. Không giới hạn số agent khai báo; số chạy đồng thời giới hạn theo global / provider / agent.
- **Orchestrator** – lập kế hoạch bằng agent PM, task DAG, chạy **song song** và **tuần tự theo phụ thuộc**, **uỷ quyền phân cấp** (agent yêu cầu agent khác hỗ trợ), **agent-to-agent messaging**, hỏi quản lý khi thiếu thông tin, **phê duyệt** hành động nhạy cảm, **retry + chuyển agent khác khi lỗi**, QA review tuỳ chọn, CEO Assistant tổng hợp báo cáo. Quản lý có thể huỷ, retry, giao lại, trả lời, dừng khẩn cấp toàn bộ.
- **Task Management** – Kanban, List, Timeline, Gantt, Activity Feed; chi tiết task: agent, provider, thời gian, trạng thái (9 trạng thái), phụ thuộc, task con, các bước đã làm, live output (streaming), output, error log, usage.
- **Multimodal Command Center** – text, đọc chính tả (Web Speech API), ghi âm micro (phiên âm phía server), ảnh, audio, video, PDF, DOCX, XLSX, CSV, ZIP, mã nguồn… đính kèm nhiều file trong một yêu cầu.
- **Usage & Subscription** – usage thật theo provider/agent/model/ngày/tuần/tháng, chi phí *reported* vs *estimated*, rate limit từ header, đồng bộ billing API chính thức (admin key), quota gói đăng ký nhập thủ công có nguồn/độ tin cậy/thời điểm reset, cảnh báo sắp hết/chạm giới hạn/lỗi kết nối/hết cửa sổ phiên.
- **Virtual Office 2D** – 8 khu vực (Main, Research, Development, Design, Content, Meeting, Server, Manager), mỗi agent một nhân vật; hoạt ảnh theo trạng thái thật (idle, working, thinking, reading, writing, coding với màn hình chạy code, discussing → đi tới phòng họp, waiting, error, completed với hiệu ứng). Click nhân vật để xem nhiệm vụ, tiến độ, lịch sử, output, Pause/Stop, giao việc trực tiếp. Đèn server nhấp nháy theo số task đang chạy thật; đường nét đứt vàng = tin nhắn agent-to-agent thật.
- **Communication Center** – Global chat với CEO Assistant (có thể tự khởi tạo mission), kênh agent-to-agent, hàng chờ phê duyệt & câu hỏi.
- **Knowledge & Files** – project riêng, shared workspace (thư mục làm việc của agent CLI), knowledge global/project/agent-memory, lưu lịch sử task, kho tài liệu có trích xuất nội dung.
- **Security** – AES-256-GCM cho credential (không bao giờ trả về trình duyệt), scrypt cho mật khẩu, audit log, rate limit, xác nhận bắt buộc cho thao tác xoá/dừng khẩn cấp, backup DB, emergency stop.

## Yêu cầu

- **Node.js ≥ 22.13** (khuyến nghị 24 – dùng SQLite tích hợp `node:sqlite`, không cần biên dịch native).
- Tuỳ chọn: `ffmpeg` (phân tích video), các CLI `claude`, `codex`, `agy` (nếu dùng agent CLI), Ollama (model local).

## Cài đặt & chạy

```powershell
git clone https://github.com/leducminh85/multi-agent.git
```

```powershell
cd multi-agent
```

```powershell
npm install
```

```powershell
Copy-Item .env.example .env
```

Chế độ phát triển (API :4317 + Vite :5173 có proxy):

```powershell
npm run dev
```

Chế độ chạy thật (build web, server phục vụ luôn giao diện tại http://127.0.0.1:4317):

```powershell
npm run build
```

```powershell
npm start
```

Lần đầu mở trang, tạo tài khoản quản lý (CEO). Sau đó trình **Set up your office** tự mở:

1. Hệ thống tự dò AI có sẵn trên máy (Claude, Codex, Antigravity, Ollama). **Claude**: dùng được cả bản `claude` đi kèm app Claude desktop hoặc extension VS Code – nếu chưa đăng nhập, bấm **Sign in to Claude / Đăng nhập Claude**, cửa sổ đăng nhập chính thức mở ra, đăng nhập trên trình duyệt là xong (trang tự nhận ra). Bấm vào cái muốn dùng – hoặc chọn Claude/ChatGPT/Gemini và dán API key. Không cần điền gì khác: model và cấu hình được chọn sẵn, kết nối được kiểm tra thật.
2. Hệ thống tự tạo đội 6 nhân viên AI.
3. Gõ yêu cầu vào ô **Assign work** ở đầu dashboard (có thể đính kèm file, ghi âm).

Nút **EN / VI** ở góc trên đổi ngôn ngữ giao diện (cả trang đăng nhập).

**Dashboard một màn hình** gồm 4 ô cập nhật realtime: **Virtual office** (click vào nhân vật để xem/giao việc), **Communication** (chat với trợ lý, tin nhắn giữa các agent, mục *Needs you* để phê duyệt/trả lời), **Tasks** (yêu cầu, đang làm, xong, lỗi) và **Usage** (token, chi phí, quota từng AI). Các trang chi tiết (nhân viên, Kanban/Gantt, usage đầy đủ, dự án, file, cài đặt) nằm trong menu **More**.

Câu trả lời của AI hiển thị dạng **Markdown** (tiêu đề, danh sách, bảng, code). Ảnh/video được **hiện trực tiếp**: link ảnh/video trên web, video YouTube/Vimeo, và cả đường dẫn file mà agent lưu trong workspace (ví dụ `D:\...\chart.png`, `out/clip.mp4`) – chỉ file nằm trong workspace/kho file của văn phòng mới được mở. Nút *Văn bản gốc* để xem nội dung thô.

Khi nhân viên hỏi bạn (ô **Cần bạn**), có thể trả lời kèm **ảnh hoặc tệp**: bấm 📎, kéo thả, hoặc **Ctrl+V dán ảnh chụp màn hình**. Tệp được giao cho nhân viên cùng câu trả lời (ảnh được AI nhìn thấy, tài liệu được trích nội dung).

Thêm nhân viên: nút **Hire** – chọn công việc, đặt tên, xong. Cấu hình chi tiết (model, quyền, giới hạn) nằm trong *Advanced settings…*.

### Docker (và tên miền multi-agents.wevic.vn)

Tunnel Cloudflare `multi-agents.wevic.vn` chuyển tới `http://localhost:4317`, nên chỉ cần **một** trong hai cách chạy dưới đây nghe ở cổng 4317:

- **Chạy thường** (`npm start`) – dùng được **mọi** AI của máy: Claude và Antigravity (`agy.exe`).
- **Docker** – tự khởi động lại, chạy nền:

```powershell
docker compose up -d --build
```

Tắt `npm start` trước (cùng cổng, cùng dữ liệu `server/data`). Container có sẵn ffmpeg, python, edge-tts và Claude Code CLI, dùng đăng nhập Claude của máy (`~/.claude/.credentials.json`).
**Giới hạn:** Antigravity CLI (`agy`) chỉ có bản Windows nên **không chạy trong container** – nhân viên dùng Antigravity cần chuyển sang Claude (Thêm → Nhân viên → Đổi AI cho cả đội) khi chạy bằng Docker.

## Kiểm thử

```powershell
npm test
```

- Server: 55 test (vitest) – mã hoá, giao thức agent, parser kế hoạch, orchestrator (song song, phụ thuộc, retry, huỷ, emergency stop, uỷ quyền, hỏi quản lý, phê duyệt, memory, giao lại), usage/quota/cảnh báo, REST API (xác thực, không lộ credential, cổng xác nhận, upload), trích xuất file. Dùng một adapter *mock* chỉ có trong test.
- Web: test layout văn phòng ảo.
- Đã chạy end-to-end thật với Ollama (`qwen2.5:3b`): lập kế hoạch → 3 task trên 3 agent → tổng hợp → báo cáo; và kiểm chứng adapter Antigravity CLI với `agy` thật.

## Cấu trúc thư mục

```
server/   Node + TypeScript API, orchestrator, adapters, usage, files (xem docs/ARCHITECTURE.md)
web/      React + Vite + Tailwind UI, Virtual Office engine (web/src/office)
docs/     ARCHITECTURE.md (phân tích & thiết kế), PROVIDERS.md (khả năng/giới hạn từng provider)
```

## Dữ liệu & sao lưu

- `server/data/office.db` (SQLite), `server/data/storage/` (file tải lên), `server/data/workspaces/<project>/` (workspace của agent CLI), `server/data/backups/`.
- `server/data/master.key` – khoá giải mã credential nếu không đặt `MAO_MASTER_KEY`. **Sao lưu riêng và giữ bí mật.**
- Tạo backup DB tại **Settings → Security & backup**.

## Giới hạn đã biết (báo cáo trung thực)

- Hạn mức gói **Claude** (5 giờ / tuần) và **Antigravity** (theo nhóm model) được đọc trực tiếp từ công cụ CLI chính thức của từng hãng, hiển thị % đã dùng và giờ reset. ChatGPT Plus/Pro chưa có nguồn như vậy → nhập thủ công; hệ thống không scrape.
- Agent truy cập web được (mặc định bật, tắt từng người ở mục AI & model). Video YouTube: đọc trang, mô tả, tìm kiếm thông tin – AI không xem được hình ảnh video.
- Chi phí từng request với API là ước tính từ bảng giá (trừ Claude Code CLI báo chi phí); chi phí chính xác lấy từ billing API khi có admin key.
- % tiến độ của một task đơn lẻ không xác định được → hiển thị bước thực thi thật và live output.
- Chưa có OCR cho PDF scan; video cần ffmpeg (hoặc Gemini cho file nhỏ).

Chi tiết và đề xuất thay thế: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#7-giới-hạn-kỹ-thuật--giải-pháp-thay-thế).
