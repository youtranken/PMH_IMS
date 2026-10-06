# Đề xuất: Model thiết bị · Ảnh · Cổng · Tủ trên sơ đồ

Trạng thái: **đã duyệt 06/10/2026** — ghi vào `docs/QUYET-DINH.md`: Q-23 gạch "Quy trình vẽ và ba
nguồn sự thật" (Đợt 1) và Q-26 Model thiết bị (Đợt 2). Khi lệch nhau, `QUYET-DINH.md` thắng. Viết
lại theo buổi tư vấn chiều 06/10 — thêm Luật gốc, Quy trình, mục 29–33; mục 1–28 giữ nguyên số để
tra lại trao đổi cũ.

Nguồn: buổi trao đổi 06/10/2026 sau 5 ảnh lỗi trong `IMS/1.png`–`5.png`; tham khảo cách NetBox
(netbox-topology-views, rack elevation, devicetype-library) làm.

## Vì sao phải làm

Ảnh trên sơ đồ bị thừa khoảng trống, bị co nhỏ trong tủ, máy đè nhau và chiếm nhầm U. Có ba gốc:

1. Ảnh không được cắt chuẩn. Nền trắng hoặc trong suốt quanh máy vẫn tính vào khung.
2. Khung hiển thị cứng: ô vuông ở Bản đồ quan hệ, khung cao 160px ở trang thiết bị.
3. Máy nằm sai tủ hoặc chưa khai U thì không bị ép về đúng U.

Ngoài ra, Số U, ảnh và cổng đang khai rải rác trên từng máy. Mỗi model lại phải khai lại từ đầu,
và model gõ tay dễ bị tách đôi ("C9300-48P" khác "c9300 48p").

Nhưng gốc sâu hơn cả ba điều trên: chưa có **quy trình** — chưa chỗ nào trả lời "một người cầm tủ
mới lắp xong thì đi qua những bước nào để ra bản vẽ chính thức". Bản viết lại này thêm phần Luật
gốc và Quy trình trước, các mục A–G trở thành chi tiết thực hiện của quy trình đó.

## Luật gốc — ba nguồn sự thật, không chồng nhau

| # | Luật | Hệ quả |
| --- | --- | --- |
| L1 | **Kho là nguồn duy nhất về VỊ TRÍ** (tủ + U bắt đầu + Số U). Mặt tủ trên bản vẽ là ảnh chiếu của kho, không phải thứ để vẽ tay. | Mọi thao tác kéo-thả trong khung tủ là một **thao tác kho** có hộp xác nhận (chuyển tủ, khai U) và ghi audit ngay — như sửa ở trang thiết bị, không chờ duyệt bản vẽ. Hủy = không đổi gì cả hai bên. Toàn bộ mục E là hệ quả của luật này. |
| L2 | **Sơ đồ cổng là nguồn duy nhất về DÂY** (đã chốt Q-23 02–03/10: "vẽ là khai, có hỏi"). | Lưu / phát hành bản vẽ không bao giờ ghi sơ đồ cổng; chỉ nút "Khai" / "Gỡ luôn kết nối" mới gọi API `devices`. |
| L3 | **Model là nguồn về ĐẶC TÍNH LOẠI MÁY** (gắn tủ, Số U, cổng mẫu, ảnh mặt trước). Máy thừa hưởng từ model, sửa đè được từng giá trị riêng. | Khai một lần, dùng cho mọi máy cùng loại. Đợt 1 (chưa có model) đọc các trường này trên từng máy; Đợt 2 model thành nguồn — xem "Chuyển tiếp Đợt 1 → Đợt 2" cuối tài liệu. |

## Quy trình

### QT-1 · Thêm thiết bị (việc hằng ngày — thiết bị trước, model tạo tại chỗ)

Không cần vào Danh mục tạo model trước. Lần đầu gặp một loại máy thì model được tạo ngay trong
form; từ máy thứ hai chỉ chọn lại.

