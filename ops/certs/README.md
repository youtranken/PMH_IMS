# ops/certs — chứng chỉ TLS

`web` (nginx) là nơi DUY NHẤT giữ cert (NFR-04). Cần 2 file:

- `fullchain.pem` — chứng chỉ + chuỗi trung gian
- `privkey.pem` — khóa riêng

**Production:** copy cert wildcard `*.pmh.com.vn` đang dùng cho QLTS sang đây (cùng CA, cùng hạn).
**Dev:** file tự ký sinh sẵn bằng lệnh dưới; trình duyệt sẽ cảnh báo — chấp nhận là vào được.

```bash
openssl req -x509 -newkey rsa:2048 -nodes -days 825 \
  -keyout privkey.pem -out fullchain.pem \
  -subj "/CN=ims.pmh.com.vn" \
  -addext "subjectAltName=DNS:ims.pmh.com.vn,DNS:localhost,IP:127.0.0.1"
```

Hai file `.pem` KHÔNG commit (xem .gitignore).
