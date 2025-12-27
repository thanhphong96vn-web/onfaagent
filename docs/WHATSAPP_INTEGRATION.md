# Hướng dẫn tích hợp WhatsApp Business API

Dự án OnfaAgent hiện đã hỗ trợ tích hợp WhatsApp Business API để bạn có thể sử dụng chatbot trên WhatsApp!

## Tính năng

- ✅ Tích hợp WhatsApp Business API
- ✅ Tự động trả lời tin nhắn dựa trên FAQs và knowledge base
- ✅ Hỗ trợ webhook để nhận messages
- ✅ Queue system để xử lý messages nhanh chóng
- ✅ Lưu lịch sử chat và analytics
- ✅ Quản lý bot qua Dashboard

## Yêu cầu

1. **WhatsApp Business Account** - Tài khoản WhatsApp Business
2. **Meta Business Suite** - Quản lý WhatsApp Business API
3. **Access Token** - Token từ Meta Developer Console
4. **Phone Number ID** - ID số điện thoại WhatsApp Business

## Cách thiết lập

### Bước 1: Tạo WhatsApp Business API App

1. Vào [Meta for Developers](https://developers.facebook.com/)
2. Tạo một App mới → Chọn **"Business"** type
3. Thêm **WhatsApp** product vào app
4. Lấy **Access Token** từ App Dashboard
5. Lấy **Phone Number ID** từ WhatsApp → API Setup

### Bước 2: Cấu hình Bot trong Dashboard

1. Đăng nhập vào Dashboard của bạn
2. Chọn bot mà bạn muốn tích hợp WhatsApp
3. Vào tab **"WhatsApp Settings"**
4. Nhập các thông tin:
   - **Access Token**: Token từ Meta Developer Console
   - **Phone Number ID**: ID số điện thoại WhatsApp Business
   - **Verify Token**: Token để verify webhook (tùy chọn, hệ thống sẽ tự tạo)
5. Nhấn **"Lấy thông tin số điện thoại"** để xác minh
6. Sau khi xác minh thành công, nhấn **"Kích hoạt WhatsApp Bot"**

### Bước 3: Cấu hình Webhook trong Meta Business Suite

1. Vào **Meta Business Suite** → **WhatsApp** → **Configuration**
2. Vào tab **Webhooks**
3. Click **"Edit"** hoặc **"Add"**
4. Nhập:
   - **Webhook URL**: `https://yourdomain.com/api/whatsapp/webhook?botId=YOUR_BOT_ID`
   - **Verify Token**: Token từ Dashboard (hoặc token được tạo tự động)
5. Subscribe to **"messages"** events
6. Click **"Verify and Save"**

### Bước 4: Kiểm tra hoạt động

1. Gửi message đến số WhatsApp Business của bạn
2. Bot sẽ tự động trả lời dựa trên FAQs và knowledge base!

## Cách hoạt động

### Webhook

Khi bạn kích hoạt WhatsApp bot, hệ thống sẽ:
1. Lưu cấu hình vào database
2. Webhook URL sẽ là: `https://yourdomain.com/api/whatsapp/webhook?botId=YOUR_BOT_ID`
3. WhatsApp sẽ gửi tất cả tin nhắn đến webhook này
4. Hệ thống sẽ xử lý và trả lời tự động

### Xử lý tin nhắn

- Bot sẽ trả lời tất cả tin nhắn text
- Hỗ trợ welcome message khi user gửi "hi", "hello", "/start"
- Sử dụng cùng knowledge base như website chatbot

### Knowledge Base

Bot sẽ sử dụng cùng knowledge base như website chatbot:
- FAQs
- Documents (PDF, DOCX, TXT)
- URLs (scraped content)
- Structured Data

## API Endpoints

### Set Webhook
```
POST /api/whatsapp/set-webhook
Body: { 
  botId: string, 
  accessToken: string,
  phoneNumberId: string,
  verifyToken?: string,
  webhookUrl?: string
}
```

### Delete Webhook
```
POST /api/whatsapp/delete-webhook
Body: { botId: string }
```

### Get Phone Number Info
```
POST /api/whatsapp/phone-info
Body: { accessToken: string, phoneNumberId: string }
```

### Webhook (WhatsApp calls this)
```
GET /api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=TOKEN&hub.challenge=CHALLENGE
POST /api/whatsapp/webhook?botId=YOUR_BOT_ID
```

## Troubleshooting

### Bot không trả lời

1. Kiểm tra xem bot đã được kích hoạt trong Dashboard chưa
2. Kiểm tra webhook URL có đúng không trong Meta Business Suite
3. Kiểm tra Access Token và Phone Number ID có đúng không
4. Xem logs trong server để tìm lỗi

### Webhook verification failed

- Đảm bảo Verify Token trong Dashboard khớp với Meta Business Suite
- Kiểm tra webhook URL có accessible từ internet không

### Access Token không hợp lệ

- Đảm bảo token chưa hết hạn
- Kiểm tra token có đúng permissions không (whatsapp_business_messaging)

## Lưu ý bảo mật

- Access Token được lưu trữ an toàn trong database
- Verify Token được dùng để verify webhook requests
- Webhook URL nên sử dụng HTTPS

## Chi phí

WhatsApp Business API có pricing riêng:
- **Conversation-based pricing**: Trả phí theo số lượng conversations
- **Free tier**: Có thể có giới hạn messages miễn phí
- Xem chi tiết tại [WhatsApp Business API Pricing](https://developers.facebook.com/docs/whatsapp/pricing)

## So sánh với Telegram

| Tính năng | Telegram | WhatsApp |
|---|---|---|
| **Setup** | Dễ (chỉ cần Bot Token) | Phức tạp hơn (cần Meta Business Account) |
| **Cost** | Miễn phí | Có phí (conversation-based) |
| **Webhook** | Tự động setup | Cần config trong Meta Business Suite |
| **Rate Limits** | Cao | Có giới hạn |
| **User Base** | Lớn | Rất lớn (phổ biến hơn) |

