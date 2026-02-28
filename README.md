# Antigravity Telegram Control Extension

Điều khiển mã nguồn và agent thông qua Telegram Bot.

## Tính năng
- `/start`: Khởi động bot và lấy Chat ID.
- `/screenshot`: Chụp ảnh màn hình Desktop hiện tại và gửi về Telegram.
- `/cmd <lệnh>`: Chạy lệnh shell trực tiếp trong Terminal của VS Code thông qua Telegram.
- Nhận tin nhắn từ Telegram và hiển thị thông báo trong VS Code.

## Cài đặt
1. Tạo một Bot mới qua @BotFather trên Telegram để lấy Bot Token.
2. Mở Cài đặt (Settings) trong VS Code, tìm `Antigravity Telegram Control`.
3. Nhập `Bot Token` của bạn.
4. (Tùy chọn) Nhập `Allowed Chat Id` để chỉ cho phép tài khoản của bạn điều khiển bot. Bạn có thể lấy ID này sau khi gửi tin nhắn `/start` đầu tiên cho bot.
5. Ở Command Palette (F1 hoặc Ctrl+Shift+P), tìm `Telegram: Start Bot`.

## Quyền hạn & Bảo mật
**Cảnh báo:** Extension này có quyền thực thi lệnh shell. Luôn cài đặt `Allowed Chat Id` để tránh bị người lạ điều khiển máy tính của bạn.

---
Phát triển bởi Antigravity Agent.
