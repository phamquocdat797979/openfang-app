## 📖 Giới Thiệu Tổng Quan

**OpenFang** là một hệ điều hành thu nhỏ dành cho AI (Agent OS) dưới dạng Web App trực quan. Hệ thống cho phép bạn tạo ra, quản lý và giao tiếp với nhiều **trợ lý AI chuyên biệt (Agents)** cùng một lúc. 

Khác với việc chỉ chat với một AI chung chung, OpenFang cung cấp cơ sở hạ tầng để bạn "lắp ráp" các kỹ năng (Skills) khác nhau cho từng Agent, biến chúng thành những chuyên gia xử lý tác vụ cụ thể thông qua cơ chế tự động gọi công cụ (Tool Calling / Function Calling).

---

## ✨ Chức Năng Cốt Lõi

OpenFang tập trung vào 4 nhóm tính năng chính, được chia theo các Tab trực quan trên giao diện:

### 1. 🤖 Quản lý Agent & Giao tiếp (Chat / Agents)
- **Tạo Agent dễ dàng:** Khởi tạo các Agent với vai trò, mô tả và gắn kèm mô hình ngôn ngữ lõi (Google Gemini).
- **Hội thoại thông minh:** Giao diện chat thân thiện. Agent có khả năng phân tích câu lệnh và tự động sử dụng **Skills** (ví dụ: người dùng nhập "nhân đôi số 15", Agent tự động gọi skill tính toán và trả về kết quả 30).
- **Sessions:** Quản lý vòng đời và phiên làm việc của từng Agent đang hoạt động.

### 2. 🧩 Hệ Thống Kỹ Năng Mở Rộng (Skills)
- **Skill Engine:** Là trung tâm sức mạnh của OpenFang. Người dùng có thể định nghĩa các kịch bản, Prompt, hoặc logic xử lý cụ thể dưới dạng các "Skills".
- **Trigger thông minh:** Mỗi Skill được gắn với các từ khóa (Triggers). Khi người dùng chat, Agent sẽ tự động đối chiếu ngữ cảnh và kích hoạt Skill tương ứng.
- **Built-in & Custom:** Hệ thống đi kèm các Skill mẫu (ví dụ: Nhân đôi số nguyên, Tóm tắt văn bản, Chuyển đổi in hoa) và cho phép bạn tự định nghĩa vô số Skill mới.

### 3. 🧠 Quản Lý Trí Nhớ (Shared Memory)
- **Lưu vết sự kiện (Audit Log):** Không chỉ nhớ cuộc hội thoại, OpenFang ghi lại quá trình suy nghĩ và hành động của Agent (như: `CHAT_OPENED`, `MESSAGE_SENT`, `SKILL_USED`).
- **Memory Sharing:** Nền tảng cho phép các Agent có khả năng đọc và chia sẻ trí nhớ chung, giúp xử lý các bài toán phối hợp đa tác vụ sau này.

### 4. 📊 Giám Sát Thời Gian Thực (Overview & Logs)
- **Dashboard:** Cung cấp cái nhìn toàn cảnh về tình trạng hoạt động (Uptime, tổng số tin nhắn, số lượng Agent đang chạy).
- **Live Logs:** Ghi nhận mọi giao dịch từ Server (API Calls đến Gemini, kết nối Database, kích hoạt trigger) theo thời gian thực, rất hữu ích cho quá trình Debugging.

---

## 🏗️ Cấu Trúc Hệ Thống (Architecture)

Hệ thống được thiết kế theo hướng **nguyên khối (Monolithic) siêu nhẹ**, không phụ thuộc vào framework Frontend nặng nề, tập trung vào tốc độ và dễ triển khai.

```mermaid
flowchart TD
    User((Người Dùng))

    subgraph Client [Giao diện Frontend (Vanilla JS)]
        UI[Khung Chat & Dashboard]
    end

    subgraph Server [Backend Server (Node.js/Express)]
        Route[API Routes]
        Engine{Skill Engine & Trigger}
        LLM[Gemini Proxy]
    end

    subgraph DB [Database (SQLite)]
        Agents[(Bảng Agents)]
        Skills[(Bảng Skills)]
        Memory[(Lịch sử & Memory)]
    end

    subgraph ThirdParty [External Services]
        GeminiAPI[Google Gemini 2.5 API]
        ExtAPI[Các API mở rộng]
    end

    %% Luồng giao tiếp cơ bản
    User <-->|Tương tác| UI
    UI <-->|HTTP REST| Route
    
    %% Tương tác với DB
    Route <--> Agents
    Route <--> Skills
    Route <--> Memory

    %% Luồng xử lý AI
    Route -->|Gửi câu lệnh| Engine
    Engine -->|Đối chiếu| Skills
    Engine -->|Truyền Prompt + Tools| LLM
    
    %% Gọi API bên ngoài
    LLM <-->|Giao tiếp LLM| GeminiAPI
    GeminiAPI -.->|Function Calling| ExtAPI
    LLM -->|Ghi nhận kết quả| Memory
```
---

## 🚀 Hướng Dẫn Cài Đặt & Khởi Chạy

Dự án yêu cầu **Node.js >= 22.5.0** (hỗ trợ built-in SQLite).

**Bước 1: Clone dự án**
```bash
git clone https://github.com/phamquocdat797979/openfang-app.git
cd openfang-app
```

**Bước 2: Cài đặt thư viện**
```bash
npm install
```

**Bước 3: Cấu hình biến môi trường**
Tạo file `.env` ở thư mục gốc và thêm API Key của Google Gemini:
```env
GEMINI_API_KEY=your_google_gemini_api_key_here
PORT=3456
```
*(Bạn có thể lấy Gemini API Key miễn phí tại [Google AI Studio](https://aistudio.google.com/))*

**Bước 4: Khởi chạy Web App**
```bash
# Chạy ở môi trường phát triển (có auto-restart)
npm run dev
```

**Bước 5: Trải nghiệm**
Mở trình duyệt và truy cập: `http://localhost:3456`
