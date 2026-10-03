# Thiết kế chừa chỗ: trạng thái sống trên sơ đồ (FR-049)

Trạng thái: **CHỈ THIẾT KẾ.** Epic 10 không tạo route, bảng hay giao diện nào cho phần này.
`api/src/modules/diagrams/live-status-reserved.spec.ts` quét bề mặt route của cả ứng dụng và đỏ
nếu một route `device-status` lọt vào trước khi có quyết định làm.

Nguồn luật: ARCHITECTURE-SPINE AD-18 (gạch "chừa chỗ trạng thái sống"), Q-23 ("Không giám sát
sống trong Epic 10; chừa sẵn API nhận trạng thái từ máy giám sát ngoài và lớp trạng thái sống").

## 1. Hợp đồng nhận trạng thái

```
POST /api/v1/device-status
Authorization: Bearer <khoá API riêng của máy giám sát>
Content-Type: application/json

{
  "source": "zabbix-pmh",                 // tên nguồn, khớp với khoá API
  "observedAt": "2026-10-03T02:00:00Z",   // giờ máy giám sát thấy, UTC
  "items": [
    { "deviceCode": "SW-LOI-01", "state": "down", "detail": "ICMP timeout 3/3" },
    { "deviceCode": "FW-01",     "state": "up" }
  ]
}

→ 202 { "accepted": 2, "unknown": ["AP-XYZ"] }
```

- **Khoá API riêng, không phải phiên người dùng.** Không cookie, không CSRF, không TOTP. Khoá
  sinh ở màn Quản trị, lưu băm (như mật khẩu), gắn một `source` và danh sách IP được gửi. Khoá này
  CHỈ gọi được đúng route này; mọi route khác trả 401 với nó.
- **Chỉ ghi trạng thái, không đọc gì.** Response không trả dữ liệu kho (không tên, không IP, không
  danh sách máy) ngoài số đã nhận và mã máy không khớp. Máy giám sát bị chiếm cũng không dùng
  được khoá này để dò kho.
- `state` thuộc tập đóng `up | down | degraded | unknown`; `detail` ≤ 200 ký tự, lọc như ghi chú
  (không nhận chuỗi trông như mật khẩu — SEC-21).
- Khớp máy theo `device.code` qua `devices.api` (AD-2). Máy đã thanh lý thì bỏ qua, đếm vào
  `unknown`.
- Giới hạn tần suất theo khoá (tham số `system_config`, AD-11), trần số `items` một lần gửi.
- Ghi theo AD-5: một transaction, một dòng audit `device_status.received` cho mỗi lô (không mỗi
  máy), không outbox (trạng thái không kích hoạt thông báo nào ở bản đầu).

## 2. Nơi lưu

- **Module mới `monitoring`** (tầng nghiệp vụ), KHÔNG phải `diagrams`, KHÔNG phải `devices`.
  `diagrams` là lớp nhìn chỉ đọc (AD-18); `devices` giữ hồ sơ, không giữ tín hiệu sống chập chờn.
- Bảng `device_live_status` (chủ: `monitoring`, AD-3): một hàng mỗi máy — `device_id`,
  `state`, `detail`, `source`, `observed_at`, `received_at`. Ghi đè (UPSERT) theo `device_id`:
  đây là "bây giờ ra sao", không phải lịch sử.
- Lịch sử đổi trạng thái (nếu cần) là bảng chỉ-thêm riêng `device_live_status_history`, theo luật
  bảng lịch sử (trigger `history_append_only` + REVOKE, có trong `app-role-privileges.spec.ts`).
- Trạng thái quá `monitoring.stale_minutes` (tham số) mà không có tin mới thì đọc ra `unknown` —
  máy giám sát chết không được để lại một màu "up" giả.
- `monitoring` xuất `monitoring.api` với một hàm đọc `liveStatusOf(deviceIds)`; `diagrams` gọi hàm
  đó khi trả nội dung bản vẽ. Không module nào import `diagrams` (giữ nguyên AD-18).

## 3. Lớp "trạng thái sống" trong trình xem

- Trình xem dùng chung `web/src/ui/diagram-viewer.tsx` nhận `layers: ViewerLayer[]` — mỗi lớp là
  một nhóm ô bật/tắt được, `group` thuộc `drawio | deviceType | cableType`. Lớp trạng thái sống
  sẽ là `group: 'live'`, MẶC ĐỊNH TẮT, chỉ có khi server trả `liveStatus` trong nội dung bản vẽ.
- Bật lớp thì trình xem đặt `data-ims-live="up|down|degraded|unknown"` lên `<g data-cell-id>` của ô
  thiết bị; màu là token `--diagram-live-*` (có cặp dark) trong `tokens.css`, không hex.
- Thẻ thiết bị hiện "Trạng thái: … (theo <source>, lúc <observedAt>)". Không tự làm mới liên tục ở
  bản đầu: mở lại bản vẽ (một dòng `diagram.viewed`) là lấy trạng thái mới.
- "Chỉ đường" KHÔNG đổi theo trạng thái (vẫn đi trên sơ đồ cổng); lớp sống chỉ tô thêm máy đang
  `down` trên đường đã tô.

## 4. Việc phải làm khi mở phần này (không làm trong Epic 10)

1. Ghi quyết định vào `docs/QUYET-DINH.md` (nguồn giám sát nào, ai giữ khoá).
2. Migration bảng `device_live_status` (+ lịch sử nếu cần) và tham số `monitoring.*`.
3. Module `monitoring` + guard khoá API riêng; xoá bài vắng mặt trong
   `live-status-reserved.spec.ts`, thay bằng bài bề mặt route khẳng định route đó CHỈ nhận khoá API.
4. Thêm `group: 'live'` vào mô hình lớp của trình xem + token màu + E2E 390px, light và dark.
