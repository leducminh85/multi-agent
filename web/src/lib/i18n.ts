/**
 * English / Vietnamese interface switch.
 *
 * The UI is written in English. In Vietnamese mode a translator rewrites interface text in the DOM
 * (text nodes + placeholder/title/aria-label) using the dictionary and patterns below, so every page,
 * toast, dialog and server-generated activity line is covered without threading t() through each component.
 * Content written by people or agents (chat, outputs, inputs) is excluded by marking it translate="no",
 * and only whole, exactly matching strings are replaced. Switching language reloads the page.
 */

export type Lang = 'en' | 'vi';
const KEY = 'mao-lang';

export function getLang(): Lang {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'en' || v === 'vi') return v;
  } catch {
    /* storage unavailable */
  }
  return navigator.language?.toLowerCase().startsWith('vi') ? 'vi' : 'en';
}

export function setLang(lang: Lang) {
  try {
    localStorage.setItem(KEY, lang);
  } catch {
    /* storage unavailable – the choice lasts for this page only */
  }
  location.reload();
}

const VI: Record<string, string> = {
  // ---- shell / navigation
  'AI Office': 'Văn phòng AI',
  'AI Multi-Agent Office': 'Văn phòng AI đa tác tử',
  Dashboard: 'Bảng điều khiển',
  More: 'Thêm',
  'Employees (agents)': 'Nhân viên (agent)',
  'Tasks: Kanban, timeline, Gantt': 'Công việc: Kanban, timeline, Gantt',
  'Usage & quotas': 'Mức dùng & hạn mức',
  'All conversations': 'Tất cả hội thoại',
  'Virtual office (full screen)': 'Văn phòng ảo (toàn màn hình)',
  'Projects & knowledge': 'Dự án & tri thức',
  'Projects & Knowledge': 'Dự án & tri thức',
  Files: 'Tệp',
  Settings: 'Cài đặt',
  'Sign out': 'Đăng xuất',
  Live: 'Trực tuyến',
  'Connecting…': 'Đang kết nối…',
  Offline: 'Mất kết nối',
  'QUEUE PAUSED': 'ĐÃ TẠM DỪNG HÀNG ĐỢI',
  'Stop all': 'Dừng tất cả',
  Resume: 'Tiếp tục',
  'Resume the task queue': 'Tiếp tục hàng đợi công việc',
  'Abort all running agents and pause the queue': 'Dừng ngay mọi agent đang chạy và tạm dừng hàng đợi',
  'Alerts & approvals': 'Cảnh báo & phê duyệt',
  'Needs attention': 'Cần chú ý',
  'Nothing needs your attention.': 'Không có gì cần bạn xử lý.',
  'Approval:': 'Phê duyệt:',
  'from agents waiting for your answer': 'từ agent đang chờ bạn trả lời',
  'Emergency stop': 'Dừng khẩn cấp',
  'Stop everything': 'Dừng tất cả',
  'All running agent calls will be aborted immediately and the task queue paused. Interrupted tasks return to the queue and resume when you press Resume.':
    'Mọi agent đang chạy sẽ bị dừng ngay và hàng đợi tạm dừng. Các task bị ngắt sẽ quay lại hàng đợi và chạy tiếp khi bạn bấm Tiếp tục.',
  'Queue resumed': 'Đã tiếp tục hàng đợi',
  'Switch language': 'Đổi ngôn ngữ',

  // ---- login
  Username: 'Tên đăng nhập',
  Password: 'Mật khẩu',
  'Confirm password': 'Nhập lại mật khẩu',
  'Create account': 'Tạo tài khoản',
  'Sign in': 'Đăng nhập',
  'First run – create the manager (CEO) account': 'Lần đầu sử dụng – tạo tài khoản quản lý (CEO)',
  'Sign in to your office': 'Đăng nhập vào văn phòng',
  'The password is stored as a salted scrypt hash. Minimum 8 characters.': 'Mật khẩu được lưu dạng băm scrypt có salt. Tối thiểu 8 ký tự.',
  'Passwords do not match': 'Mật khẩu nhập lại không khớp',

  // ---- dashboard
  'Your office is empty.': 'Văn phòng đang trống.',
  'Connect an AI and hire a team. It takes about a minute and needs no technical knowledge.': 'Kết nối một AI và tuyển đội nhân viên. Mất khoảng một phút, không cần kiến thức kỹ thuật.',
  'Set up now': 'Thiết lập ngay',
  'Assign work: describe what you need and the team plans, splits and does it… (you can attach files or record your voice)':
    'Giao việc: mô tả bạn cần gì, đội sẽ lập kế hoạch, chia việc và thực hiện… (có thể đính kèm file hoặc ghi âm)',
  'Virtual office': 'Văn phòng ảo',
  'Virtual Office': 'Văn phòng ảo',
  Hire: 'Tuyển',
  'Hire an AI employee': 'Tuyển nhân viên AI',
  'Full screen': 'Toàn màn hình',
  'No one works here yet': 'Chưa có ai làm việc ở đây',
  'Set up the office': 'Thiết lập văn phòng',
  Communication: 'Trao đổi',
  'Open full view': 'Mở chế độ đầy đủ',
  Assistant: 'Trợ lý',
  'Team chat': 'Đội trao đổi',
  'Needs you': 'Cần bạn',
  'Ask your assistant anything: “How is the report going?”, “What did the team finish today?” It can also start new work for you.':
    'Hỏi trợ lý bất cứ điều gì: “Báo cáo tới đâu rồi?”, “Hôm nay đội làm xong gì?”. Trợ lý cũng có thể giao việc mới cho đội.',
  'Message your assistant…': 'Nhắn cho trợ lý…',
  'When employees ask each other for help or share results, it shows up here.': 'Khi các nhân viên nhờ nhau giúp đỡ hoặc chia sẻ kết quả, nội dung sẽ hiện ở đây.',
  everyone: 'mọi người',
  'task →': 'task →',
  'Nothing needs you right now. 👍': 'Hiện không có việc gì cần bạn. 👍',
  'Asks for permission': 'Xin phép',
  Allow: 'Cho phép',
  Deny: 'Từ chối',
  Details: 'Chi tiết',
  'Answer →': 'Trả lời →',
  Tasks: 'Công việc',
  'Kanban, timeline, Gantt': 'Kanban, timeline, Gantt',
  'Nothing here yet.': 'Chưa có gì.',
  Usage: 'Mức sử dụng',
  'Details & quotas': 'Chi tiết & hạn mức',
  'Tokens today': 'Token hôm nay',
  'Requests today': 'Yêu cầu hôm nay',
  'Cost 30 days': 'Chi phí 30 ngày',
  'No AI connected yet.': 'Chưa kết nối AI nào.',
  'Only real, measured numbers. Subscription limits can be entered on the Usage page.': 'Chỉ hiển thị số liệu đo thật. Hạn mức gói đăng ký có thể nhập ở trang Mức sử dụng.',
  'No missions yet': 'Chưa có yêu cầu nào',
  'Submit a request in the Command Center – the orchestrator will plan it and assign agents.': 'Gõ yêu cầu vào ô giao việc – hệ thống sẽ lập kế hoạch và phân công nhân viên.',
  'tasks done': 'task xong',
  'tok today': 'token hôm nay',
  'tokens today ·': 'token hôm nay ·',
  'Launch mission': 'Giao việc',
  Send: 'Gửi',
  Assign: 'Giao',
  Record: 'Ghi âm',
  Stop: 'Dừng',
  'Ctrl+Enter': 'Ctrl+Enter',
  'Project: default': 'Dự án: mặc định',
  'Attach files (images, audio, video, PDF, DOCX, XLSX, CSV, ZIP…)': 'Đính kèm file (ảnh, âm thanh, video, PDF, DOCX, XLSX, CSV, ZIP…)',
  'Live dictation (browser speech-to-text)': 'Đọc chính tả (trình duyệt chuyển giọng nói thành chữ)',
  'Record a voice note (transcribed by the configured provider)': 'Ghi âm giọng nói (được chuyển thành chữ bởi AI đã cấu hình)',
  'Dictation language': 'Ngôn ngữ đọc chính tả',
  'Message sent': 'Đã gửi tin nhắn',
  'Mission submitted to the orchestrator': 'Đã giao việc cho đội',
  'Live dictation is not supported by this browser – use the recorder instead (transcribed on the server).':
    'Trình duyệt này không hỗ trợ đọc chính tả – hãy dùng nút Ghi âm (chuyển thành chữ trên máy chủ).',
  'Cancel mission': 'Huỷ yêu cầu',
  'Cancel mission?': 'Huỷ yêu cầu này?',
  'All unfinished tasks will be cancelled.': 'Mọi task chưa xong sẽ bị huỷ.',
  'Delete mission?': 'Xoá yêu cầu này?',
  'The mission, its tasks and outputs will be permanently deleted.': 'Yêu cầu, các task và kết quả sẽ bị xoá vĩnh viễn.',
  'Mission cancelled': 'Đã huỷ yêu cầu',
  'Mission deleted': 'Đã xoá yêu cầu',
  'Final result': 'Kết quả cuối cùng',
  Plan: 'Kế hoạch',
  Request: 'Yêu cầu',
  'Re-plan': 'Lập lại kế hoạch',
  'Re-planning…': 'Đang lập lại kế hoạch…',
  'The planner is analysing the request…': 'Đang phân tích yêu cầu…',
  'Mission attachments': 'File đính kèm',

  // ---- setup wizard
  'Set up your office': 'Thiết lập văn phòng',
  'Choose an AI to run your office. Nothing technical needed: the system picks the settings for you and checks that it actually works.':
    'Chọn một AI để vận hành văn phòng. Không cần kiến thức kỹ thuật: hệ thống tự chọn cấu hình và kiểm tra xem AI có chạy thật không.',
  'Already connected': 'Đã kết nối',
  'Hire 6 employees on this AI': 'Tuyển 6 nhân viên dùng AI này',
  'Found on this computer': 'Có sẵn trên máy này',
  'Checking your computer…': 'Đang kiểm tra máy của bạn…',
  'Not installed on this computer': 'Chưa cài trên máy này',
  '. The key is stored encrypted.': '. Key được lưu mã hoá.',
  'Uses the Claude account already signed in on this computer': 'Dùng tài khoản Claude đã đăng nhập trên máy này',
  'Uses the ChatGPT account already signed in on this computer': 'Dùng tài khoản ChatGPT đã đăng nhập trên máy này',
  'Uses the Google account already signed in on this computer': 'Dùng tài khoản Google đã đăng nhập trên máy này',
  'Ollama (free, runs offline)': 'Ollama (miễn phí, chạy offline)',
  'Ollama is not running': 'Ollama chưa chạy',
  'Ollama is running but has no models yet': 'Ollama đang chạy nhưng chưa có model',
  Use: 'Dùng',
  'Or use an API key': 'Hoặc dùng API key',
  'Claude (Anthropic)': 'Claude (Anthropic)',
  'ChatGPT (OpenAI)': 'ChatGPT (OpenAI)',
  'Gemini (Google)': 'Gemini (Google)',
  'Paste the key here': 'Dán key vào đây',
  Connect: 'Kết nối',
  'Done!': 'Xong!',
  'Open the dashboard': 'Mở bảng điều khiển',
  'Your office is ready': 'Văn phòng đã sẵn sàng',
  'Type a request in the box at the top of the dashboard and the team gets started.': 'Gõ yêu cầu vào ô ở đầu bảng điều khiển là đội bắt đầu làm việc.',
  'Claude (Claude Code)': 'Claude (Claude Code)',
  'Uses your Claude subscription. Signed in and ready.': 'Dùng gói Claude của bạn. Đã đăng nhập, sẵn sàng.',
  'Found on this computer, but not signed in yet.': 'Đã có trên máy nhưng chưa đăng nhập.',
  'Sign in to Claude': 'Đăng nhập Claude',
  'Check again': 'Kiểm tra lại',
  'A Claude sign-in window opened. Finish signing in in your browser – this page notices automatically.':
    'Cửa sổ đăng nhập Claude đã mở. Hãy hoàn tất đăng nhập trên trình duyệt – trang này sẽ tự nhận ra.',
  'Run this command in a terminal to sign in:': 'Chạy lệnh này trong terminal để đăng nhập:',
  'Not installed. Install the official Claude Code (one command in PowerShell), then press Check again:':
    'Chưa cài. Cài Claude Code chính thức (một lệnh trong PowerShell), rồi bấm Kiểm tra lại:',
  'Signed in to Claude': 'Đã đăng nhập Claude',
  'A Claude sign-in window opened. Finish signing in in your browser, then press Test.': 'Cửa sổ đăng nhập Claude đã mở. Hoàn tất đăng nhập trên trình duyệt rồi bấm Kiểm tra.',

  // ---- hire dialog
  '1. What should they do?': '1. Người này làm việc gì?',
  '2. Name': '2. Tên',
  '3. Which AI does the work?': '3. Dùng AI nào để làm?',
  'Advanced settings…': 'Cài đặt nâng cao…',
  'Personal assistant': 'Trợ lý riêng',
  'Talks with you, coordinates the team and reports back': 'Trao đổi với bạn, điều phối đội và báo cáo lại',
  'Project manager': 'Quản lý dự án',
  'Breaks big requests into steps and assigns them': 'Chia việc lớn thành các bước và phân công',
  Researcher: 'Nghiên cứu',
  'Looks things up and summarises information': 'Tìm hiểu và tổng hợp thông tin',
  Programmer: 'Lập trình viên',
  'Writes and fixes code': 'Viết và sửa code',
  Designer: 'Thiết kế',
  'Layout, UI/UX and visual ideas': 'Bố cục, UI/UX và ý tưởng hình ảnh',
  Writer: 'Viết nội dung',
  'Articles, scripts, marketing copy': 'Bài viết, kịch bản, nội dung marketing',
  'Data analyst': 'Phân tích dữ liệu',
  'Numbers, spreadsheets and reports': 'Số liệu, bảng tính và báo cáo',
  Reviewer: 'Kiểm duyệt',
  'Checks the quality of finished work': 'Kiểm tra chất lượng công việc đã xong',
  'All-rounder': 'Đa năng',
  'Handles general tasks': 'Làm các việc chung',
  'Connect an AI first (Set up button on the dashboard).': 'Hãy kết nối một AI trước (nút Thiết lập trên bảng điều khiển).',
  '(connection problem)': '(lỗi kết nối)',
  '(out of quota – using another AI)': '(hết hạn mức – đang dùng AI khác)',

  // ---- generic
  Cancel: 'Huỷ',
  Confirm: 'Xác nhận',
  Save: 'Lưu',
  Delete: 'Xoá',
  Edit: 'Sửa',
  Close: 'Đóng',
  Add: 'Thêm',
  Remove: 'Gỡ',
  Retry: 'Thử lại',
  Approve: 'Duyệt',
  Reject: 'Từ chối',
  Dismiss: 'Bỏ qua',
  Download: 'Tải xuống',
  Preview: 'Xem trước',
  Test: 'Kiểm tra',
  'Test connection': 'Kiểm tra kết nối',
  Name: 'Tên',
  Role: 'Vai trò',
  Provider: 'Nhà cung cấp AI',
  Model: 'Model',
  Status: 'Trạng thái',
  Title: 'Tiêu đề',
  Description: 'Mô tả',
  Type: 'Loại',
  Size: 'Kích thước',
  Started: 'Bắt đầu',
  Duration: 'Thời lượng',
  Output: 'Kết quả',
  Input: 'Đầu vào',
  Agent: 'Nhân viên',
  Agents: 'Nhân viên',
  Task: 'Task',
  Project: 'Dự án',
  Projects: 'Dự án',
  Knowledge: 'Tri thức',
  History: 'Lịch sử',
  Team: 'Đội',
  Legend: 'Chú thích',
  'Live activity': 'Hoạt động trực tiếp',
  'Activity feed': 'Dòng hoạt động',
  'No activity yet': 'Chưa có hoạt động',
  'Activity from agents, tasks and providers appears here in real time.': 'Hoạt động của nhân viên, công việc và AI hiện ở đây theo thời gian thực.',
  'No output yet.': 'Chưa có kết quả.',
  'Search…': 'Tìm…',
  'Filter…': 'Lọc…',
  'Select…': 'Chọn…',
  'Select agent…': 'Chọn nhân viên…',
  '— none —': '— không —',
  Automatic: 'Tự động',
  'Automatic selection': 'Tự động chọn',
  'Settings saved': 'Đã lưu cài đặt',
  Deleted: 'Đã xoá',
  Day: 'Ngày',
  Week: 'Tuần',
  Month: 'Tháng',
  unlimited: 'không giới hạn',
  'just now': 'vừa xong',
  'open task →': 'mở task →',
  'Decision recorded': 'Đã ghi nhận quyết định',

  // ---- statuses & activities
  pending: 'chờ',
  planning: 'lập kế hoạch',
  assigned: 'đã giao',
  running: 'đang chạy',
  waiting: 'đang chờ',
  reviewing: 'đang kiểm tra',
  completed: 'hoàn thành',
  failed: 'lỗi',
  cancelled: 'đã huỷ',
  connected: 'đã kết nối',
  error: 'lỗi',
  unknown: 'chưa rõ',
  disabled: 'đã tắt',
  paused: 'tạm dừng',
  Idle: 'Rảnh',
  Working: 'Đang làm',
  Thinking: 'Đang nghĩ',
  Reading: 'Đang đọc',
  Writing: 'Đang viết',
  Coding: 'Đang code',
  Discussing: 'Đang trao đổi',
  Waiting: 'Đang chờ',
  Error: 'Lỗi',
  Completed: 'Hoàn thành',
  Queued: 'Trong hàng đợi',
  Planning: 'Lập kế hoạch',
  Assigned: 'Đã giao',
  Reviewing: 'Đang kiểm tra',
  Done: 'Xong',
  Failed: 'Lỗi',
  Cancelled: 'Đã huỷ',

  // ---- agents
  'Agent Management': 'Quản lý nhân viên',
  'Hire, configure, pause and supervise your AI workforce. No limit on how many agents you declare – concurrency is limited per agent, per provider and globally.':
    'Tuyển, cấu hình, tạm dừng và giám sát đội nhân viên AI. Không giới hạn số nhân viên; số việc chạy cùng lúc được giới hạn theo nhân viên, theo AI và toàn hệ thống.',
  'Default team': 'Đội mặc định',
  'Hire employee': 'Tuyển nhân viên',
  'No agents yet': 'Chưa có nhân viên',
  'Create an agent and connect it to a provider, or generate a default team (CEO Assistant, PM, Research, Developer, Content, QA).':
    'Tạo nhân viên và kết nối với một AI, hoặc tạo đội mặc định (Trợ lý CEO, Quản lý dự án, Nghiên cứu, Lập trình, Nội dung, Kiểm duyệt).',
  'No current activity': 'Không có hoạt động',
  'never active': 'chưa từng hoạt động',
  'Create a default team': 'Tạo đội mặc định',
  'Create 6 agents': 'Tạo 6 nhân viên',
  'Creates CEO Assistant, Project Manager, Research, Developer, Content and QA agents on one provider. You can change each agent\'s provider and model later.':
    'Tạo 6 nhân viên (Trợ lý CEO, Quản lý dự án, Nghiên cứu, Lập trình, Nội dung, Kiểm duyệt) dùng chung một AI. Có thể đổi AI và model cho từng người sau.',
  'Add an executable provider first (Settings → Providers).': 'Hãy thêm một AI có thể chạy việc trước (Cài đặt → Providers).',
  'Default team created': 'Đã tạo đội mặc định',
  'The agent and its private memory are deleted. Its unfinished tasks go back to the queue.': 'Nhân viên và bộ nhớ riêng sẽ bị xoá. Task chưa xong sẽ quay lại hàng đợi.',
  'New agent': 'Nhân viên mới',
  'Create agent': 'Tạo nhân viên',
  'Agent updated': 'Đã cập nhật nhân viên',
  'Agent created': 'Đã tạo nhân viên',
  Specialties: 'Chuyên môn',
  'Personal system prompt (added to the role prompt)': 'Chỉ dẫn riêng (thêm vào chỉ dẫn của vai trò)',
  'Office department (optional override)': 'Phòng ban trong văn phòng (tuỳ chọn)',
  'role default': 'theo vai trò',
  Enabled: 'Bật',
  Disabled: 'Tắt',
  Permissions: 'Quyền hạn',
  'Knowledge access': 'Truy cập tri thức',
  'File access': 'Truy cập file',
  'project files only': 'chỉ file của dự án',
  'all files': 'tất cả file',
  'May request help from other agents': 'Được nhờ nhân viên khác giúp',
  'May message other agents': 'Được nhắn tin cho nhân viên khác',
  'Write / edit files in workspace': 'Ghi / sửa file trong thư mục làm việc',
  'Execute shell commands': 'Chạy lệnh hệ thống',
  'Network / web tools': 'Truy cập mạng / web',
  'Sensitive actions (deleting data, sending information out, transactions) always require your approval.':
    'Các hành động nhạy cảm (xoá dữ liệu, gửi thông tin ra ngoài, giao dịch) luôn cần bạn phê duyệt.',
  'Resource limits': 'Giới hạn tài nguyên',
  'Concurrent tasks': 'Task cùng lúc',
  'Max output tokens': 'Token đầu ra tối đa',
  'Timeout (min)': 'Thời gian tối đa (phút)',
  'Daily token budget': 'Ngân sách token/ngày',
  'Recent tasks': 'Task gần đây',
  'Agent memory': 'Bộ nhớ nhân viên',
  'Assign task': 'Giao việc',
  'Stop agent': 'Dừng nhân viên',
  'Agent stopped': 'Đã dừng nhân viên',
  'Running work is aborted and returned to the queue; the agent is paused.': 'Việc đang chạy bị dừng và trả lại hàng đợi; nhân viên được tạm dừng.',
  'This agent has not stored any memories yet. Agents save durable facts through the collaboration protocol.': 'Nhân viên này chưa lưu ghi nhớ nào.',
  'Roles define default behaviour, department and visible activity. Create custom roles in Settings.': 'Vai trò quyết định cách làm việc, phòng ban và hoạt động hiển thị. Tạo vai trò riêng trong Cài đặt.',

  'AI & model': 'AI & model',
  'Default (recommended)': 'Mặc định (khuyên dùng)',
  'provider default': 'mặc định',
  'Web access (search the internet, open pages and YouTube links)': 'Truy cập web (tìm kiếm Internet, mở trang web và link YouTube)',
  'Refresh usage': 'Cập nhật mức dùng',
  'Reset – refresh to update': 'Đã reset – bấm cập nhật',
  'Only real numbers: plan limits come from the Claude / Antigravity tools themselves.': 'Chỉ số liệu thật: hạn mức gói lấy trực tiếp từ công cụ của Claude / Antigravity.',
  'No usage reading yet – press refresh.': 'Chưa có số liệu – bấm cập nhật.',
  'Reads the limits with one tiny request (a few tokens).': 'Đọc hạn mức bằng một yêu cầu rất nhỏ (vài token).',
  'Reads the limits for free (no tokens).': 'Đọc hạn mức miễn phí (không tốn token).',
  'Raw text': 'Văn bản gốc',
  Formatted: 'Định dạng',
  'Your answer… (you can paste a screenshot or drop files here)': 'Câu trả lời… (có thể dán ảnh chụp màn hình hoặc kéo thả tệp vào đây)',
  'Ctrl+V to paste an image': 'Ctrl+V để dán ảnh',
  'Attach images or files': 'Đính kèm ảnh hoặc tệp',
  'Remove file': 'Bỏ tệp',
  '(cannot be shown)': '(không hiển thị được)',
  'Switch account': 'Đổi tài khoản',
  'Retry now': 'Thử lại ngay',
  'An Antigravity window opened. Type /logout, press Enter, then /login and sign in with the new account. Then press Retry now.': 'Cửa sổ Antigravity đã mở. Gõ /logout, Enter, rồi gõ /login và đăng nhập tài khoản mới. Xong thì bấm Thử lại ngay.',
  'A Claude sign-in window opened. Finish signing in in your browser, then choose Claude again.': 'Cửa sổ đăng nhập Claude đã mở. Đăng nhập trên trình duyệt xong thì chọn lại Claude.',
  'Loading models…': 'Đang tải danh sách model…',
  'Switch whole team to…': 'Đổi AI cho cả đội…',
  'Switch the whole team to another AI': 'Đổi AI cho cả đội',
  Switch: 'Đổi',
  'Something went wrong on this screen': 'Màn hình này gặp lỗi',
  'Try again': 'Thử lại',
  'Reload page': 'Tải lại trang',
  'No task in progress.': 'Không có task đang làm.',
  Now: 'Hiện tại',
  Memory: 'Ghi nhớ',
  Pause: 'Tạm dừng',

  // ---- tasks
  'Task Management': 'Quản lý công việc',
  'Every task created by the orchestrator, by agents (help requests) or by you. Progress comes from real execution steps.':
    'Mọi task do hệ thống, nhân viên (nhờ giúp đỡ) hoặc bạn tạo ra. Tiến độ lấy từ các bước thực thi thật.',
  Kanban: 'Kanban',
  List: 'Danh sách',
  Timeline: 'Timeline',
  Gantt: 'Gantt',
  'All missions': 'Tất cả yêu cầu',
  'All agents': 'Tất cả nhân viên',
  'No tasks': 'Không có task',
  'No tasks yet.': 'Chưa có task.',
  'Tasks appear here as soon as a mission is planned.': 'Task sẽ hiện ở đây ngay khi một yêu cầu được lập kế hoạch.',
  'Execution steps (reported by the runtime)': 'Các bước thực thi (ghi nhận thật)',
  'Live output': 'Kết quả đang chạy',
  'Error log': 'Nhật ký lỗi',
  'Depends on': 'Phụ thuộc',
  Attempts: 'Số lần thử',
  'Messages about this task': 'Tin nhắn về task này',
  'Help requested from other agents': 'Đã nhờ nhân viên khác giúp',
  'The agent asked you a question': 'Nhân viên hỏi bạn một câu',
  'Your answer…': 'Câu trả lời của bạn…',
  'Answer sent – task resumed': 'Đã gửi câu trả lời – task tiếp tục',
  'Cancel task?': 'Huỷ task này?',
  'Task cancelled': 'Đã huỷ task',
  'Task re-queued': 'Đã đưa task vào hàng đợi lại',
  'Task reassigned': 'Đã giao task cho người khác',
  'Reassign to…': 'Giao lại cho…',
  'Save to project knowledge': 'Lưu vào tri thức dự án',
  'Saved to knowledge base': 'Đã lưu vào kho tri thức',

  // ---- communication
  'Communication Center': 'Trung tâm trao đổi',
  'Talk to your CEO Assistant, answer agent questions, approve sensitive actions and observe every agent-to-agent message.':
    'Trò chuyện với trợ lý, trả lời câu hỏi của nhân viên, phê duyệt hành động nhạy cảm và xem mọi tin nhắn giữa các nhân viên.',
  'Global chat': 'Chat chung',
  'Agent channel': 'Kênh nhân viên',
  'Say hello to your CEO Assistant': 'Chào trợ lý của bạn',
  'Message your CEO Assistant…': 'Nhắn cho trợ lý…',
  'Pending approvals': 'Chờ phê duyệt',
  'No approvals pending.': 'Không có gì chờ phê duyệt.',
  'Questions waiting for you': 'Câu hỏi đang chờ bạn',
  'No agent is waiting for an answer.': 'Không có nhân viên nào đang chờ trả lời.',
  'Agent-to-agent communication': 'Trao đổi giữa các nhân viên',
  'All kinds': 'Tất cả loại',
  'No agent messages yet': 'Chưa có tin nhắn giữa nhân viên',
  'Agents share results, request help, report errors and message each other while working.': 'Nhân viên chia sẻ kết quả, nhờ giúp, báo lỗi và nhắn tin cho nhau khi làm việc.',
  'Your agents at work. Characters move and animate from their real runtime state – click one to inspect, pause, stop or assign work.':
    'Đội của bạn đang làm việc. Nhân vật cử động theo trạng thái thật – bấm vào một người để xem, tạm dừng, dừng hoặc giao việc.',
  'Management dashboard': 'Bảng điều khiển',
  'The office is empty': 'Văn phòng đang trống',
  'Server-room LEDs blink with the real number of running tasks. Dashed gold lines = live agent-to-agent messages.':
    'Đèn phòng server nhấp nháy theo số task đang chạy thật. Đường nét đứt vàng = tin nhắn thật giữa các nhân viên.',

  // ---- usage
  'Usage & Subscription': 'Mức sử dụng & gói đăng ký',
  'Measured usage, provider-reported cost, official billing data and subscription quotas – every number shows where it comes from.':
    'Mức dùng đo thật, chi phí do nhà cung cấp báo, dữ liệu billing chính thức và hạn mức gói – mỗi con số đều ghi rõ nguồn.',
  'API billing ≠ subscription limits.': 'Tính tiền API ≠ hạn mức gói đăng ký.',
  'Active alerts': 'Cảnh báo đang có',
  'Token usage over time': 'Token theo thời gian',
  'By provider': 'Theo AI',
  'By agent': 'Theo nhân viên',
  'By agent (30 days)': 'Theo nhân viên (30 ngày)',
  'By model': 'Theo model',
  'Requests (30d)': 'Yêu cầu (30 ngày)',
  'Input tokens': 'Token đầu vào',
  'Output tokens': 'Token đầu ra',
  'Cost reported': 'Chi phí được báo',
  'Cost estimated': 'Chi phí ước tính',
  'No usage recorded yet': 'Chưa có dữ liệu sử dụng',
  'No agent usage yet.': 'Chưa có dữ liệu theo nhân viên.',
  'Quotas & limits': 'Hạn mức & giới hạn',
  'Manual entry': 'Nhập thủ công',
  'Sync billing': 'Đồng bộ billing',
  'Billing data synced': 'Đã đồng bộ billing',
  'Quota entry saved': 'Đã lưu hạn mức',
  'Entry deleted': 'Đã xoá mục',
  'Delete quota entry?': 'Xoá mục hạn mức này?',
  'Resets at': 'Đặt lại lúc',
  Confidence: 'Độ tin cậy',
  Limit: 'Giới hạn',
  Unit: 'Đơn vị',
  Label: 'Nhãn',
  Note: 'Ghi chú',
  'Leave empty if unknown': 'Để trống nếu không biết',
  '5-hour session limit': 'Giới hạn phiên 5 giờ',
  '5-hour limit': 'Giới hạn 5 giờ',
  'Weekly · all models': 'Hàng tuần · mọi model',
  'Weekly · Opus': 'Hàng tuần · Opus',
  'Weekly · Sonnet': 'Hàng tuần · Sonnet',
  'Weekly limit': 'Giới hạn tuần',
  'Weekly limit (top model)': 'Giới hạn tuần (model cao nhất)',
  'Daily messages': 'Tin nhắn mỗi ngày',
  'Monthly credits': 'Credit hàng tháng',
  'Monthly API budget': 'Ngân sách API hàng tháng',
  'No provider accounts': 'Chưa có tài khoản AI',
  'Alert dismissed': 'Đã bỏ qua cảnh báo',

  // ---- projects / files
  'New project': 'Dự án mới',
  'Project saved': 'Đã lưu dự án',
  'Project deleted': 'Đã xoá dự án',
  'Delete project': 'Xoá dự án',
  'Shared workspace': 'Thư mục làm việc chung',
  'Empty workspace': 'Thư mục trống',
  'Knowledge base': 'Kho tri thức',
  'No knowledge yet': 'Chưa có tri thức',
  'Knowledge saved': 'Đã lưu tri thức',
  'File Manager': 'Quản lý tệp',
  'No files': 'Chưa có tệp',
  'No files in this project': 'Dự án chưa có tệp',
  'Drop files here or': 'Kéo thả file vào đây hoặc',
  'Upload to': 'Tải lên',
  Uploaded: 'Đã tải lên',
  'Delete file?': 'Xoá tệp này?',
  'File deleted': 'Đã xoá tệp',
  'Extracted content': 'Nội dung trích xuất',
  'Re-process': 'Xử lý lại',
  'Re-processed': 'Đã xử lý lại',
  'All projects': 'Tất cả dự án',
  'All scopes': 'Mọi phạm vi',
  Global: 'Chung',
  Scope: 'Phạm vi',

  // ---- settings
  'Settings & Integrations': 'Cài đặt & kết nối',
  'Providers, roles, orchestration, media processing, pricing and security.': 'AI, vai trò, điều phối, xử lý media, bảng giá và bảo mật.',
  Providers: 'Kết nối AI',
  Roles: 'Vai trò',
  Orchestration: 'Điều phối',
  Media: 'Media',
  Pricing: 'Bảng giá',
  'Security & backup': 'Bảo mật & sao lưu',
  'Connected providers': 'AI đã kết nối',
  'Quick connect': 'Kết nối nhanh',
  'Add provider (advanced)': 'Thêm AI (nâng cao)',
  'No providers yet': 'Chưa có AI nào',
  'Provider removed': 'Đã gỡ AI',
  'Choose an integration': 'Chọn cách kết nối',
  'Remove stored credential': 'Xoá thông tin đăng nhập đã lưu',
  'Max concurrent requests': 'Số yêu cầu cùng lúc tối đa',
  'Account label': 'Tên tài khoản',
  'New role': 'Vai trò mới',
  'Role saved': 'Đã lưu vai trò',
  'Role deleted': 'Đã xoá vai trò',
  'Change password': 'Đổi mật khẩu',
  'Current password': 'Mật khẩu hiện tại',
  'New password (min 8)': 'Mật khẩu mới (tối thiểu 8)',
  'Password changed – please sign in again': 'Đã đổi mật khẩu – hãy đăng nhập lại',
  'Create backup': 'Tạo bản sao lưu',
  'Backup created': 'Đã tạo bản sao lưu',
  Backups: 'Bản sao lưu',
  'No backups yet.': 'Chưa có bản sao lưu.',
  'Audit log': 'Nhật ký thao tác',
  'Security status': 'Tình trạng bảo mật',
  'Runtime & queue': 'Vận hành & hàng đợi',
  'Usage monitoring': 'Theo dõi mức dùng',
  'Max concurrent tasks (global)': 'Số task cùng lúc tối đa (toàn hệ thống)',
  'Attempts per task': 'Số lần thử mỗi task',
  'Warning threshold (%)': 'Ngưỡng cảnh báo (%)',
  'Critical threshold (%)': 'Ngưỡng nghiêm trọng (%)',
  'Reset pricing?': 'Đặt lại bảng giá?',
  Reset: 'Đặt lại',
  'Loading older messages…': 'Đang tải tin nhắn cũ…',
  'No older messages': 'Không còn tin nhắn cũ hơn',
  'Failed – the project manager is reviewing a backup plan': 'Bị lỗi – quản lý dự án đang tìm phương án dự phòng',
  'project manager is reviewing the failure': 'quản lý dự án đang xử lý lỗi',
  'another available agent': 'một nhân viên khác đang rảnh',
};

