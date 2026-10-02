---
title: Brainstorm Intent — Epic 10 Sơ đồ mạng (thay Visio)
date: 2026-10-02
source: _bmad-output/brainstorming/brainstorm-so-do-mang-2026-10-02/.memlog.md
decision: docs/QUYET-DINH.md Q-23
status: approved-scope (Phải có + Nên có + Có thì tốt đều làm trong Epic 10)
---

# Brainstorm Intent — Sơ đồ mạng thay Visio

## 1. Mục tiêu

Bỏ Visio. Bản vẽ hạ tầng nằm trong IMS, **khớp dữ liệu thật**, có phiên bản và duyệt, Thành viên vẽ
được, mọi lần xem phải nhập mã 2 lớp. Làm **trước Epic 8–9**. Vẽ mới, không nhập file Visio cũ.

Câu chốt: **sơ đồ = lớp nhìn của dữ liệu kho** (thiết bị, sơ đồ cổng, dải IP, két) **+ lớp vẽ tự do**.
Dây là DỮ LIỆU (một dòng sơ đồ cổng có hai đầu), không phải nét vẽ — nhờ vậy tô sáng, nhảy bản vẽ,
tự kiểm, cảnh báo lệch kho và chỉ đường làm được, điều Visio không làm được.

Quy mô: ~300+ thiết bị, 3 site, 5 người. Không cần kỹ thuật bản đồ cỡ Google Maps.

## 2. Ba trục

1. **Cây bản vẽ:** Tổng công ty → site chính (Tower) → site phụ (CR3) → tầng → phòng → tủ rack.
   Tầng/phòng chỉ là tên bản vẽ, không thêm danh mục vị trí. Nháy đúp khung để xuống bản vẽ con,
   thanh đường dẫn để lên. Bản vẽ tổng chỉ hiện thiết bị lõi + đường nối giữa site.
2. **Phiên bản:** mỗi lần lưu là một phiên bản (lưu sau thắng); bản nháp → bản chính thức (đã
   duyệt / Admin-SA tự phát hành). Lịch sử tóm tắt một dòng, đặt tên phiên bản, snapshot dữ liệu
   thiết bị, khôi phục bản trước (tạo phiên bản mới, không xoá lịch sử), so sánh tô màu, thanh
   trượt thời gian. **Bản trình bày** là nhánh tách rời, không duyệt.
3. **Bảo mật:** TOTP mỗi lần xem (chính thức, phiên bản cũ, trình bày); ân hạn sơ đồ 10 phút,
   **tách phạm vi với két** (nhập ở đâu tính ở đó); nhật ký mỗi lần mở; watermark tên người xem +
   giờ trên màn hình và file xuất (răn đe, không chống được cắt ảnh).

## 3. Những gì đã chọn

**Thiết bị**
- Hình = hồ sơ kho; biểu tượng SVG theo **Loại thiết bị** (chọn từ thư viện hoặc SA tải SVG, lọc
  mã độc). Ảnh thật theo model hoặc theo từng máy (lấy từ giấy tờ đính kèm), mặt trước/sau, ghim
  cổng trên ảnh. Công tắc Biểu tượng / Ảnh thật trên từng hình.
- Thẻ thiết bị: IP, model, serial, site/tủ/U, hotline NCC, bảo hành, "có mặt trong bản vẽ nào" —
  lấy từ kho, không gõ lại. Nút **Mở két** (vẫn TOTP của két). Nhãn vị trí dưới hình
  (Tower · Tủ R1 · U12).
- Mặt tủ theo U tự sinh — cần thêm trường **U bắt đầu + số U** cho thiết bị.