```
Thêm thiết bị
   │
   ├─ Ô "Model" (có gợi ý)
   │     ├─ ĐÃ CÓ  → chọn → Số U, ảnh, cổng tự điền
   │     └─ CHƯA CÓ → "+ Tạo model mới" ngay trong form
   │           (Gắn tủ? Số U? Cổng mẫu? Ảnh?) → quay lại form
   │
   ├─ Model GẮN TỦ (switch, firewall, server…)
   │     → hỏi Tủ + U bắt đầu; ô U gợi ý các dải U TRỐNG đủ n U của tủ
   │       đã chọn, báo trùng ngay; nút "Xem tủ" (mục 12, 29)
   │
   └─ Model KHÔNG gắn tủ (máy in, camera, AP, PC, máy chấm công…)
         → ẩn ô Tủ/U, chỉ hỏi Site / phòng
```

Máy không gắn tủ vẫn đáng có model vì model còn mang ảnh và cổng mẫu (máy in = 1 cổng `LAN`),
và luật mục 21 chặn nó chui vào khung tủ.

### QT-2 · Vẽ tủ (mặt tủ dựng từ kho, việc tay chỉ còn phần kho chưa biết)

1. Tạo bản vẽ cho nút loại tủ trong cây → hộp tạo hỏi **"Bắt đầu từ"**: **"Dựng từ kho"** (mặc
   định — dùng máy móc "Dựng lại mặt tủ" đã có) / "Trang trắng" / "Chép nội dung bản vẽ cha"
   (mục 31). Mở ra là tủ đầy đủ: máy đã khai U nằm đúng U, máy thiếu U nằm cột "Chưa khai U".
2. Việc tay còn lại đều là thao tác kho hoặc khai dây:
   - dọn cột "Chưa khai U": thả vào tủ = khai U vào kho (mục 20);
   - kéo máy tủ khác vào = hộp "Chuyển máy sang tủ này" (mục 19);
   - vẽ dây = "vẽ là khai, có hỏi" (Q-23, giữ nguyên).
3. Tủ đổi nhiều ngoài đời (dồn máy, thay máy) thì không sửa tay từng ô: sửa kho rồi bấm
   **"Dựng lại mặt tủ"** — dây đã khai vẫn gắn đúng máy.
4. Lưu / gửi duyệt / phát hành theo Q-23, không đổi.

### QT-3 · Sơ đồ tự do (tầng / site / tổng thể)

Kéo máy (kể cả máy không gắn tủ) từ panel kho ra canvas, đi dây theo L2, vẽ khung/chữ/đám mây
tự do. Chi tiết ở mục F, giữ nguyên các phần đã làm (mục 24).

### Thước đo thành công

- Tủ 20 máy đã nhập kho đủ (U + ảnh) → bản vẽ tủ hoàn chỉnh **dưới 2 phút, 0 lần chỉnh ảnh/ô
  bằng tay**.
- Máy thứ hai trở đi cùng model: nhập kho **dưới 30 giây** (chọn model + tủ/U).
- Người vẽ biết máy nào chưa sẵn sàng **trước khi** kéo vào bản vẽ (huy hiệu, mục 32), không
  phát hiện lúc đang vẽ.

## A. Ảnh thiết bị

1. Tải ảnh lên thì mở **hộp cắt ảnh**. Hệ thống tự xén viền trắng hoặc trong suốt, người dùng
   chỉnh lại nếu cần.
2. Máy hoặc model **gắn tủ**: khung cắt khoá tỉ lệ mặt tủ 19 inch theo Số U. Tỉ lệ là
   482,6 mm : n × 44,45 mm, nên 1U ≈ 10,9:1, 2U ≈ 5,4:1, 4U ≈ 2,7:1.
3. Máy **không gắn tủ** (máy in, máy chấm công, PC, camera, AP…): cắt tự do, chỉ xén viền.
4. Khung xem ảnh ở trang thiết bị và trên Bản đồ quan hệ theo tỉ lệ ảnh. Ảnh dài thì khung dài,
   không còn khoảng trống trên dưới.