/** Dynamic strings: [pattern, replacement]. Applied to whole (trimmed) text nodes. */
const PATTERNS: [RegExp, string][] = [
  [/^Handed over to (.+) by (.+)$/, '$2 đã giao lại cho $1'],
  [/^Backup approach by (.+) – assigned to (.+)$/, '$1 đổi sang phương án dự phòng – giao cho $2'],
  [/^Skipped with a workaround by (.+)$/, '$1 bỏ qua bước này và dùng cách khác'],
  [/^(.+) skipped "(.+)" with a workaround$/, '$1 bỏ qua "$2" và dùng cách khác'],
  [/^(.+) (handed|reworked) "(.+)" → (.+)$/, '$1 xử lý lỗi "$3" → giao cho $4'],
  [/^Resets (.+)$/, 'Reset lúc $1'],
  [/^Updated (.+)$/, 'Cập nhật $1'],
  [/^(.+) · 5-hour limit$/, '$1 · Giới hạn 5 giờ'],
  [/^(.+) · Weekly limit$/, '$1 · Giới hạn tuần'],
  [/^Out of quota – reopens (.+)\. Meanwhile the office uses another connected AI\.$/, 'Hết hạn mức – mở lại lúc $1. Trong lúc chờ, văn phòng dùng AI khác đã kết nối.'],
  [/^(.+) is available again\.$/, '$1 đã dùng lại được.'],
  [/^Still not available: (.+)$/, 'Vẫn chưa dùng được: $1'],
  [/^Open a terminal, run "(.+)", type \/logout then \/login\. Then press Retry now\.$/, 'Mở terminal, chạy "$1", gõ /logout rồi /login. Sau đó bấm Thử lại ngay.'],
  [/^(.+) is out of quota( \(rate limit\))? – resets in (.+?)( \(estimated\))?\. Work for (.+) and other employees on (.+) continues on (.+) until then\.$/, '$1 đã hết hạn mức$2 – mở lại sau $3$4. Việc của $5 và các nhân viên khác dùng $6 sẽ tạm chạy trên $7 cho tới lúc đó.'],
  [/^(.+) is out of quota( \(rate limit\))? – resets in (.+?)( \(estimated\))?\. No other AI is available to take over "(.+)"\. .+$/, '$1 đã hết hạn mức$2 – mở lại sau $3$4. Không có AI nào khác để làm tiếp "$5". Hãy kết nối thêm AI hoặc đổi AI cho nhân viên (Thêm → Nhân viên → Đổi AI cho cả đội), rồi bấm Thử lại ở task.'],
  [/^(.+) is out of quota( \(rate limit\))? – resets in (.+?)( \(estimated\))?$/, '$1 đã hết hạn mức$2 – mở lại sau $3$4'],
  [/^(.+) is out of quota – switching to (.+)$/, '$1 hết hạn mức – chuyển sang $2'],
  [/^(.+) is out of quota – using (.+)$/, '$1 hết hạn mức – dùng $2'],
  [/^(.+) received your answer and is continuing "(.+)" \((.+)\)\. You will see the result here when it is done\.$/, '$1 đã nhận câu trả lời và đang làm tiếp "$2" ($3). Kết quả sẽ hiện ở đây khi xong.'],
  [/^(.+) received your answer and is continuing "(.+)"\. You will see the result here when it is done\.$/, '$1 đã nhận câu trả lời và đang làm tiếp "$2". Kết quả sẽ hiện ở đây khi xong.'],
  [/^(.+) received your answer for "(.+)" and is still waiting for: (.+)\.$/, '$1 đã nhận câu trả lời cho "$2" và vẫn đang chờ: $3.'],
  [/^(.+) – not connected yet, choose to connect$/, '$1 – chưa kết nối, chọn để kết nối'],
  [/^(.+) – sign in to connect$/, '$1 – cần đăng nhập để kết nối'],
  [/^(.+) now uses the selected AI$/, '$1 đã chuyển sang AI mới'],
  [/^Switch the whole team to (.+)\?$/, 'Đổi cả đội sang $1?'],
  [/^(\d+) employee\(s\) will use (.+) with its default model for new work\. Work already running is not interrupted\.$/, '$1 nhân viên sẽ dùng $2 (model mặc định) cho việc mới. Việc đang chạy không bị ngắt.'],
  [/^(\d+) employee\(s\) now use (.+)$/, '$1 nhân viên đã chuyển sang $2'],
  [/^Everyone already uses (.+)$/, 'Cả đội đã dùng $1'],
  [/^Memory \((\d+)\)$/, 'Ghi nhớ ($1)'],
  [/^Stop (.+)\?$/, 'Dừng $1?'],
  [/^Not available: (.+)$/, 'Không khả dụng: $1'],
  [/^Give (.+) a task directly – it skips planning and goes straight to this agent\.$/, 'Giao việc trực tiếp cho $1 – bỏ qua bước lập kế hoạch.'],
  [/^Task for (.+)…$/, 'Việc cho $1…'],
  [/^Something went wrong.*Details: (.+)$/, 'Lỗi: $1'],
  [/^Run this in a terminal to sign in: (.+)$/, 'Chạy lệnh này trong terminal để đăng nhập: $1'],
  [/^Paste your (.+) API key \((.+)\)\. Get one at:$/, 'Dán API key $1 ($2). Lấy key tại:'],
  [/^(\d+) working · (\d+) idle · click a person for details$/, '$1 đang làm · $2 rảnh · bấm vào một người để xem chi tiết'],
  [/^· (\d+)\/(\d+) agents working · (\d+) running tasks$/, '· $1/$2 nhân viên đang làm · $3 task đang chạy'],
  [/^Requests \((\d+)\)$/, 'Yêu cầu ($1)'],
  [/^In progress \((\d+)\)$/, 'Đang làm ($1)'],
  [/^Done \((\d+)\)$/, 'Xong ($1)'],
  [/^Failed \((\d+)\)$/, 'Lỗi ($1)'],
  [/^(\d+) tok today$/, '$1 token hôm nay'],
  [/^([\d.,]+[kKmM]?) tok today$/, '$1 token hôm nay'],
  [/^(\d+)s ago$/, '$1 giây trước'],
  [/^(\d+)m ago$/, '$1 phút trước'],
  [/^(\d+)h ago$/, '$1 giờ trước'],
  [/^(\d+)d ago$/, '$1 ngày trước'],
  [/^(\d+) model\(s\) available$/, 'Có $1 model'],
  [/^(.+) joined the office$/, '$1 đã vào văn phòng'],
  [/^(.+) has a question$/, '$1 có câu hỏi'],
  [/^Connected (.+) and hired a team of 6 AI employees\.$/, 'Đã kết nối $1 và tuyển đội 6 nhân viên AI.'],
  [/^Hired a team of 6 AI employees using (.+)\.$/, 'Đã tuyển đội 6 nhân viên AI dùng $1.'],
  [/^Connected (.+)\.$/, 'Đã kết nối $1.'],
  [/^Connected, but the test failed: (.+)$/, 'Đã kết nối nhưng kiểm tra thất bại: $1'],
  [/^Emergency stop: (\d+) running task\(s\) interrupted$/, 'Dừng khẩn cấp: đã ngắt $1 task đang chạy'],
  [/^Delete (.+)\?$/, 'Xoá $1?'],
  [/^(.+) removed$/, 'Đã gỡ $1'],
  [/^(.+) paused$/, 'Đã tạm dừng $1'],
  [/^(.+) resumed$/, 'Đã tiếp tục $1'],
  [/^(\d+) tokens today · (.+)$/, '$1 token hôm nay · $2'],
  [/^active (.+)$/, 'hoạt động $1'],
  // server activity / status messages
  [/^(.+) completed "(.+)"$/, '$1 đã hoàn thành "$2"'],
  [/^(.+) started "(.+)" \(attempt (\d+)\)$/, '$1 bắt đầu "$2" (lần thử $3)'],
  [/^(.+) started "(.+)"$/, '$1 bắt đầu "$2"'],
  [/^(.+) failed "(.+)": (.+)$/, '$1 làm "$2" bị lỗi: $3'],
  [/^"(.+)" failed: (.+)$/, '"$1" lỗi: $2'],
  [/^"(.+)" is waiting for (.+)$/, '"$1" đang chờ $2'],
  [/^(.+) joined the office as (.+)$/, '$1 gia nhập văn phòng với vai trò $2'],
  [/^(.+) paused \(finishes current work, takes no new tasks\)$/, '$1 tạm dừng (làm nốt việc đang làm, không nhận việc mới)'],
  [/^(.+) was removed from the office$/, '$1 đã rời văn phòng'],
  [/^(.+) requested help \((\d+)\) for "(.+)"$/, '$1 nhờ giúp đỡ ($2) cho "$3"'],
  [/^(.+) stopped by manager$/, '$1 bị quản lý dừng'],
  [/^(.+) is planning "(.+)"$/, '$1 đang lập kế hoạch "$2"'],
  [/^Plan with (\d+) task\(s\) for "(.+)"$/, 'Kế hoạch $1 task cho "$2"'],
  [/^Planning failed for "(.+)": (.+)$/, 'Lập kế hoạch thất bại cho "$1": $2'],
  [/^New mission: (.+)$/, 'Yêu cầu mới: $1'],
  [/^Mission "(.+)" completed$/, 'Yêu cầu "$1" đã hoàn thành'],
  [/^Mission "(.+)" cancelled$/, 'Yêu cầu "$1" đã huỷ'],
  [/^Mission "(.+)" finished with (\d+) failed task\(s\)$/, 'Yêu cầu "$1" kết thúc với $2 task lỗi'],
  [/^Default team of (\d+) agents created on (.+)$/, 'Đã tạo đội $1 nhân viên dùng $2'],
  [/^Provider "(.+)" added$/, 'Đã thêm AI "$1"'],
  [/^Manager retried "(.+)"$/, 'Quản lý cho chạy lại "$1"'],
  [/^"(.+)" cancelled by manager$/, '"$1" bị quản lý huỷ'],
  [/^"(.+)" reassigned to (.+)$/, '"$1" được giao lại cho $2'],
  [/^Manager assigned "(.+)" directly to (.+)$/, 'Quản lý giao "$1" trực tiếp cho $2'],
  [/^(.+) launched mission "(.+)" from chat$/, '$1 tạo yêu cầu "$2" từ chat'],
  [/^Queue resumed by (.+)$/, '$1 đã tiếp tục hàng đợi'],
  [/^CLI available – (\d+) models$/, 'CLI sẵn sàng – $1 model'],
  [/^Connected – (\d+) models available$/, 'Đã kết nối – có $1 model'],
  [/^Cannot connect: (.+)$/, 'Không kết nối được: $1'],
  [/^Claude Code (.+) – signed in \((.+)\)$/, 'Claude Code $1 – đã đăng nhập ($2)'],
  [/^Claude Code (.+) found, but it is not signed in\. Press "Sign in to Claude" and finish signing in in the browser\.$/, 'Đã có Claude Code $1 nhưng chưa đăng nhập. Bấm "Đăng nhập Claude" và hoàn tất trên trình duyệt.'],
  [/^Claude is not signed in on this computer – .+$/, 'Claude chưa đăng nhập trên máy này – bấm "Đăng nhập Claude" (thiết lập trên bảng điều khiển hoặc Cài đặt → Kết nối AI), rồi thử lại.'],
  [/^Claude Code is not installed on this computer\.$/, 'Máy này chưa cài Claude Code.'],
  [/^Empty response from provider$/, 'AI trả về kết quả rỗng'],
];

