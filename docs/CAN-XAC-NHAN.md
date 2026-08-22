# Những chỗ tôi tự quyết — cần anh xem lại

> Anh đã đồng ý (2026-08-23): gặp chỗ AC chưa chốt thì **tự quyết theo mặc định an toàn rồi
> ghi vào đây**, thay vì dừng chờ. File này là danh sách để anh đọc buổi sáng: chỗ nào sai
> thì nói, tôi sửa — sửa sớm rẻ hơn nhiều so với để cả đêm không ai làm gì.
>
> Mỗi mục ghi đủ: **quyết gì · vì sao · sửa lại tốn bao nhiêu**.

---

## Đã chốt cùng anh (không cần xem lại)

| Ngày | Việc | Chốt |
| --- | --- | --- |
| 2026-08-22 | Danh mục seed sẵn | Chỉ seed 12 loại thiết bị. Site/tủ/NCC để trống, anh điền file mẫu rồi import |
| 2026-08-23 | **Xóa hẳn bản ghi nhập nhầm** (open item PRD) | **KHÔNG xóa hẳn.** Bản ghi nhập nhầm được đánh dấu và ẩn khỏi mọi danh sách, vẫn tra cứu được, vẫn còn vết ai nhập ai ẩn. Áp cho IP (Epic 5) và mọi module sau |
| 2026-08-23 | Phạm vi đêm 23/08 | Epic 3 → 4.1/4.2 → 5 → 6 → 7. **Dừng trước story 4.3** (cần anh làm tay: diễn tập khôi phục, phong bì niêm phong, dữ liệu thật, deploy prod) và **dừng trước Epic 8/9** (chờ 8 mẫu phiếu ISO) |

---

## Cần anh xác nhận

### 1. Hợp đồng ISP: bảng riêng, không phải một "loại phần mềm" — story 3.1/3.3

**Quyết:** loại hồ sơ phần mềm gồm `License · SSL · Tên miền · Hợp đồng bảo trì · Khác`.
**Bỏ** loại "hợp đồng ISP" khỏi danh sách này; đường truyền ISP có **bảng và màn riêng**
(story 3.3) với đủ nhà mạng, băng thông, IP WAN, thiết bị Draytek, hotline, số hợp đồng.

**Vì sao:** AC 3.1 liệt kê "hợp đồng ISP" là một loại phần mềm, nhưng AC 3.3 lại đòi hồ sơ ISP
có cả chục trường vận hành không nhét vừa bảng `software`. Để cả hai thì cùng một hợp đồng ISP
khai được ở hai nơi — đúng kiểu dữ liệu lệch nhau sau vài tháng. Hồ sơ ISP ở 3.3 **đã có**
ngày bắt đầu/kết thúc và số hợp đồng, nên nó chính là hợp đồng, không cần bản sao.

**Sửa lại tốn bao nhiêu:** nhỏ. Thêm lại `isp_contract` vào danh sách loại là một migration
đổi `CHECK` + một dòng trong `software-rules.ts`. Chưa có dữ liệu thật nên không phải chuyển gì.

### 2. Trạng thái hồ sơ phần mềm — story 3.1

**Quyết:** ba trạng thái `Đang dùng · Hết hạn, không gia hạn · Đã bỏ`. AC không nêu danh sách
trạng thái, nhưng cỗ máy cảnh báo (3.4) cần biết cái nào **thôi không nhắc nữa** — nếu không thì
mỗi license cũ đã bỏ vẫn nhắc mãi và người ta sẽ tắt luôn cảnh báo.

**Sửa lại tốn bao nhiêu:** nhỏ, một migration đổi `CHECK` + nhãn i18n.