5. Thứ tự lấy ảnh: ảnh riêng của máy → ảnh của model → biểu tượng loại.
6. Ảnh cũ chưa cắt chuẩn thì hiện nhắc "Ảnh chưa cắt chuẩn — Cắt lại".

## B. Model thiết bị (mới, trong Danh mục)

7. Mỗi model gồm:
   - Hãng, Mã model, Loại thiết bị.
   - **Gắn tủ**: Có kèm **Số U**, hoặc Không.
   - **Cổng mẫu**: các nhóm cổng, xem bảng dưới.
   - **Ảnh mặt trước**: chỉ mặt trước, cắt theo mục A.
8. Mỗi model hiện số máy đang dùng nó. Không cho xoá model khi còn máy dùng.
9. Dữ liệu thử cũ **không chuyển đổi**. Máy cũ để "chưa có Model", cổng khai tay cũ xoá cũng được.
   Prod nhập dữ liệu thật từ đầu.

**Cổng mẫu** gõ tự do theo đúng tên của hãng. Phần `[a-b]` để sinh nhiều cổng một lần. Mỗi nhóm
chọn thêm kiểu cổng (RJ45 / SFP / SFP+ / Console / Khác) để vẽ mặt cổng.

| Loại máy | Gõ | Sinh ra |
|---|---|---|
| Switch Cisco | `Gi1/0/[1-48]` + `Te1/1/[1-4]` | Gi1/0/1…48, Te1/1/1…4 |
| Firewall Sophos | `Port[1-8]` + `MGMT` | Port1…8, MGMT |
| FortiGate | `wan[1-2]` + `internal[1-7]` | wan1, wan2, internal1…7 |
| Server | `eth[0-3]` + `iDRAC` | eth0…3, iDRAC |
| Máy in / máy chấm công | `LAN` | LAN |
| Máy in Wi-Fi | *(trống)* | không có cổng |

Có mẫu dựng sẵn để chọn nhanh: "Switch 24 cổng", "Switch 48 + 4 uplink", "1 LAN".

## C. Thêm / Sửa thiết bị

10. Ô **Model** có gợi ý. Chưa có thì bấm "**+ Tạo model mới**" ngay trong form, hỏi nhanh: Gắn tủ?
    Số U? Cổng mẫu? Không phải sang Danh mục.
11. Chọn model là tự có Số U, ảnh, và **cổng sinh sẵn**. Một máy vẫn có thể sửa đè giá trị riêng,
    ví dụ thêm card mạng thì thêm cổng.
12. Model gắn tủ thì form chỉ hỏi **Tủ + U bắt đầu**, có câu giải thích ("Thiết bị nằm ở U30" /
    "Chiếm U30–U31") và nút **Xem tủ**. Model không gắn tủ thì ẩn ô tủ và U, chỉ còn Site / phòng.
13. **Truy cập quản trị**: danh sách các dòng gồm *kiểu* (Web / SSH / Telnet / RDP / Winbox / Khác)
    và *địa chỉ:cổng*. Web hiện thành link bấm được. SSH hiện lệnh `ssh <địa chỉ> -p <cổng>` kèm nút
    chép. Mật khẩu vẫn để trong Két.

## D. Cổng của thiết bị

14. Tab Cổng có **hình mặt cổng dạng lưới**: ô xanh là đang dùng, ô xám là trống. Rê chuột vào ô
    thì thấy cổng đang nối với máy nào, cổng nào.
15. Bảng cổng mặc định chỉ hiện **cổng đang dùng**, có nút "Hiện cả cổng trống (n)".
16. Khai dây thì **chọn cổng trống trong danh sách**, không gõ tay.

## E. Tủ trên sơ đồ (theo cách NetBox — toàn bộ là hệ quả của luật L1)

17. Chỉ vẽ **mặt trước** của tủ.
18. Trong tủ, máy **đặt theo U trong kho**, không theo chuột:
    - khối máy luôn cao đúng n × U, rộng đúng bề ngang tủ, ảnh phủ kín khối;
    - nhãn một dòng "mã · IP" đặt bên phải, tự tránh đè nhau;
    - hai máy không bao giờ chung một U.