const AGO: Record<string, string> = { s: 'giây', m: 'phút', h: 'giờ', d: 'ngày' };
const SKIP_TAGS = new Set(['INPUT', 'TEXTAREA', 'PRE', 'CODE', 'SCRIPT', 'STYLE', 'CANVAS', 'KBD']);
const ATTRS = ['placeholder', 'title', 'aria-label'];

export function translateText(raw: string): string | null {
  const text = raw.replace(/\s+/g, ' ').trim();
  if (!text || !/[A-Za-z]/.test(text)) return null;
  const hit = VI[text];
  if (hit !== undefined) return raw.replace(raw.trim(), hit);
  for (const [re, rep] of PATTERNS) {
    if (re.test(text)) {
      const out = text
        .replace(re, rep)
        .replace(/(\d+) days\b/g, '$1 ngày')
        .replace(/(\d+) h\b/g, '$1 giờ')
        .replace(/(\d+) min\b/g, '$1 phút')
        .replace(/ \(estimated\)/g, ' (ước tính)')
        .replace(/ \(rate limit\)/g, ' (giới hạn tốc độ)')
        .replace(/\bjust now\b/g, 'vừa xong')
        .replace(/\b(\d+)(s|m|h|d) ago\b/g, (_, n, u) => `${n} ${AGO[u]} trước`);
      return raw.replace(raw.trim(), out);
    }
  }
  return null;
}