**Dây**
- Kéo A→B → chọn cổng hai đầu (chỉ cổng còn trống), loại dây. Một cổng một cáp (Q-20).
- Màu theo **loại dây** do công ty quy định một lần, chú giải tự sinh; người vẽ không tự chọn màu.
- Nhãn cổng hai đầu, thẻ dây (cổng, VLAN, loại cáp, ghi chú).
- Bấm thiết bị: tô sáng mọi dây + đầu kia, làm mờ phần còn lại; dây ra ngoài bản vẽ hiện mũi tên
  "tới Core-01 (bản vẽ Phòng server)" bấm nhảy sang.

**Vẽ tự do:** khung tòa nhà/tầng/phòng/VLAN, đám mây ISP, chữ, mũi tên, đường nối site. Khung
VLAN gắn dải IP (bấm thấy dải, IP trống). Kéo "Tủ R1" vào ra khung tủ chứa sẵn mọi máy, tự giãn.

**Duyệt**
- Thành viên gửi duyệt (bắt ghi lý do); Admin duyệt. Bản Admin/SA vẽ tự phát hành.
- Gửi/phát hành thì **tự kiểm**: lỗi đỏ chặn (cổng không tồn tại, một cổng hai dây, máy đã thanh
  lý); cảnh báo vàng cho qua (máy đặt trong khung tủ khác tủ trong kho, dây giữa hai site không có
  đường nối).
- Không bắt Admin bấm qua từng thay đổi: tóm tắt + nút xem so sánh (tuỳ chọn).
- Trả về kèm **bình luận ghim** trên hình/dây (kiểu Figma, trả lời thành luồng).
- Báo "Đang có Nguyễn A mở sửa bản vẽ này".

**Lệch kho — chỉ cảnh báo, không ép:** máy thanh lý / đổi IP / đổi cổng sau khi vẽ thì hiện dấu
"Có X thay đổi chưa vẽ" + báo người phụ trách; nút "Kiểm tra khớp dữ liệu".

**Xem và dùng**
- Xuất PNG/PDF có chân trang (phiên bản, ngày duyệt, người vẽ, người duyệt) + watermark — nộp ISO.
- Phóng to hiện chi tiết, bật/tắt lớp, tìm và bay tới, chỉ đường giữa hai thiết bị.
- Tự xếp sơ đồ từ sơ đồ cổng đã khai; Xếp gọn (đường thẳng/góc vuông); nối hàng loạt theo thứ tự cổng.
- Trình chiếu từ tổng xuống chi tiết (bàn giao người mới); xem trên điện thoại CHỈ XEM.

**Bản trình bày:** nhân bản từ bản chính thức, không duyệt, thêm thiết bị dự kiến (viền đứt, giá,
NCC) + ảnh tự do, PDF có dải "BẢN TRÌNH BÀY — không phải sơ đồ chính thức", ghi rõ dựa trên bản
chính thức nào và báo khi bản gốc có phiên bản mới.

## 4. Không làm (WON'T)

Nhập Visio · giám sát sống ping/SNMP trong Epic 10 · liên kết Epic 9 / phiếu 0213 · xuất Excel
danh sách dây · ép cập nhật bản vẽ khi kho đổi.

**Chừa chỗ:** API nhận trạng thái thiết bị từ máy giám sát ngoài (khoá API riêng) + lớp
"trạng thái sống" bật/tắt — chỉ thiết kế, không làm.

## 5. Ràng buộc kỹ thuật đã thấy

- Step-up hiện là một mốc chung theo phiên (`sessions.stepped_up_at`) → cần step-up có phạm vi
  (két / sơ đồ) + tham số ân hạn riêng trong `system_config`.
- Kho chưa có tầng, phòng, vị trí U của thiết bị trong tủ; `cabinet` đã có `u_height`.
- `device_port` chưa có loại dây; màu không được viết hex ngoài `tokens.css` → loại dây chọn một
  ô màu trong bảng token (có cặp dark).
- Một thiết bị có mặt ở nhiều bản vẽ vẫn là một hồ sơ.
- Thư viện vẽ đã chọn từ PRD/addendum: `@xyflow/react` (React Flow) + `html-to-image`.