Các tình huống kéo-thả vào khung tủ (mục 19–21 cũ, viết thành bảng — khớp test bảng dữ liệu
`rack-fit.test.ts`):

| Máy kéo vào là… | Hệ thống làm gì | Bấm Hủy thì |
| --- | --- | --- |
| Máy **cùng tủ** trong kho | Bắt về đúng "U bắt đầu" của kho, không hỏi | — |
| 19. Máy **tủ khác** | Hộp "Chuyển máy sang tủ này" (sửa được U, báo trùng U) → ghi kho | Máy bật ra ngoài khung, không nằm đè trong tủ |
| 20. Máy **chưa khai U** | Hỏi chọn U trống gần chỗ thả → ghi kho | Máy sang cột "Chưa khai U" |
| 21. Máy **không gắn tủ** | Không bao giờ vào tủ | — |

## F. Sơ đồ tự do (ngoài tủ)

22. Mọi máy dùng **cùng một chiều ngang chuẩn**, cao theo tỉ lệ ảnh. Chiều ngang chuẩn là tham số
    `system_config` (AD-11). Vẫn kéo giãn tay được.
23. Thẻ thông tin máy hiện thêm số cổng đang dùng trên tổng ("cổng 12/52").
24. Giữ nguyên các phần đã làm:
    - kéo thả máy từ kho;
    - nhãn cổng ở hai đầu dây;
    - rê chuột lên máy hoặc dây thì hiện thẻ và tô sáng;
    - giữ bản đang vẽ dở;
    - bẻ dây vuông góc;
    - Lưu khi không đổi gì thì không tạo phiên bản.

## Mục bổ sung 06/10 chiều (29–33)

29. *(thuộc C, làm cùng mục 12)* Ô **U bắt đầu** không bắt gõ mò: chọn tủ xong thì liệt kê các
    **dải U trống đủ n U** của tủ đó để chọn, gõ tay thì báo trùng ngay trong form (cùng ràng
    buộc `device_rack_u_no_overlap` phía DB). "Xem tủ" mở mặt tủ hiện tại để đối chiếu.
30. *(thuộc B)* **Chống model tách đôi:** mỗi model có khoá chuẩn hoá (viết HOA, bỏ khoảng trắng
    và gạch — "C9300-48P" và "c9300 48p" ra cùng khoá) là UNIQUE. Gõ model mới mà trùng khoá
    chuẩn hoá thì gợi ý model có sẵn, không cho tạo bản thứ hai.
31. *(thuộc E / QT-2 — SỬA gạch Q-23 04/10 "tạo bản vẽ con mặc định nhân bản bản cha")*
    **Hộp tạo bản vẽ hỏi "Bắt đầu từ":**
    - nút **tủ**: "Dựng từ kho" (mặc định) / "Trang trắng" / "Chép nội dung bản vẽ cha";
    - nút **khác** (site/tầng/phòng…): "Trang trắng" (mặc định) / "Chép nội dung bản vẽ cha".
    "Chép nội dung bản vẽ cha" chỉ là mồi nội dung khởi đầu một lần, không liên kết gì về sau —
    hộp tạo ghi rõ câu đó. Lý do đổi mặc định: chính chủ dự án thấy hành vi tự nhân bản khó hiểu
    (06/10); còn nhu cầu "copy để sửa không ảnh hưởng bản gốc" đã có hai cơ chế đúng việc:
    **nháp + Phát hành** (sửa bản nào thì bản chính thức của chính nó vẫn nguyên) và
    **Bản trình bày** (bản tách rời hẳn).
32. *(thuộc F / panel kho, Đợt 1 — chủ dự án chốt 06/10)* **Huy hiệu sẵn sàng** trong panel
    "Thiết bị kho" của màn vẽ: máy gắn tủ thiếu U → "thiếu U"; thiếu ảnh → "thiếu ảnh"; ảnh chưa
    cắt chuẩn → "cắt lại"; kèm bộ lọc. Không chặn kéo vào — chỉ báo trước.