function skipped(el: Element | null): boolean {
  for (let e = el; e; e = e.parentElement) {
    if (SKIP_TAGS.has(e.tagName)) return true;
    if (e.getAttribute('translate') === 'no') return true;
  }
  return false;
}

function translateNode(node: Node) {
  if (node.nodeType === Node.TEXT_NODE) {
    const parent = node.parentElement;
    if (!parent || skipped(parent)) return;
    const out = translateText(node.nodeValue ?? '');
    if (out !== null && out !== node.nodeValue) node.nodeValue = out;
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  const el = node as Element;
  if (el.getAttribute('translate') === 'no') return;
  for (const a of ATTRS) {
    const v = el.getAttribute(a);
    if (v) {
      const out = translateText(v);
      if (out !== null && out !== v) el.setAttribute(a, out);
    }
  }
  if (SKIP_TAGS.has(el.tagName)) return;
  for (const c of Array.from(el.childNodes)) translateNode(c);
}

/** Start translating the document (no-op in English). */
export function startTranslator(lang: Lang) {
  document.documentElement.lang = lang;
  if (lang !== 'vi') return;
  translateNode(document.body);
  const obs = new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === 'characterData') translateNode(m.target);
      else if (m.type === 'attributes') translateNode(m.target);
      else m.addedNodes.forEach((n) => translateNode(n));
    }
  });
  obs.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
}
