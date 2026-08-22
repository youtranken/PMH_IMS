# Danh mục mẫu cho Epic 2 (site · tủ · loại thiết bị · nhà cung cấp)

Đây là **bản nháp để anh sửa**, chưa phải dữ liệu thật. Khi chốt, nội dung này thành một
migration seed (AD-10) — không nhập tay trên từng máy.

Hai file Excel đi kèm — sinh lại bất cứ lúc nào bằng một lệnh:

```bash
npm --prefix api run make:templates
```

| File | Điền khi nào |
| --- | --- |
| [`mau-danh-muc.xlsx`](./mau-danh-muc.xlsx) | TRƯỚC: site, tủ mạng, loại thiết bị, nhà cung cấp |
| [`mau-thiet-bi.xlsx`](./mau-thiet-bi.xlsx) | SAU: từng thiết bị, cột danh mục ghi theo mã/tên đã khai ở trên |

> Trong app, hai nút **"Tải file mẫu"** (màn Danh mục và màn Thiết bị) sinh ra ĐÚNG hai file
> này từ cùng một định nghĩa, kèm dữ liệu đang có — nên xuất ra, sửa hàng loạt trong Excel,
> rồi nhập lại là được ngay.

## 1. Site

| Mã | Tên | Ghi chú |
| --- | --- | --- |
| `PMH-HO` | Văn phòng chính | Phòng máy chủ tầng 1 |
| `PMH-NM` | Nhà máy | Tủ mạng phòng kỹ thuật |

> Cần thêm chi nhánh/kho nào nữa thì thêm dòng — mã viết HOA, không dấu, không khoảng trắng.

## 2. Tủ mạng

| Mã tủ | Site | Mô tả | Số U |
| --- | --- | --- | --- |
| `R01` | PMH-HO | Tủ mạng chính — Internet, core switch, UPS | 42 |
| `R02` | PMH-HO | Tủ máy chủ — server, NAS | 42 |
| `R03` | PMH-HO | Tủ tầng 3 — switch tầng | 12 |
| `R04` | PMH-HO | Tủ tầng 4 — switch tầng | 12 |
| `RNM1` | PMH-NM | Tủ mạng nhà máy | 24 |

> Thiết bị không nằm trong tủ (PC, máy in, AP) để trống cột Tủ. Tủ luôn thuộc đúng một site.

## 3. Loại thiết bị

| Loại | Đặc thù trong IMS |
| --- | --- |
| Switch | Có **port map** (FR-006) — bảng port ↔ thiết bị đối diện |
| Firewall | Gắn hồ sơ ISP (FR-010) và sổ NAT (FR-019) |
| Server | Thường có nhiều secret trong két (FR-021) |
| NAS | Đích backup — theo dõi dung lượng, bảo hành |
| UPS | Theo dõi lịch thay bình |
| Access Point | Gắn switch/port cấp PoE |
| PC | Gắn người dùng cụ thể |
| Laptop | Gắn người dùng cụ thể |
| Printer | Gắn phòng ban |
| Camera | Gắn đầu ghi |
| Điện thoại IP | Gắn số máy nhánh |
| Thiết bị khác | Trường hợp còn lại |

## 4. Nhà cung cấp (mẫu — thay bằng NCC thật)

| Tên | Cung cấp | Liên hệ |
| --- | --- | --- |
| Công ty TNHH ABC Networks | Cisco / Aruba | 0909 xxx xxx |
| Nhà phân phối Draytek VN | Draytek | 0909 xxx xxx |
| Dell Partner VN | Máy chủ Dell | 0909 xxx xxx |
| Synology Reseller | NAS | 0909 xxx xxx |
| Schneider Partner | UPS APC | 0909 xxx xxx |
| Ubiquiti Reseller | Access Point | 0909 xxx xxx |
| CTY Máy tính XYZ | PC, máy in, vật tư | 0909 xxx xxx |

## 5. Quy ước mã thiết bị (gợi ý)

```
<LOẠI>-<VỊ TRÍ hoặc VAI TRÒ>-<SỐ>
SW-CORE-01      switch lõi
SW-ACC-3F-01    switch tầng 3, cái số 1
FW-DRAYTEK-01   thiết bị biên
SRV-APP-01      máy chủ ứng dụng
PC-KT-05        máy trạm phòng Kế toán
```

Mã là thứ mọi người gõ khi tra cứu và là khóa để import lại (import trùng mã = **cập nhật**,
không tạo bản sao). Chốt quy ước sớm thì 300 thiết bị nhập một lần là xong.

## 6. Việc cần anh làm

1. Mở `mau-danh-muc.xlsx`, điền 4 sheet: Site → Tủ mạng → Loại thiết bị → Nhà cung cấp.
   Chốt kỹ **mã site** và **mã tủ** vì đó là thứ mọi người gõ khi tra cứu, đổi sau rất phiền.
2. Mở `mau-thiet-bi.xlsx`, xem 2 dòng ví dụ để biết định dạng, rồi điền thiết bị thật
   (hoặc dán từ file Excel đang dùng). Ngày ghi kiểu 30/08/2026 hay 2026-08-30 đều được.
3. Chưa cần gửi lại cho tôi: **Quản trị › Danh mục › Nhập từ Excel** nhận file danh mục,
   **Thiết bị › Nhập từ Excel** nhận file thiết bị. Cả hai đều hiện bảng đối chiếu
   (thêm mới / cập nhật / lỗi ở dòng nào, vì sao) để anh duyệt TRƯỚC khi ghi.
4. Nếu muốn tôi khớp cột giúp (file Excel hiện tại của anh có cột khác), gửi file — tôi map vào bộ
   validate của story 2.1/2.6.

> Nhắc theo FR-035: **không ghi mật khẩu vào cột Ghi chú**. Mật khẩu thiết bị vào Két sắt (Epic 4).
