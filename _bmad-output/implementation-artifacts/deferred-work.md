# Việc hoãn lại

Sổ này ghi những phát hiện CÓ THẬT nhưng không thuộc phạm vi lượt rà soát sinh ra chúng — phần
lớn là nợ có TRƯỚC thay đổi đang rà. Ghi ở đây để chúng không trôi mất, và để lượt rà sau không
phải tìm lại từ đầu.

## Deferred from: code review of epics.md (2026-09-19)

Nguồn: `/bmad-code-review` trên `04e3c47..HEAD` của nhánh `feat/ui-chi-tiet-v2` (21 commit, 68
file, 5736 dòng diff). Bảy lớp rà soát: blind-hunter · edge-case-hunter · verification-gap ·
acceptance-auditor · ba chuyên gia FE/BE/DB.

### Hàng rào PHÁT HIỆN quanh két — cửa metadata đi qua không vết

- **Lượt TỪ CHỐI ở đường metadata không ghi `audit_log` và không đếm vào bộ dò dẫm.**
  `GET /vault/secrets`, `GET /vault/secrets/verdict` và `VaultDevicePanel.buildFor` đều từ chối
  sạch sẽ rồi im lặng; chỉ đường `reveal` đi qua `watched()`. Nghĩa là `PROBE_ACTIONS` không bao
  giờ nhích cho người quét metadata, ngưỡng 3 lượt/15 phút không chạm, không thư nào đi. Hàng rào
  CHẶN vẫn đứng — hàng rào PHÁT HIỆN mù trọn đường rẻ nhất. Ba lớp rà soát độc lập cùng chỉ ra.
  *Vì sao hoãn:* đường metadata chưa từng được đo đạc, đây là thiếu sót thiết kế có trước nhánh,
  và sửa đúng cách là thêm một `action` mới + đấu vào `PROBE_ACTIONS` — một story riêng.
- **Trần gọi lệch 10 lần giữa hai cửa cùng bày một loại thông tin.** `reveal` có
  `@Throttle({ limit: 30 })`; ba đường metadata ăn trần toàn cục 300/phút (`app.module.ts:77`) và
  còn mang `@NoStepUp()`. Đường rút "bản đồ nhãn ngăn + tên đăng nhập" rẻ hơn đường mở ngăn ở cả
  ba chiều: gấp 10 lần trần, không step-up, không vết.

### AD-11 — tham số vận hành gõ cứng

- **`@Throttle` gõ cứng ở 4 chỗ**: vault 30, auth 10, files 20, toàn cục 300. `login-rate.guard.ts:58`
  đã tự ghi rằng chính lớp lỗi này từng xảy ra ("khoá cấu hình có mà không ai đọc") và được
  chuyển sang `login.rate_limit_per_ip`; đường két thì chưa. Nặng thêm vì con số 30 nay là luận
  cứ an ninh ở ba nơi (chú thích controller, chú thích probe service, hằng trong bài kiểm đua).
- **`SystemConfigService.setWithin()` có 0 nơi gọi** (L-01 trong `docs/NO-KY-THUAT-LOW-2026-09-19.md`).
  Đã hoãn CÓ CHỦ Ý ba lần — xem `docs/EPIC-MAP.md`, bảng nợ của Epic 1 · 3 · 6, hạn chót đặt là
  *"khi anh Thuận muốn tự đổi trần mà không cần tôi"*. Dữ kiện mới: từ migration 0046, công tắc
  tắt của một cơ chế CẢNH BÁO AN NINH cũng nằm sau cánh cửa ấy.

### Dữ liệu lưu lâu

- **`outbox` không có chính sách xoá.** Đo trên DB dev 19/09: **54.536 hàng, 100% đã
  `processed_at`**, tất cả vẫn giữ nguyên `payload` — trong đó hàng `security.probe.alert` mang
  email đầy đủ của người bị nghi dò két. Sau `processed_at` thì payload không còn ai cần, nhưng
  nó đi vào mọi bản `pg_dump` đêm. (`audit_log` 223.640 hàng cũng không có retention, nhưng ở đó
  là CỐ Ý theo AD-13 chỉ-thêm.)
- **`redactMessage` KHÔNG che email/PII.** Nó chỉ dựng lại được lỗi truy vấn drizzle; lỗi khác
  trả `error.message` nguyên văn. Hàm che email là `redactPii`, một hàm KHÁC — `log-redact.ts:110`
  nói rõ hai việc không được gộp, và đường mail/job phải ghép hai lớp.

### Màu sắc — dọn trước, siết cổng sau

- **19 giá trị `rgb()/rgba()` viết tay ngoài `tokens.css`**: `shell.css` 8 · `table.css` 3 ·
  `datepicker.css` 3 · `base.css` 3 · `lightbox.css` 1 · `form-layout.css` 1. Không chỗ nào có
  cặp dark.