33. *(thuộc hộp tạo/sửa bản vẽ)* **Ô "Cấp bản vẽ" tự giải thích:** chỉ cấp "Tủ mạng" đổi cách
    hoạt động (gắn tủ kho, dựng mặt tủ từ kho — luật D-03); các cấp còn lại chỉ là nhãn hiển thị
    trên bản đồ không gian, không ràng buộc cây. Thêm một câu chú thích nói đúng điều đó ngay
    dưới ô chọn, để người dùng không phải đoán.

## G. Để sau

25. Vai trò mạng (Firewall / Core / Access / Server…), để tự xếp sơ đồ và tô màu khối trong tủ.
26. Nút "Tự dựng sơ đồ từ kho" **cho sơ đồ tự do** (đặt máy và nối dây theo sơ đồ cổng). Riêng
    mặt tủ thì tự dựng ĐÃ CÓ ("Dựng lại mặt tủ") và nằm trong quy trình chuẩn QT-2, không để sau.
27. Nhập thư viện model của NetBox (devicetype-library): Số U, cổng, ảnh của các hãng phổ biến,
    tải về một lần, chạy offline.
28. AI chạy nội bộ để chuyển ảnh hoặc sơ đồ cũ sang draw.io. Không gửi dữ liệu mạng PMH ra ngoài.

## Chuyển tiếp Đợt 1 → Đợt 2 (khai báo trước, khỏi bất ngờ)

- Đợt 1 chưa có model: hộp cắt (mục 2) khoá tỉ lệ theo **Số U khai trên máy** (`device.rack_u_size`).
- Đợt 2 model thành nguồn Số U (luật L3). Máy đã có ảnh cắt theo U cũ mà **lệch với U của model**
  thì hiện lại "Ảnh chưa cắt chuẩn — Cắt lại" (mục 6) — không tự co kéo ảnh.
- Thao tác kho từ màn vẽ (khai U, chuyển tủ, khai dây) **ghi ngay, có audit, không chờ duyệt bản
  vẽ** — nhất quán với quyền sửa sơ đồ cổng trực tiếp của Thành viên (Q-23 02/10). Hủy duyệt /
  bỏ nháp bản vẽ KHÔNG hoàn tác được các thao tác kho này.

## Cách làm

- Đợt 1: A, E, F + mục 31–33 (trừ phần lấy từ Model). **Đang làm.**
- Đợt 2: Model thiết bị (B, C, D + mục 29, 30). Model thay chỗ lấy Số U, ảnh và cổng; cách hiển
  thị giữ nguyên.
- Mỗi quyết định ghi vào `docs/QUYET-DINH.md` trước khi sửa code; AC chi tiết từng mục ghi vào
  `epics.md` lúc nhận việc (TDD cần AC để viết test đỏ trước).
- Kiểm theo mục (đối chiếu khi nhận việc):

| Mục | Logic thuần (unit) | E2E |
| --- | --- | --- |
| 1–6 (ảnh, cắt) | `photo-bridge.test.ts`, crop phía web | spec tải ảnh + "Cắt lại" |
| 18–21 (khung tủ) | `rack-fit.test.ts` (bảng tình huống ở E), `diagram-frames.spec.ts` | `diagrams-rack*.spec.ts` |
| 22–23 (tự do) | `diagram-frames` bề rộng chuẩn | spec trang tự do |
| 29 (U trống) | hàm dải U trống (`rack-units`) | spec form thiết bị |
| 30 (khoá model) | hàm chuẩn hoá + spec DB (UNIQUE) | spec tạo model trùng |
| 31 (hộp tạo) | — | spec tạo bản vẽ: tủ 3 nguồn, nút khác 2 nguồn |
| 33 (chú thích cấp) | — | cùng spec của 31 (chữ hiện trong hộp) |
| 32 (huy hiệu) | hàm tính trạng thái sẵn sàng | spec panel kho |

- Mỗi đợt chạy E2E của màn bị đụng. Cuối cùng: E2E đầy đủ một lần, rồi gộp `master` và gắn tag
  v1.6.0 (xin phép trước khi push).
