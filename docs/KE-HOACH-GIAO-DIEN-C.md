# Kế hoạch port giao diện C (Q-27)

Quyết định: `docs/QUYET-DINH.md` Q-27. Mockup: artifact "IMS thiết bị — mockup gọn", trang
"Luồng đầy đủ (chạy thử)". Nhánh: `ux/c-thiet-bi-phan-mem` (tách từ `master`).

Mỗi giai đoạn là một cụm commit, làm theo TDD (test đỏ trước). Hết giai đoạn: unit + `test:db` phần
chạm, `npm run build` (cổng kiểu của web), dựng lại image rồi chạy E2E của đúng mảng đó (chủ dự án
cho chạy E2E theo phạm vi trên DB dev, 08/10/2026). Thứ dùng chung mới khai vào
`docs/SHARED-REGISTRY.md` ngay trong giai đoạn sinh ra nó.

## Thứ tự và lý do

`0 → 1 → 2 → 3 → 6 → 5 → 4`

- 1, 2, 3, 6 chỉ chạm giao diện, rủi ro thấp, ra kết quả sớm. Giai đoạn 2 sinh `CardList` mà 5 và 4
  dùng lại.
- 5 có migration + API mới (ghế của hồ sơ) — làm khi khuôn giao diện đã ổn định.
- 4 cuối cùng: mockup chưa có bản 390px của trang chi tiết thiết bị (màn đọc, bắt buộc 390px) —
  vẽ bổ sung trước khi làm.

## 0 · Chốt (xong khi commit)

- Q-27 trong `QUYET-DINH.md`, file kế hoạch này.

## 1 · Menu, nhãn, tiêu đề hộp thoại

- `web/src/shell/app-nav.ts`: "Danh mục" lên đầu nhóm Tài sản.
- `web/src/locales/vi.ts`: đổi nhãn theo Q-27 (giữ `term-consistency.test.ts`, `dead-keys`).
- `web/src/ui/dialog.tsx`: prop nhãn phân hệ ở tiêu đề; dùng ở form thiết bị, phần mềm, danh mục.
- Token mới trong `web/src/css/tokens.css` (có cặp dark) cho bóng nổi của thẻ.
- E2E: `shell*`, `ux-login-shell`, `di-khap-giao-dien-09-*`, `catalog*` (nhãn).

## 2 · Bảng danh sách + khu bung dòng

- `features/devices/devices-screen.tsx`: cột theo Q-27 (thêm Ảnh, IP; bỏ Người sử dụng, Bảo hành,
  dòng phụ dưới tên). Bộ lọc, xuất Excel, thẻ 390px giữ.
- `ui/card-list` (mới, dùng chung): thẻ tách nhau + tiêu đề cột đậm + nổi khi rê. Dùng ở
  `device-licenses-expand.tsx`, `license-seats-expand.tsx` (rồi tab ở 4 và 5).
- Bảng phần mềm: chip "Xóa lọc" như bảng thiết bị.
- E2E: `devices*`, `software*`, `license-assignment`, `retired-device-guard`.

## 3 · Form thiết bị

- `features/devices/device-form.tsx`, `device-model-field.tsx`: Model đầu tiên, gợi ý có ảnh thu
  nhỏ + dải "Đã điền theo model"; khối *Máy gì*, *Đặt ở đâu* luôn mở; còn lại gập.
- `ui/fold-section` (mới): khối gập có đếm ô đã khai; mở sẵn khi có lỗi bên trong.
- Giữ "Lưu và nhân bản", Xem tủ, U trống, cắt ảnh, giấy tờ nháp.
- E2E: `devices*`, `device-models`, `device-picker-usable`, `devices-diagram-look`, `device-import`.

## 6 · Danh mục

- `features/catalog/catalog-screen.tsx`: 3 nhóm + tab con; `?tab=` cũ vẫn đúng; thẻ "Khai trước
  khi thêm thiết bị" (số liệu từ `use-catalog-lists`, đếm model chưa có ảnh).
- E2E: `catalog*`, `catalog-search-history`, `device-models`.

## 5 · Phần mềm (có migration)

DB và API (TDD `test:db` trước):
- Migration mới (sau `0064`): bảng ghế của hồ sơ (`software_id`, số thứ tự, số hợp đồng, ghi chú),
  `license_assignment` thêm liên kết ghế (null khi hồ sơ không tick), `software` thêm số hợp đồng
  chung + cờ mỗi ghế riêng, `file.owner_type` thêm loại ghế. Kiểm migration trên DB trắng.
- API ghi: `@Audited` + `@Roles` + `tx`; lịch sử phần mềm ghi đổi ghế; không bớt ghế đang có máy;
  gán vào ghế đã có máy bị chặn ở DB (unique) và ở service.
- Hộp Gán không gửi chi phí / hợp đồng / hạn / ghi chú nữa; Sửa ghế bỏ hợp đồng.

Web:
- `software-form.tsx`: hàng Tên · Mã · NCC; hàng Kỳ hạn · Bắt đầu · Hết hạn; khối Ghế và hợp đồng +
  tick + bảng ghế; ẩn ghi chú / giấy tờ chung khi tick; "Lưu rồi gán vào máy"; "Mua thêm đợt mới".
- `software-detail.tsx`: khuôn chung (dải 4 ô, dải "mua theo đợt", tab Tổng quan), tab Máy đang
  dùng dùng `CardList` + ghế trống; giấy tờ chia theo ghế.
- `assign-dialog.tsx`: chế độ gán chỉ chọn máy (+ bảng "Máy vào ghế nào" khi tick), prop máy chọn
  sẵn cho đường gán từ phía máy; chế độ Sửa ghế bỏ Hợp đồng.
- E2E: `software*`, `license-assignment`, `expiry*`, `disposal`, `security` (chạm API).

## 4 · Chi tiết thiết bị

- Vẽ bổ sung bản 390px trên mockup, chủ dự án xem trước.
- `features/devices/device-detail.tsx`: đầu trang + `PhotoStage` (mặt trước model / mặt sau riêng)
  + dải 4 ô; tab Phần mềm (`CardList`, nút "Gán phần mềm vào máy này"); Tổng quan: bản đồ quan hệ
  đổi kiểu, Thông số cố định thứ tự với "chưa khai", cột phải "Trong tủ" (`use-cabinet-occupants`)
  + Bảo hành. Băng báo, IP/NAT/ISP, tab Cổng / Két / Lịch sử, Thanh lý giữ.
- E2E: `device-detail`, `devices*.mobile`, `retired-device-guard`, `devices-diagram-look`.

## 7 · Đóng nhánh

- `bash ops/ci-local.sh` + E2E theo phạm vi (hợp các spec ở trên).
- `/code-review high`, sửa hết finding.
- `graphify update .`, mục "đã đóng góp gì" trong `docs/EPIC-MAP.md`.
- Merge `master`.