- **3 hex mã hoá URL `%238a908a`** trong data-URI SVG (`base.css`, `detail-tabs.css`,
  `shared-kit.css`): mũi tên `<select>`, kính lúp ô tìm, khay rỗng. Chế độ tối giữ nguyên xám
  sáng-mode. Cổng `ops/gate-hex.sh` không thấy vì `%23` chứ không phải `#`.
  *Thứ tự bắt buộc:* dọn 22 chỗ này TRƯỚC, rồi mới nới biểu thức của cổng. Nới trước là cổng đỏ
  ngay — đúng cái bẫy đã làm E2E không chạy suốt 7 story.

### Nuốt lỗi trên đường quyết định quyền

- **`access-list.service.ts:273-281` — bốn `.catch(() => null)`** không một dòng log, trên chính
  đường tính quyền. Hướng hỏng là ĐÓNG nên không phải lỗ hổng; nhưng một nhịp DB chớp biến thành
  "bạn không có quyền" cho cả một nhóm người, không dấu vết nào phân biệt được với việc họ thật
  sự không có quyền.
- **`mail.consumer.ts:207` — cảnh báo an ninh bị bỏ mà dòng nhớ thời gian nghỉ ĐÃ commit.**
  `recipientsByRole(['sa','admin'])` trả rỗng → `return null` → `markProcessed`. Suốt 60 phút sau
  đó `noteFailure` thấy "đã cảnh báo rồi" và im, trong khi chưa ai nhận được gì. Dòng `logger.warn`
  còn nói sai lý do.

### Sổ sách và cổng

- **Thứ tự dọn của `reset-e2e.mjs` đã đổi thật**, không chỉ "thứ tự tham số thôi có nghĩa":
  `devices` từ vị trí 9 lên 2, `approvals` từ 3 xuống 8. Chuyên gia BE dò tay xác nhận không gãy
  khoá ngoại (mỗi khối tự dọn FK trỏ vào nó trước khi xoá hồ sơ cha), và E2E đã xanh 5 lượt.
  Nhưng bài `reset-domains-rollcall` chỉ canh MỘT bất biến (`catalog` cuối) — mọi ràng buộc thứ
  tự khác, nếu có, hiện không ai canh.
- **`vault-surface.spec.ts` khoá CÁCH VIẾT, không khoá hành vi.** `toContain("role !== 'sa'")`
  làm bài đỏ nếu ai đó viết lại hàng rào cho tốt hơn (`!isPrivileged(role)`,
  `!['sa','admin'].includes(role)`) dù bất biến AD-9 được giữ nguyên hoặc chặt hơn. Bài vừa được
  chữa khỏi bệnh "thoả bởi chú thích" thì mắc bệnh "thoả bởi chuỗi ký tự". Chưa có cách sửa sạch
  nào ngoài việc chạy thật handler — cần một `vault.controller.spec.ts` thật.
- **Diff bị pha loãng bởi CRLF/khoảng trắng.** `vault-surface.spec.ts` bị viết lại nguyên file
  (~300 dòng xoá + ~300 thêm) cho một thay đổi vài chục dòng; bốn file khác có hunk chỉ đổi kết
  thúc dòng. Một thay đổi thật giấu trong đó sẽ không ai thấy khi review. Nên chốt bằng
  `.gitattributes` (`* text=auto`, `*.ts text eol=lf`) thay vì sửa tay từng lượt — đây là lần thứ
  hai chuyện này vào commit message.

## Deferred from: code review of RA-SOAT-TOAN-DIEN-2026-09-19 (2026-09-21)

- **`ChangePasswordDto` mang cùng lỗi câu thông báo `@Length`.** `@Length(1, 200, { message: 'Chưa nhập mật khẩu hiện tại.' })` nói sai cho nhánh QUÁ DÀI. Có trước đợt A; bản vá A-02 chỉ chép lại khuôn cũ sang `TotpEnrollStartDto`. Sửa thì sửa cả hai cùng lúc, qua `common/validation-messages.ts`. [api/src/modules/auth/auth.dto.ts:34]
- **`ensureAppRole` có thể đua `CREATE ROLE` (SQLSTATE 42710).** Hai tiến trình boot song song cùng chạy `SELECT 1` rồi `CREATE ROLE`; nó chạy TRƯỚC advisory lock của migration nên lock đó không che. Compose hiện chỉ dựng một `api`, nên chưa nổ — sẽ nổ ở ngày đầu tiên chạy nhiều replica. [api/src/database/app-role.ts:112]
- **`api/test/db.ts` mã hoá URL mật khẩu, `docker-compose.yml` thì không.** Bài kiểm và stack thật dựng ra hai chuỗi kết nối khác nhau nếu mật khẩu chứa `%`, `/` hoặc `#`. `.env.example` đã ràng buộc bộ ký tự nên chưa nổ, nhưng ràng buộc đó là một dòng chú thích chứ không phải một cổng. [api/test/db.ts:85]
