# Kịch bản QA qua giao diện thật: IMS

Kịch bản này dành cho **agent QA tự lái trình duyệt** (Playwright, có giao diện) và cho người bấm
tay. Mục tiêu là đi hết các ngóc ngách theo **việc người dùng làm**, với 3 vai, các ca biên, màn
điện thoại và cả sáng lẫn tối, rồi **báo lỗi, không sửa code**.

- Bộ E2E tự động (`e2e/tests/`, khoảng 150 spec) đã phủ đường chính và phần lớn đường hỏng.
  Kịch bản này lo phần máy không thấy:
  - luồng khó hiểu, chữ sai hoặc lẫn tiếng Anh;
  - vỡ bố cục ở 390px, tương phản kém ở chế độ tối;
  - quyền lộ ở chỗ không ai nghĩ tới;
  - hệ quả xuyên màn hình;
  - nội dung thư.
- Khi một bước trong file này lệch với code, **chưa vội kết luận là lỗi**. Đối chiếu
  `docs/QUYET-DINH.md`: quyết định thắng `epics.md`. Kịch bản sai thì ghi vào mục "Kịch bản cần
  sửa" của báo cáo.
- File này thay `docs/KICH-BAN-TEST-THU-CONG.md` (bản Epic 1–7, còn đường dẫn Windows và URL
  tiếng Việt cũ).

Phạm vi: Epic 1–7, 10, 11 và giao diện C (Q-27: menu, bảng / form / trang chi tiết thiết bị và
phần mềm, ghế riêng, đợt mua — mã CAT-00, DEV-02b, DEV-07/08/10, SW-07/08/09, LIC-04/05). Epic 8, 9 (phiếu ISO, sự cố, Documents) **chưa làm**, không kiểm, không
báo thiếu (dashboard ghi "IMS chưa theo dõi sự cố" là đúng).

---

## 0. Luật giao chiến (đọc trước, không ngoại lệ)

Stack này **chưa phải prod** (chủ dự án xác nhận 08/10/2026), nhưng đã có dữ liệu chủ dự án nhập
tay (thiết bị, tủ, sơ đồ) mà không ai muốn nhập lại. Vì vậy:

| # | Luật | Vì sao |
| --- | --- | --- |
| R1 | **Chỉ ghi lên dữ liệu do chính QA tạo**: mã/tên phải chứa `E2E`, theo mẫu `QA-E2E-<lượt>-<số>` (ví dụ `QA-E2E-B-07`). Tài khoản QA phải là `e2e-tao-moi-qa-…@pmh.com.vn`. | `api/scripts/reset-e2e.mjs` chỉ dọn hàng có `E2E` (`device.code`, `software.code`, `subnet.name`, `diagram.name`, `site.code`, `cabinet.code`, `device_model.model`, `vendor.name`, `expiry_rule.name`, nhãn ngăn két…). Đặt sai tên thì rác ở lại. Lưu ý: **tên máy không được xét, phải là MÃ**. |
| R2 | Dữ liệu thật **chỉ được xem**: không sửa, không thanh lý, không kéo máy, không lưu bản vẽ, không gửi duyệt. | Một lần bấm "Đồng ý chuyển tủ" là ghi thẳng vào kho. |
| R3 | **Xem két thoải mái**, kể cả ngăn không do QA tạo (chủ dự án cho phép, stack chưa phải prod). Chỉ **ghi** két (tạo, đổi giá trị, thu hồi) trên chủ thể QA. Trong `findings.md` không chép nguyên giá trị, ghi "giá trị hiện đúng / sai định dạng". | Báo cáo sẽ lên trang web xem chung. |
| R4 | Không đụng `secrets/`, không chạy `rewrap`, không đọc `.env` ngoài dòng SMTP. | Bí mật chỉ nằm ở `secrets/` (CLAUDE.md). |
| R5 | Không khoá, vô hiệu hoá, đặt lại hay đóng phiên của tài khoản thật (`sa@`, `caothuan@`, mọi email không bắt đầu bằng `e2e-`). | Mất truy cập của người thật. |
| R6 | **Tham số hệ thống** (`/admin/settings`), thử khoá tài khoản và giới hạn tần suất **chỉ làm trong lượt Z** (chạy một mình, cuối cùng). Đổi xong phải trả lại đúng giá trị cũ, có ảnh chụp trước/sau. | Tham số áp cho mọi người trong 30 giây; giới hạn 20 lượt/phút tính theo IP chung. |
| R7 | Thư phải đi vào Mailpit. Trước lượt đầu, kiểm `.env` có `SMTP_HOST=mailpit`. Nếu không phải thì **dừng, không làm gì sinh thư**. Không bấm "Gửi lại" ở Thư gửi lỗi với thư không phải của QA. | Thư thật tới người thật. |
| R8 | **Không chạy bộ E2E tự động trong lúc QA** (`reset-e2e users` đặt lại 2 lớp của `e2e-sa`/`e2e-member`). Không chạy `ops/ci-local.sh`, `ops/seed-demo.sql`. | Hai bên giẫm dữ liệu của nhau. |
| R9 | Thử tấn công (IDOR, gọi API sai vai, CSRF, dùng lại mã) chỉ bằng phiên của tài khoản QA, nhắm vào bản ghi QA. Không flood, không quét cổng, không đòn từ chối dịch vụ. | Kiểm thử có phép trên stack của chính mình, nhưng không làm sập nó. |
| R10 | Agent QA **không sửa code, không commit**. Chỉ báo lỗi. Thấy cần sửa dữ liệu bằng SQL để mở đường kiểm thì ghi lại câu SQL vào báo cáo, không tự chạy (trừ câu `SELECT`). | Giữ cho kết quả QA là một bức ảnh của hệ thống thật. |

Khi phân vân một thao tác có phạm luật hay không: **bỏ qua thao tác đó, ghi vào báo cáo mục "Chưa
kiểm được" kèm lý do**.

---

## 1. Chuẩn bị (lượt 0, chạy một mình trước mọi lượt khác)

### 1.1 Môi trường

| Thứ | Giá trị |
| --- | --- |
| Web | `https://ims.pmh.com.vn` (`APP_BASE_URL`). Mọi request tay phải có `Origin` khớp, không thì nhận 403 `ORIGIN_MISMATCH`. |
| Mailpit | `http://localhost:8025` (API `…/api/v1/messages`). Tìm thư **theo tiêu đề + người nhận**, đừng lấy thư trên cùng. |
| Trình duyệt | Chromium của Playwright trong `e2e/node_modules`. Có phiên desktop thì chạy có giao diện (`headless: false`, `DISPLAY` của seat0); không có thì chạy headless và chụp ảnh. |
| Khung nhìn | Desktop **1366×768** (chính), **1280×800** (thanh sơ đồ một dòng), điện thoại **390×844** (`isMobile`, `hasTouch`). |
| Giao diện | Sáng (mặc định) và Tối: đổi qua menu tài khoản ở chân sidebar, hoặc `localStorage.ims_theme`. |
| Giờ | `Asia/Ho_Chi_Minh`. Lượt C có thêm một lần chạy với trình duyệt đặt `timezoneId: 'UTC'`. |
| Helper dùng lại được | `e2e/tests/helpers.ts`: `fillLogin`, `firstLogin`, `loginWithTotp`, `fillOtp`, `freshTotpCode`, `stepUpViaApi`, `writeHeaders`, `waitForMail`, `horizontalOverflow`, `diagramBarAction`, `clickDrawioCanvas`, `rowAction`, `confirmAction`. **Import để dùng, không sửa file này.** |

Agent viết script tạm trong scratchpad của phiên, không viết vào `e2e/tests/`.

### 1.2 Tài khoản QA

Mỗi lượt có bộ tài khoản riêng để không giẫm phiên, bộ đếm sai hay ân hạn mã của nhau:

| Lượt | SA | Admin | Member |
| --- | --- | --- | --- |
| A, B, C, D, E, F, Z | `e2e-tao-moi-qa-<x>-sa@pmh.com.vn` | `e2e-tao-moi-qa-<x>-admin@…` | `e2e-tao-moi-qa-<x>-member@…` |

`<x>` là chữ của lượt, viết thường. Có thêm `e2e-tao-moi-qa-d-member2@…` cho lượt D (một member
whitelist, một member cần duyệt).

Cách dựng (lượt 0):

1. Đăng nhập `e2e-sa@pmh.com.vn` / `E2e@Test#2026`. Nếu lần đầu thì đi `firstLogin` (cài 2 lớp
   rồi đổi mật khẩu) và **giữ chuỗi khoá TOTP**.
2. Vào **Người dùng IMS**, tạo từng tài khoản QA qua giao diện. Chính việc này là bài kiểm của
   ACC-01..03. Chép mật khẩu tạm trong hộp (tự che sau 60 giây).
3. Đăng nhập lần đầu từng tài khoản, cài 2 lớp, đổi mật khẩu.
4. Lưu `{email, password, totpSecret}` vào file `qa-accounts.json` trong scratchpad, quyền 600.
   **Không bao giờ ghi vào repo, chat hay báo cáo.**
5. Lượt D dựng thêm dữ liệu két: nhờ tài khoản SA của lượt D gán quyền két cho
   `qa-d-member` (whitelist) và `qa-d-member2` (cần duyệt) trên **nhóm của thiết bị QA**.

Dọn **sau khi đã sửa xong lỗi** (bước 7, xem §14): tài khoản `e2e-tao-moi-%` bị `reset-e2e.mjs users`
xoá hẳn. Tới lúc đó, giữ nguyên mọi tài khoản và hồ sơ QA: chúng là bằng chứng để tái hiện lỗi.

### 1.3 Ghi kết quả

```
scratchpad/qa/<lượt>/
  findings.md      # danh sách lỗi theo mẫu §12
  coverage.md      # mỗi mã kịch bản: ĐẠT / LỖI (mã lỗi) / CHƯA KIỂM (lý do)
  shots/<mã>-<bước>-<vai>-<khung>-<theme>.png
```

---

## 2. Ma trận vai: kiểm trước, rẻ mà bắt được nhiều lỗi

Mỗi vai đăng nhập rồi **vừa nhìn menu, vừa gõ thẳng URL, vừa gọi thẳng API ghi** (`fetch` có
`x-csrf-token`, dùng `writeHeaders`). Kết quả phải khớp ở cả ba chỗ.

| Đường | sa | admin | member | Ghi chú |
| --- | --- | --- | --- | --- |
| `/` Bảng điều khiển | ✔ | ✔ | ✔ | Member không có khối mở két toàn cục, khối két lâu chưa đổi; chỉ "Yêu cầu mở két của tôi". |
| `/devices`, `/devices/:id` | ✔ ghi | ✔ ghi | ✔ ghi | Không ai xoá được thiết bị, chỉ thanh lý. Xoá giấy tờ: sa/admin. Tab Két: chỉ ai có quyền két; ghi két: sa/admin. |
| `/admin/catalog` | ✔ đủ | ✔ đủ | tạo + sửa | Member không có Ngừng dùng, Xoá, Nhập Excel (Q-12). Model: member tạo được, không sửa/xoá/đổi ảnh. SVG biểu tượng loại: chỉ sa. |
| `/software`, `/domains`, `/maintenance`, `/services` | ✔ | ✔ | ✔ | Ghi két: sa/admin. Cột "Đổi lần cuối": sa/admin. |
| `/isp-lines` | ✔ | ✔ | ✔ | |
| `/service-accounts` | ✔ ghi | ✔ ghi | chỉ xem | |
| `/expiry` | ✔ | ✔ | xem + gia hạn | Luật thư: member chỉ xem và xem trước. |
| `/ip-addresses` | ✔ | ✔ | xem dải; cấp/sửa/thu hồi IP | Dải (thêm/sửa/ngừng/xoá) và Xoá hồ sơ IP: sa/admin. |
| `/nat` | ✔ | ✔ | thêm/sửa/ngừng | "Gỡ": sa/admin. |
| `/diagrams…` | ✔ | ✔ | vẽ, lưu, gửi duyệt nháp của mình | Phát hành, duyệt, đổi tên/lưu trữ bản chính thức, khôi phục, xoá vĩnh viễn: sa/admin. Không tự duyệt yêu cầu của chính mình. |
| `/disposal` | ✔ | ✔ | ✔ | Chỉ đọc. |
| `/vault` | ✔ | ✔ | Forbidden | Menu member không có mục Két sắt. |
| `/approvals` | 3 tab | 3 tab | chỉ "Yêu cầu của tôi" | `/approvals/:id` của người khác với member: 404. |
| `/admin/vault-access` | ✔ | ✔ | Forbidden | |
| `/admin/audit-log` | ✔ | ✔ | Forbidden | |
| `/admin/accounts`, `/admin/settings`, `/admin/failed-mail` | ✔ | Forbidden | Forbidden | |
| `/dev/components` | chỉ dev | ✘ | ✘ | Không được có trên bản build prod. |

| Mã | Kiểm | Kỳ vọng |
| --- | --- | --- |
| ROLE-01 | Mỗi vai × mỗi đường ở bảng trên, gõ thẳng URL | Đúng màn hoặc Forbidden ("Bạn không có quyền xem trang này"). Không lộ khung trống hay lỗi kỹ thuật. |
| ROLE-02 | Menu của từng vai | Không có mục dẫn tới Forbidden. Badge số (Hết hạn, Duyệt, Sơ đồ, Thư lỗi) chỉ hiện với vai được xem. |
| ROLE-03 | Nút ghi bị ẩn với member nhưng API vẫn mở? Gọi thẳng `POST/PATCH/DELETE` cho từng nút bị ẩn | 403. Nếu nhận 2xx thì là **S1**. |
| ROLE-04 | Admin gọi API chỉ dành cho sa (`/accounts`, `/system-config`, `/outbox…`) | 403. |
| ROLE-05 | Đổi vai một tài khoản QA từ member lên admin khi người đó đang mở app | Lần gọi kế tiếp phản ánh vai mới, hoặc phiên bị đóng. Không giữ quyền cũ (ghi rõ hành vi thấy được). |

---

## 3. Danh sách kiểm chung, áp cho MỌI màn

Mỗi lượt chạy danh sách này trên từng màn của mình. Lỗi ở đây thường là S3/S4, nhưng nhiều nhất.

| Mã | Kiểm | Kỳ vọng |
| --- | --- | --- |
| CHUNG-01 | Chữ | Toàn tiếng Việt có dấu đúng. Không có khoá i18n thô (`devices.form.x`), không còn chữ Anh ("Loading", "Submit", "undefined", "NaN", "[object Object]"). Thuật ngữ thống nhất: "Tủ mạng", "Phòng ban", "Ngừng dùng / Dùng lại", "Xin mở két / Duyệt mở két", "Đã thanh lý" (trạng thái) / "Thanh lý" (nút). |
| CHUNG-02 | 390px | `horizontalOverflow(page) === 0` ở **mọi màn đọc**. Bảng thành thẻ; nút không bị cắt; hộp thoại vừa màn; bàn phím ảo không che nút chính. Màn nhập phức tạp (import, sửa sơ đồ) chỉ cần desktop. |
| CHUNG-03 | Tối | Chữ đọc được (tương phản ≥ 4.5:1, viền ≥ 3:1). Badge trạng thái giữ đúng nghĩa màu (xanh = ok, cam = cảnh báo, đỏ = nguy, xám = đã ngừng). Không có mảng trắng chói. Ảnh/SVG theo `currentColor` vẫn thấy rõ. |
| CHUNG-04 | Trạng thái rỗng / đang tải / lỗi | Danh sách rỗng có câu giải thích + nút hành động (nếu vai được làm). Bộ lọc ra 0 dòng phải nói là do bộ lọc. Lỗi mạng (devtools offline) có câu tiếng Việt, không trắng trang. |
| CHUNG-05 | Hộp thoại | Esc đóng được (trừ lúc đang ghi). Focus nằm trong hộp, Tab không thoát ra ngoài. Không có `window.confirm`/`alert` của trình duyệt. Đóng xong focus về nút đã mở. |
| CHUNG-06 | Rời màn khi chưa lưu | Form đang sửa mà bấm menu / nút lùi / Ctrl+K / tải lại: hỏi giữ hay bỏ. Đã lưu rồi thì không hỏi. |
| CHUNG-07 | Bấm đúp, bấm nhanh | Bấm đúp "Lưu" không tạo hai bản ghi. Nút chuyển sang trạng thái đang làm. |
| CHUNG-08 | Kiểm tra form | Lỗi nằm ngay dưới ô, bằng tiếng Việt, không phải bong bóng của trình duyệt. Ô bắt buộc có dấu. Chữ trong ô được cắt khoảng trắng hai đầu. Chuỗi rất dài (300 ký tự), emoji, `<script>`, `' OR 1=1`, tiếng Việt tổ hợp: hiển thị đúng, không vỡ bố cục, không chạy mã. |
| CHUNG-09 | Ghi chú giống mật khẩu | `pass: Abc@1234`, `mat khau: …` trong ô Ghi chú/Mô tả/Lý do: bị chặn kèm câu giải thích (Q-19). |
| CHUNG-10 | URL | Bộ lọc, tab, trang nằm trên URL; F5 giữ nguyên; gửi link cho vai khác mở đúng chỗ (nếu được phép). Tham số rác (`?status=abc`) về mặc định, không lỗi. Tên tab trình duyệt đúng màn. |
| CHUNG-11 | Tìm | Gõ không dấu tìm ra có dấu ("thiet bi" → "thiết bị"). Ctrl+K tìm ra cả hồ sơ đã thanh lý. Dưới 2 ký tự có câu nhắc. |
| CHUNG-12 | Xuất Excel | File mở được, tên file tiếng Việt không dấu đúng màn, cột khớp bảng, đúng bộ lọc đang chọn, ngày theo giờ VN. Có dòng audit `*.exported`. |
| CHUNG-13 | Phân trang | Đổi bộ lọc thì về trang 1. Số đếm khớp. Trang cuối không thừa/thiếu dòng. |
| CHUNG-14 | Bàn phím | Đi hết màn bằng Tab có viền focus thấy được; Enter/Space bấm được nút; menu ⋮ mở bằng phím, mũi tên đi giữa mục, Esc đóng. |
| CHUNG-15 | Hai tab cùng sửa | Tab sau lưu thì nhận câu "vừa được người khác sửa", không ghi đè im lặng. |
| CHUNG-16 | Lịch sử và audit | Mỗi thao tác ghi tạo đúng một dòng lịch sử của hồ sơ, và một dòng ở Nhật ký hệ thống, đúng người làm, đúng giờ. |
| CHUNG-17 | Khoảng cách, hàng lối | Nút cùng hàng cùng cao, nhãn thẳng cột, không chữ đè chữ, không cuộn kép (hai thanh cuộn lồng nhau), không nháy thanh cuộn. Ghi kèm ảnh. |

---

## 4. Lượt A: Đăng nhập · Phiên · Hồ sơ · Shell · Bảng điều khiển · Nhật ký

Tài khoản: bộ `qa-a-*`. Không thử khoá tài khoản ở lượt này (để cho lượt Z).

| Mã | Vai | Bước | Kỳ vọng | Nguồn |
| --- | --- | --- | --- | --- |
| AUTH-01 | mới | Đăng nhập lần đầu bằng mật khẩu tạm | "Bước 1/2 Cài 2 lớp" (QR, "Sao chép khoá", "Mở trong ứng dụng xác thực"), rồi "Bước 2/2 Đổi mật khẩu tạm", rồi Bảng điều khiển. | Story 1.2, 1.3, Q-14 |
| AUTH-02 | mọi | Bỏ trống email/mật khẩu; email sai định dạng; email không tồn tại; sai mật khẩu | Lỗi dưới ô bằng tiếng Việt. Không tồn tại và sai mật khẩu dùng **cùng một câu** "Email hoặc mật khẩu không đúng." | Q-16 |
| AUTH-03 | mọi | Nút con mắt ở ô mật khẩu | Hiện chữ, tự che sau 10 giây hoặc khi rời ô. | Q-18 |
| AUTH-04 | mọi | Ô mã 6 số: dán `123 456`, Backspace, ←/→, gõ chữ | Dán đổ đủ 6 ô và tự gửi; chữ không nhận; sai thì ô bị xoá. | Q-24 |
| AUTH-05 | mọi | Dùng lại đúng mã vừa đăng nhập (đăng xuất rồi vào lại trong cùng 30 giây) | "Mã này đã được dùng". | SEC: TOTP replay |
| AUTH-06 | mọi | Ở bước mã, tải lại trang; chờ quá 5 phút | Về /login với câu "Hết thời gian nhập mã…" (`auth.totp_challenge_minutes` = 5). | |
| AUTH-07 | mọi | Gõ thẳng `/login/2fa` khi chưa qua bước mật khẩu | Về /login, không lỗi. | |
| AUTH-08 | mọi | Link sâu khi chưa đăng nhập: `/approvals/<id>`, `/devices/<id>?tab=ports` | Đăng nhập xong về đúng trang đó. `?next=//evil.com`, `?next=https://evil.com` bị bỏ qua. | |
| AUTH-09 | mọi | "Không lấy được mã?" ở bước mã | Hiện thông tin liên hệ (`auth.support_contact`). Không có "Quên mật khẩu", không có mã dự phòng (đúng thiết kế). | Q-14, Q-18 |
| AUTH-10 | mọi | Màn đăng nhập ở 390px | Không có ảnh nền (≤720px), chỉ thẻ có logo; bàn phím ảo không che nút. | |
| SESS-01 | mọi | Hai tab; đăng xuất ở tab A rồi bấm bất kỳ ở tab B | Tab B về /login. Nút lùi sau khi đăng xuất không hiện dữ liệu cũ. | |
| SESS-02 | mọi | Máy dùng chung: phiên của A hết, B đăng nhập trên cùng trình duyệt | B về trang chủ, **không** vào trang dở của A. | |
| SESS-03 | mọi | /profile → Phiên của tôi: đóng một phiên khác; "Đăng xuất các máy khác" | Phiên kia chết ngay ở lần gọi kế tiếp; phiên hiện tại sống. | Story 1.4 |
| PROF-01 | mọi | Đổi mật khẩu: 11 ký tự, 12 ký tự chỉ 2 nhóm, 12 ký tự đủ 3 nhóm, hai ô lệch | Bảng kiểm từng nhóm sống theo từng ký tự gõ; chỉ ca đủ điều kiện qua. Đổi xong, máy khác bị đăng xuất; có thư trong Mailpit. | Story 1.2 |
| PROF-02 | mọi | "Cài lại trên điện thoại mới" | Cần mật khẩu + mã của điện thoại cũ; xong thì mã cũ hết dùng được; có thư. | |
| PROF-03 | mọi | Giao diện Sáng/Tối/Theo hệ thống; Hiệu ứng chuyển động | Đổi ngay, nhớ sau F5; tắt hiệu ứng thì không còn chuyển động. | |
| SHELL-01 | mọi | Sidebar 1366×768 với SA | Nhóm "Hệ thống" khép mặc định, mở khi đang ở màn trong nhóm, nhớ trạng thái. Khi khép, menu SA vừa màn **không cuộn**. Topbar ghi tên nhóm, không lặp tên màn. | Q-18..Q-20 |
| SHELL-02 | mọi | 390px: nút menu → drawer | Đóng được bằng nền tối hoặc Esc; chọn mục thì tự khép; Tìm nhanh nằm trong drawer. | |
| SHELL-03 | mọi | Ctrl+K: gõ 1 ký tự, mã thiết bị, IP, tên dải, tên sơ đồ, tên màn | Dưới 2 ký tự có câu nhắc; nhóm kết quả đúng; Enter mở đúng chỗ; "Mở gần đây" có mục vừa xem. Đang mở hộp thoại thì Ctrl+K không mở. | |
| SHELL-04 | mọi | URL cũ `/quan-tri/...`, `/phan-mem/...` | Tự chuyển sang đường mới. | |
| SHELL-05 | mọi | URL không tồn tại | Màn "Không tìm thấy" tiếng Việt, có đường về. | |
| DASH-01 | sa / member | Bảng điều khiển: so số trên từng ô với màn gốc (Hết hạn, Dải ≥80%, Két lâu chưa đổi, Yêu cầu mở két 7 ngày, Vừa thanh lý 7 ngày) | Số khớp màn gốc. Bấm ô dẫn tới màn gốc đã lọc sẵn. Mỗi khối tối đa 8 dòng. Member không thấy khối toàn cục của két. | Story 7.1 |
| DASH-02 | sa | Có yêu cầu chờ (tạo ở lượt D) | Khối "Cần bạn duyệt (n)" ở đầu trang. | |
| DASH-03 | mọi | Nút "Làm mới"; để yên 5 phút | Làm mới khi bấm; không tự làm mới (đúng thiết kế, Q-15). | |
| AUD-01 | admin | Nhật ký: lọc theo người làm, hành động, loại đối tượng, "chỉ sự kiện bảo mật", khoảng ngày; khoảng ngày ngược | Lọc đúng, lọc nằm trên URL; khoảng ngược có câu báo. Gộp dòng lặp / xem từng dòng. Hộp chi tiết đọc được, **không chứa giá trị bí mật**. | Story 1.4, Q-16 |
| AUD-02 | admin | Nhật ký 390px | Chạm một dòng mở chi tiết dạng sheet. | |

---

## 5. Lượt B: Thiết bị · Danh mục · Model · Cổng · Giấy tờ · Import/Export · Thanh lý

Tài khoản `qa-b-*`. Lượt này tự dựng: 1 site `QA-E2E-B-SITE`, 2 tủ `QA-E2E-B-TU1` (42U) và
`QA-E2E-B-TU2` (12U), loại `QA E2E Switch` (có sơ đồ cổng), model `QA-E2E-SW48` (1U, cổng mẫu
`Gi1/0/[1-48]` + `Te1/1/[1-4]`), vài máy `QA-E2E-B-SW01…`. Lượt E và F dùng lại các tủ/máy này
nhưng không sửa chúng.

| Mã | Vai | Bước | Kỳ vọng | Nguồn |
| --- | --- | --- | --- | --- |
| CAT-00 | mọi | Menu và màn Danh mục (Q-27): mở nhóm **Tài sản**; mở Danh mục; mở link cũ `/catalog?tab=vendor` | Danh mục đứng **đầu** nhóm Tài sản (không còn ở Hệ thống). 9 tab gom 3 nhóm *Vị trí* / *Thiết bị* / *Đối tác & tổ chức*; thẻ "Khai trước khi thêm thiết bị" nói đủ / còn thiếu (vd model chưa có ảnh) — lúc đang tải ghi "…", không nháy viền cam; tab Model thiết bị có số như các tab khác. Thanh tab dài hơn màn: mép mờ + mũi tên tròn để cuộn (máy tính). Link `?tab=` cũ mở đúng tab. Ở 1366×768 menu không bị cắt. | Q-27 |
| CAT-01 | member | Tạo site, tủ, loại, nhà cung cấp, phòng ban, nhà mạng, dịch vụ/port, loại dây | Tạo + sửa được. Không thấy Ngừng dùng / Xoá / Nhập Excel; câu rỗng hợp với member. | Q-12 |
| CAT-02 | sa | Mã trùng khác hoa-thường (`qa-e2e-b-site`); tủ trùng mã trong cùng site; cùng mã ở site khác | Hai ca đầu bị chặn ("Site này đã có tủ mang mã đó"); ca cuối được. | Story 2.1 |
| CAT-03 | sa | Xoá mục đang dùng; dời tủ còn máy sang site khác | `CATALOG_IN_USE` kèm gợi ý "Ngừng dùng"; `CABINET_HAS_DEVICES`. | |
| CAT-04 | sa | Số U tủ 0, 1, 60, 61; port dịch vụ 0, 65535, 65536, dải ngược | Biên đúng 1–60 và 1–65535; dải ngược bị báo. | |
| CAT-05 | sa | Số điện thoại `+84 (28) 123-456.7` | Nhận; lưu chỉ còn chữ số. | |
| CAT-06 | sa | Nhập danh mục từ Excel: tải file mẫu → thêm dòng lỗi (tủ trỏ site không có, mã trùng) → nhập | Bảng xem trước báo theo từng dòng; không ghi gì cho tới khi xác nhận; lỗi thì không ghi dòng nào. | Story 2.6 |
| CAT-07 | mọi | "đang dùng ở N" của một mục | Link sang danh sách thiết bị đã lọc đúng N máy. Lịch sử mục ghi đúng. | |
| MOD-01 | member | Tạo model `QA-E2E-SW48`; rồi gõ `qa e2e sw48` / `QA_E2E.SW48` | Ca sau báo "Đã có…" kèm "Dùng model này" (khoá chuẩn hoá). Member không có Sửa/Xoá trong ⋮. | Story 11.1 |
| MOD-02 | sa | Cổng mẫu: `Gi[1-300]` (vượt 256), `Port[8-1]`, tên trùng giữa hai nhóm, tên 61 ký tự | Bị chặn với câu rõ ràng. Xem trước "Sinh n cổng" đúng. | Story 11.3 |
| MOD-03 | sa | Sửa cổng mẫu của model đã có máy (thêm `MGMT`) | Mọi máy cùng model được **thêm** cổng còn thiếu; không xoá/đổi tên cổng có sẵn. | Q-26 07/10 |
| MOD-04 | sa | Đổi Số U của model khi có máy trong tủ sẽ bị chồng U | Bị chặn trước khi ghi, nêu máy chồng. | |
| MOD-05 | sa | Xoá model còn máy dùng | 409 nêu số máy. | |
| DEV-01 | member | Thêm thiết bị: thiếu Mã/Tên/Loại; mã trùng khác hoa-thường; serial trùng | Hai ca đầu bị chặn; serial trùng **chỉ cảnh báo**, vẫn lưu. | Story 2.2 |
| DEV-02 | member | Chọn model `QA-E2E-SW48` → chọn tủ | Loại bị khoá theo model; ô U liệt kê "U trống:" đủ 1U; ảnh tự điền. Model không gắn tủ thì ẩn Tủ/U. | Story 11.2 |
| DEV-02b | member | Form Thêm thiết bị (Q-27): thứ tự ô và các khối gập | Hai khối luôn mở: *Máy gì* (Model đầu tiên, gợi ý có **ảnh thu nhỏ**; chọn xong hiện ảnh mặt trước) và *Đặt ở đâu*. Năm khối gập (Người dùng và phòng ban · Mua sắm và bảo hành · Truy cập quản trị · Ảnh và giấy tờ · Ghi chú) có đếm cùng một kiểu ("chưa khai" khi trống, "1/5 ô", "2 Đường", "1 Tệp"); Sửa máy thì khối đã có giá trị mở sẵn. Lỗi trong khối gập (vd ghi chú trông như mật khẩu) phải tự mở khối và chỉ ra ô. Không mất trường nào so với trước. Tiêu đề hộp có nhãn "Thiết bị". | Q-27 |
| DEV-03 | member | U: U = chiều cao tủ (vừa khít), vượt 1; chồng U; chỉ điền một trong hai ô U; tủ thuộc site khác; đổi site trên form | Vừa khít được; vượt có câu "U.. vượt tủ X (12U)"; chồng nêu máy đang chiếm; đổi site thì tủ bị xoá khỏi ô. | |
| DEV-04 | member | Model 2U trên tủ chỉ còn khe 1U | "Tủ không còn khe trống đủ 2U". | |
| DEV-05 | member | Bảo hành đến < bảo hành từ; ngày 29/02 năm không nhuận | Bị chặn. | |
| DEV-06 | member | "Lưu và nhân bản"; ⋮ "Nhân bản" | Bản sao không mang Mã (hoặc bắt nhập mã mới), không mang IP/U trùng. | |
| DEV-07 | mọi | Danh sách: lọc site → tủ (đổi site thì xoá lọc tủ), loại, trạng thái, phòng ban; tìm theo serial, IP, người dùng | Đúng; máy thanh lý ẩn mặc định, lọc `Đã thanh lý` mới thấy. Cột (Q-27): ▸ · Ảnh (ảnh model, không có thì ảnh riêng / chữ loại) · Mã · Tên gọi · IP quản trị (chưa có IP là "—") · Vị trí · Trạng thái · Thao tác. Bung ▸ ra license đang cài dạng thẻ tách nhau, tiêu đề cột in đậm. Chip "Xóa lọc (n)" gỡ hết lọc. | Q-20, Q-27 |
| DEV-08 | mọi | Chi tiết (Q-27): dải 4 ô đầu trang, Thông số, cột phải, bản đồ quan hệ, "Có trên sơ đồ (n)", chip "Đang giữ…" (390px) | Dải 4 ô **thấy ở mọi tab**: Vị trí (kèm U) · Người sử dụng (kèm phòng ban, trống là "chưa gán người") · IP quản trị (nút chép **ngay sau IP** + Đổi IP; chưa có thì "chưa cấp IP" + nút **Cấp IP**) · Bảo hành (còn bao lâu, khoảng ngày, thanh thời gian gọn). Trạng thái nằm dưới tiêu đề kèm "từ ngày…". **Một thông tin chỉ nói một lần** (Q-27 bổ sung 10/10): Thông số **luôn đủ 9 dòng cùng thứ tự** (Loại thiết bị, Model, Serial, Số U, Truy cập quản trị, Nhà cung cấp, Ngày mua, Phòng ban, Ghi chú — không lặp Bảo hành); ô trống ghi "chưa khai", nút "Bổ sung N ô còn thiếu" đứng **bên phải tiêu đề Thông số** và mở Sửa hồ sơ. Cột phải: "Trong tủ T-x" (khúc ±4U, máy này tô viền cam, U trống gộp) + Nhà cung cấp (người liên hệ, số gọi bấm được, ngày tạo / sửa). Khu "Hình dùng trên sơ đồ" **gập sẵn**, dòng tiêu đề nói mặt trước / mặt sau đang dùng ảnh gì, (i) giải thích. Máy tính: khu Địa chỉ IP / NAT / Đường truyền **gập sẵn**, bấm ô tương ứng trên bản đồ quan hệ thì khu đó mở và cuộn tới. "Có trên sơ đồ" là hàng chip, không có chấm đầu dòng. Số trên bản đồ / chip khớp nội dung; link đi đúng. 390px: dải một cột "nhãn \| giá trị", thông số một cột, cột phải thu vào "Chi tiết" với dòng tóm tắt "Trong tủ … · Nhà cung cấp" (không kèm hạn), khu IP / NAT mở sẵn; thanh tab cuộn ngang có mép mờ. | Story 2.5, Q-27 |
| DEV-10 | member | Tab **Phần mềm** của máy: "Gán phần mềm vào máy này" → gõ tìm license → chọn | Hộp chọn chỉ ra license **đang dùng** (không ra hồ sơ thanh lý); chọn xong mở đúng hộp "Gán license vào máy — <mã>" với máy này đã nằm sẵn. Gán xong bảng trong tab có dòng mới, số trên tab tăng. Máy thanh lý: không có nút gán. Bản đồ quan hệ ô Phần mềm bấm → sang tab này. | Q-27 |
| DEV-09 | mọi | Truy cập quản trị: 11 dòng; địa chỉ có khoảng trắng, bắt đầu bằng `-`; cổng 0/65536; Web với `javascript:alert(1)` | Tối đa 10 dòng; các ca xấu bị chặn; chỉ http(s) thành link; SSH có "Chép lệnh". Không có ô mật khẩu. | |
| PORT-01 | member | Tab Sơ đồ cổng: nối `SW01:Gi1/0/1` ↔ `SW02:Gi1/0/1`; nối lại cổng đó với máy thứ ba; `gi1/0/1` khác hoa-thường; tự nối vào chính mình; nối sang máy thanh lý | Một cổng một cáp (kiểm cả hai chiều, không phân biệt hoa-thường); các ca xấu bị chặn với câu nêu cổng/máy đang chiếm. | Story 2.4 |
| PORT-02 | member | VLAN: trống, `trunk`, `TRUNK`, 0, 1, 4094, 4095 | Nhận trống/trunk/1–4094. | |
| PORT-03 | member | Bỏ cổng đang có dây; ⋮ "Gỡ dây (giữ cổng)" | Ca đầu bị chặn "gỡ dây trước"; ca sau hỏi xác nhận, máy đầu kia cũng mất dây. | |
| PORT-04 | mọi | Lưới "Mặt cổng": "Hiện cả cổng trống (n)", bấm ô; khu "Đang cắm vào thiết bị này" | Ô có chữ (không chỉ màu); bấm ô thấy đầu kia; 390px lưới xuống dòng. | Story 11.3 |
| FILE-01 | member | Giấy tờ: tải 7 file một lượt; file 25,1 MB; `.exe` đổi tên `.pdf`; `.docx` thực chất có macro; jpg/png/pdf/docx/xlsx hợp lệ | Tối đa 6/lượt, 25 MB; hai ca giả mạo bị chặn theo **nội dung**; file hợp lệ tải về là attachment, không mở trong tab. | Story 2.3 |
| FILE-02 | member / admin | Xoá giấy tờ | Member không có nút (và API 403); admin xoá được, có lịch sử. | |
| FILE-03 | member | Form Thêm thiết bị: đính kèm nháp rồi Huỷ form | Không còn file mồ côi gắn vào máy nào. | |
| IMP-01 | member | Nhập từ Excel: tải mẫu → thêm dòng: mã trùng trong file, ngày `30/08/2026` và `2026-08-30`, loại chưa có, tủ không thuộc site, chồng U trong file và với DB, trạng thái `Đã thanh lý`, dòng VÍ DỤ | Bảng xem trước báo từng dòng bằng tiếng Việt; dòng VÍ DỤ bị bỏ; không có gì ghi trước khi xác nhận. | Story 2.6 |
| IMP-02 | member | Nhập lại cùng mã với 1 ô đổi | Thành cập nhật; lịch sử chỉ ghi ô đổi. | |
| IMP-03 | member | File không phải xlsx; file 0 dòng; sheet đổi tên cột theo alias ("Bộ phận") | Câu lỗi rõ; alias được nhận. | |
| RET-01 | member | Thanh lý máy còn IP + NAT + license + ISP + dây từ máy khác, chọn "Chỉ thanh lý" | 409 liệt kê đích danh từng thứ đang giữ. | Story 2.2, Q-20 |
| RET-02 | member | "Gỡ hết rồi thanh lý": gõ sai mã; gõ đúng mã khác hoa-thường | Sai: không cho; đúng: IP về Trống, NAT gỡ, ghế license trả, gỡ khỏi đường truyền, dây máy khác trỏ tới bị gỡ. Két, giấy tờ, cổng của chính máy **giữ nguyên**. Banner "Thanh lý lúc… bởi…". | |
| RET-03 | member | Sau thanh lý: thử cấp IP, gán license, NAT, ISP, cổng tới máy này | Mọi nơi chặn. Máy không còn trong "Thiết bị kho" của sơ đồ. | |
| RET-04 | member | ⋮ "Đổi trạng thái" về Đang dùng khi chỗ U cũ đã có máy khác | Chặn và nêu máy đang chiếm; còn chỗ thì về được, hạn bảo hành vào lại thư nhắc. | Q-20 |
| RET-05 | mọi | Trạng thái Dự phòng / Hỏng | Chỉ là nhãn: giữ IP, giữ license, vẫn nhắc hạn. | Q-20 |
| DISP-01 | mọi | Kho thanh lý: lọc loại, Tháng/Quý/Năm nay, Từ–Đến, sắp xếp; ⋮ "Mở hồ sơ để dùng lại"; phần mềm có "Khôi phục" | Có đủ 4 loại hồ sơ; "Người thanh lý" là "Hệ thống · tự thanh lý khi quá hạn" với phần mềm tự động; xuất Excel đúng bộ lọc. | Q-19 |

---

## 6. Lượt C: Phần mềm (4 màn) · License · Gia hạn · Hết hạn · Thư tổng hợp · ISP · Tài khoản dịch vụ

Tài khoản `qa-c-*`. Dùng máy của lượt B để gán ghế, **chỉ gán/gỡ ghế, không sửa máy**.

| Mã | Vai | Bước | Kỳ vọng | Nguồn |
| --- | --- | --- | --- | --- |
| SW-01 | member | Tạo 1 hồ sơ ở mỗi màn: license thuê bao, license vĩnh viễn, SSL, domain, bảo trì, "Khác" | Ô bắt buộc theo loại: thuê bao/SSL/domain phải có hạn; vĩnh viễn **không được** có hạn và không có nút Gia hạn; bảo trì/Khác tuỳ. | Story 3.1, Q-22 |
| SW-02 | member | SSL: tên miền `https://QA-E2E.pmh.com.vn/`, trùng, hai tên trên một dòng, 201 tên | Tự bỏ `https://` và `/`, hạ chữ thường, bỏ trùng; hai tên một dòng lỗi; trần 200. Tìm được theo bất kỳ tên nào. | |
| SW-03 | member | Ngày hết hạn trước ngày bắt đầu; tạo với hạn hôm qua; hạn hôm nay; hạn mai | Ca đầu chặn; hôm qua → **Hết hạn** ngay; hôm nay → Đang dùng + "Hết hạn hôm nay"; mai → "Còn 1 ngày". | Q-03 |
| SW-04 | member | Hạn còn đúng 7, 8, 30, 31 ngày | 7 = đỏ, 8 và 30 = cam, 31 = xanh (so sánh ≤). Màu khớp ở danh sách, chi tiết, màn Hết hạn, bảng điều khiển; cả sáng và tối. | |
| SW-05 | member | Tạo với hạn **31 ngày trước**, chờ sweep (khoảng 1 phút, F5) | Thành **Đã thanh lý**, người làm `system`, mọi ghế bị gỡ, mỗi ghế một dòng lịch sử. Hạn 30 ngày trước: vẫn Hết hạn + "tự thanh lý sau N ngày". | Q-13 |
| SW-06 | member | Sửa hạn của hồ sơ Hết hạn sang tương lai | Tự về Đang dùng. | |
| SW-07 | member | Form Thêm phần mềm (Q-27): bố cục, ô tick "Mỗi ghế có hợp đồng, giấy tờ và ghi chú riêng" | Hàng 1 Tên · Mã · Nhà cung cấp; hàng 2 Kỳ hạn · Bắt đầu · Hết hạn. Không có ô Chi phí. Tick **khoá** khi Số ghế trống hoặc 1; bớt xuống dưới 2 thì tick tự tắt. Không tick: có *Số hợp đồng / PO*, *Ghi chú*, *Giấy tờ* chung. Tick: bảng Ghế 1…N (hợp đồng, ghi chú, giấy tờ từng ghế), ô ghi chú và giấy tờ chung **biến mất**; "Chép số hợp đồng của ghế 1…" chép xuống. Ghi chú ghế trông như mật khẩu bị chặn tại ô. Giấy tờ chọn cho ghế lúc thêm mới phải nằm đúng ghế sau khi lưu. | Q-27 |
| SW-08 | member | "Lưu rồi gán vào máy"; menu ⋮ "Mua thêm đợt mới…" | Lưu rồi gán: sang trang hồ sơ, tab Máy đang dùng, hộp Gán mở sẵn. Mua thêm đợt: form điền sẵn tên / NCC / kỳ hạn của đợt trước, kể các đợt cùng tên, nút "Dùng mã …-02" gợi mã chưa ai dùng; lưu xong trang hồ sơ có thẻ "Mua theo đợt" nối các đợt. | Q-27 |
| SW-09 | mọi | Trang chi tiết phần mềm (Q-27) | Dải 4 ô (Nhà cung cấp · Hết hạn kèm khoảng ngày và thanh thời gian gọn · Ghế hoặc Tên miền · Hợp đồng / PO hoặc Giấy tờ) thấy ở mọi tab; trạng thái là huy hiệu **dưới mã**, dòng đó không nhắc lại nhà cung cấp. Tab đầu tên **Tổng quan**; khu Thông tin chỉ có thứ dải 4 ô chưa nói (Kỳ hạn / Loại, Bắt đầu khi không có ngày hết hạn, Ghi chú), ô trống "chưa khai". **Không còn thẻ "Thẻ định danh"**: hồ sơ không có nhiều đợt mua / tên miền thì trang một cột. Hồ sơ ghế riêng: Hợp đồng ghi "Riêng từng ghế (n)". Tab Máy đang dùng: dưới mã máy ghi "người dùng: …" (có nhãn). | Q-27 |
| LIC-01 | member | License 2 ghế: gán máy 1, máy 2, máy 3 | Máy 3 bị chặn "đã dùng hết 2 ghế"; ghi lý do → "Gán vượt ghế"; cảnh báo "Đang vượt số ghế: 3/2"; lý do vào lịch sử. | Story 3.2 |
| LIC-02 | member | Gán trùng máy; gán vào hồ sơ đã thanh lý; hạ tổng ghế dưới số đang dùng; nút "−" | Chặn đủ; "−" dừng ở max(1, đang dùng). | Q-24 |
| LIC-03 | member | Chọn nhanh máy theo phòng ban / người dùng | Bỏ qua máy đã có license đó. | |
| LIC-04 | member | Chi phí ghế (ở **Sửa ghế**, hộp Gán không còn ô chi phí — Q-27): `5,6tr`, `-1`, `abc` | `5,6tr` → 5 600 000; âm và chữ bị chặn. Sửa ghế không có ô Hợp đồng; số hợp đồng cũ của ghế vẫn hiện, không bị xoá. | Q-27 |
| LIC-05 | member | License 3 ghế **có tick ghế riêng**: gán 2 máy một lượt; đổi ghế trong bảng "Máy vào ghế nào"; chọn trùng ghế; bớt Số ghế xuống dưới ghế đang có máy; tắt tick | Bảng gợi ý ghế trống theo thứ tự, đổi được; trùng ghế bị chặn. Tab Máy đang dùng ghi "Ghế n" dưới mã máy và có khu "Ghế còn trống". Bớt ghế đang có máy: chặn ("ghế đang có máy"). Tắt tick: máy rời ghế, số hợp đồng / ghi chú ghế vẫn giữ (bật lại thì máy về ghế). Lịch sử có "Sửa ghế riêng". | Q-27 |
| REN-01 | member | Gia hạn: mốc +1/6/12/24/36 tháng; từ 31/01 +1 tháng; từ 29/02/2028 +12 tháng; hạn mới = hạn cũ; lùi về quá khứ | Tính từ hạn cũ (hoặc từ hôm nay nếu đã quá hạn); 31/01 → 29/02 (năm nhuận) hoặc 28/02; 29/02/2028 → 28/02/2029; hai ca cuối bị chặn. | Story 3.4 |
| REN-02 | member | Gia hạn có ghế hết hạn trong khoảng [hạn cũ, hạn mới) | Có tick kéo ghế theo; toast nêu số ghế; "Xem trong Đã gia hạn" mở đúng tab. | |
| REN-03 | member | Gia hạn từ trang chi tiết và từ màn Hết hạn | Tab "Đã gia hạn" có cả hai, cùng nhãn, đủ người làm / hợp đồng / chi phí. | |
| REN-04 | member | Hồ sơ đã thanh lý: Gia hạn; Khôi phục với hạn hôm qua / hôm nay; tick nhiều máy hơn số ghế | Gia hạn bị chặn; Khôi phục: hôm qua chặn, hôm nay được; tick vượt ghế bị chặn. | |
| EXP-01 | member | Màn Hết hạn: ô KPI, cửa sổ 7…365 / Tháng này / Quý này / Tới ngày…, chip loại, "Ẩn mục đã quá hạn" | Số khớp; bộ lọc trên URL; `?withinDays=abc` về 30. **Không có đường truyền ISP** trong danh sách. | Q-04 |
| EXP-02 | member | Gia hạn theo lô (+1 năm) có lẫn bảo hành thiết bị | Bảo hành không gia hạn được ở đây, có câu giải thích. | |
| EXP-03 | — | Chạy lại SW-03, SW-04, EXP-01 với trình duyệt đặt `timezoneId: 'UTC'`, vào lúc 0–7 giờ sáng giờ VN nếu được | Số ngày và màu **không lệch** so với giờ VN. Lệch là S2. | |
| DIG-01 | sa | Luật thư tổng hợp `QA E2E luật`: không người nhận + đang chạy; email sai; thứ 0/8; ngày 29; giờ 24 | Chặn tại ô; biên 1–7, 1–28, 0–23. | Story 3.5 |
| DIG-02 | sa | "Xem trước" và "Gửi thử → Chỉ gửi cho tôi" | Thư trong Mailpit có tiền tố "[Gửi thử]", một thư gom nhiều mục, nút "Mở màn Sắp hết hạn" dẫn đúng; **phần mềm ở trạng thái Hết hạn không có trong thư**; gửi thử không đụng kỳ gửi thật ("lần gửi tới" không đổi). | |
| DIG-03 | member | Màn luật thư | Chỉ xem và xem trước; không có tạo/sửa/xoá/gửi thử; API 403. | |
| DIG-04 | sa | Luật lọc đúng một loại không có mục nào | Không sinh thư rỗng. | |
| ISP-01 | member | Tạo đường `QA-E2E-C-ISP1`: IP WAN 17 cái, dải `/24`, trùng trong cùng đường, trùng với đường khác | Trần 16; không nhận dải; trùng trong đường bị chặn; trùng giữa các đường thì được. | Q-20 |
| ISP-02 | member | Gắn thiết bị không phải router | Chỉ cảnh báo. Trang thiết bị đó hiện ngược lại đường truyền. | |
| ISP-03 | member | Đi hết vòng trạng thái: Đang dùng → Tạm ngưng → Dùng lại → Thanh lý → Dùng lại | Đúng các bước được phép; băng "Đã thanh lý ngày… bởi…"; hộp Thanh lý nêu số ngăn két và thiết bị đang gắn. **Không có ngày kết thúc / nhắc hạn**. | Q-04 |
| ISP-04 | mọi | Trang chi tiết đường truyền (khuôn C) ở máy tính và 390px | Trạng thái dưới mã; dải 4 ô Hotline · IP WAN · Thiết bị (tên · model · IP LAN, link "Luật NAT trên thiết bị này") · Số hợp đồng; ô trống ghi "chưa khai". Không còn "Thẻ định danh" / thẻ "Khi mất mạng". Tab **Tổng quan** có Thông số (Tốc độ gói cước, Site, Bắt đầu, Ghi chú) + "Bổ sung n ô". Bấm hotline gọi được (`tel:`); chép IP WAN, IP LAN, số hợp đồng chạy. "Sửa hồ sơ" hiện cả ở 390px. | Q-27 |
| SA-04 | mọi | Trang chi tiết tài khoản dịch vụ (khuôn C) | Trạng thái + loại dưới mã (đã ngừng dùng thì chỉ băng cảnh báo nói); dải 4 ô Tên đăng nhập (có nút chép) · Người phụ trách (bộ phận dòng nhỏ) · Hết hạn · Dải IP được phép (VPN, "Mọi IP" cam) hoặc Giấy tờ (dùng chung). Khu Thông tin: Nhóm VPN, Ghi chú, Khai bởi. Ở 390px email không bị bẻ giữa chữ. | Q-27 |
| SA-01 | admin | Tài khoản dịch vụ: loại Dùng chung mà điền Nhóm VPN / Dải IP; VPN với dải `/8`; mật khẩu nhập trong form tạo | Ca đầu lỗi; `/8` chỉ cảnh báo; mật khẩu đòi mã 6 số rồi vào két (nhãn ngăn có `E2E`); bỏ bước mã thì hồ sơ vẫn đã tạo, có câu nói rõ chưa cất mật khẩu. | Q-11 |
| SA-02 | admin / member | Ngừng dùng / Dùng lại (phải có lý do); member mở màn | Có lý do mới cho; member chỉ xem, không nút ghi, API 403. | |
| SA-03 | admin | Hạn tuỳ chọn đã qua | Có trên màn Hết hạn và trong thư; **không** tự ngừng dùng. | |

---

## 7. Lượt D: Két · Quyền két · Xin / Duyệt mở két · Mã phạm vi

Tài khoản `qa-d-sa`, `qa-d-admin`, `qa-d-member` (whitelist), `qa-d-member2` (cần duyệt), cộng một
member **không** được gán gì (`qa-d-member3`). Chủ thể két là thiết bị `QA-E2E-D-FW01` và phần mềm
`QA-E2E-D-LIC01` do lượt này tạo. Mọi nhãn ngăn có `E2E`.

| Mã | Vai | Bước | Kỳ vọng | Nguồn |
| --- | --- | --- | --- | --- |
| VLT-01 | admin | Tạo ngăn mật khẩu và ngăn "Mã 2 lớp" cho `QA-E2E-D-FW01`; ghi chú giống mật khẩu | Ghi két đòi mã 6 số; ghi chú giống mật khẩu bị chặn. | Story 4.1 |
| VLT-02 | admin | Mới đăng nhập (mã đăng nhập vừa nhập) → Xem | **Vẫn hỏi mã**: mã đăng nhập không mở két. Hộp nhỏ "Nhập mã 6 số để xem" → đúng mã thì chính hộp hiện giá trị, có vòng đếm giây (60) và "m:ss" ân hạn. | Q-21, Q-24 |
| VLT-03 | admin | Trong ân hạn xem ngăn khác; chuyển tab trình duyệt sang tab khác 70 giây rồi quay lại | Ngăn khác mở thẳng; hộp đang hiện giá trị tự đóng ngay khi quay lại. | |
| VLT-04 | admin | Nút Sao chép | Giá trị vào clipboard chỉ khi bấm. Ngăn "Mã 2 lớp" hiện chuỗi, QR, mã hiện tại. | Q-24 |
| VLT-05 | admin | Mở sơ đồ bằng mã (lượt F) rồi xem két, và ngược lại | Mã phạm vi này không mở phạm vi kia. | Story 10.1 |
| VLT-06 | admin | Gõ sai mã 5 lần ở hộp két | Phiên bị thu hồi (không khoá tài khoản), về /login với câu giải thích. **Làm bằng tài khoản QA**. | |
| VLT-07 | admin | Đổi giá trị (xoay); thu hồi ngăn | Có cảnh báo "phải đổi trên hệ thống thật trước"; ngăn thu hồi không mở lại được bằng id cũ. Cột "Đổi lần cuối" cập nhật. | |
| VLT-08 | admin / member | `/vault` | Admin: danh sách **chủ thể** (không tên ngăn, không giá trị), chip lọc loại chọn nhiều; member: Forbidden, không có mục menu. | |
| VLT-09 | admin | Cột "Đổi lần cuối" ở Thiết bị, 4 màn phần mềm, Đường truyền, Tài khoản dịch vụ | Có với admin; member không có cột, API `/vault/owners/due` 403. | |
| ACL-01 | admin | Quyền két → Theo người: gán `qa-d-member` "Xem thẳng" trên nhóm của máy QA; `qa-d-member2` "Cần duyệt" | Gán/gỡ đòi mã 6 số; thẻ gom theo nhóm; "+ Gán quyền" chọn nhiều nhóm; `?user=` mở đúng người. SA/Admin ở khối "Có toàn quyền theo vai". | Story 6.2 |
| ACL-02 | admin | Tab "Ma trận" ở màn rộng; 390px | Bấm ô mở hộp; 390px chỉ hiện một nửa có nút quay lại, admin dùng được. | |
| ACL-03 | member / member2 / member3 | Mở tab Két của máy QA | member: thấy tên ngăn + ghi chú, Xem → mã → mở, **không có nút ghi**; member2: thấy tên ngăn, không thấy ghi chú, có "Xin mở két"; member3: 403, không xin được. | Story 6.2 |
| ACL-04 | admin + member | Tab A (admin) gỡ quyền của member; tab B (member) bấm Xem ngay, khi còn ân hạn | 403 ngay, không chờ hết ân hạn. | |
| BG-01 | member2 | "Xin mở két": lý do, số giờ 200 | Số giờ bị kẹp về trần (24), không báo lỗi khó hiểu; khung nói đã báo bao nhiêu người duyệt. Gửi lần nữa: 409 `BREAK_GLASS_PENDING` có câu tiếng Việt. | Story 6.3 |
| BG-02 | — | Mailpit | Thư "[IMS] Duyệt: …" tới **mọi SA/Admin trừ người xin**; ghi mã + tên đối tượng + số giờ, **không có tên ngăn**; link trỏ đúng phiếu. | |
| BG-03 | admin, 390px | Mở link trong thư khi chưa đăng nhập | Đăng nhập xong về đúng phiếu. Người xin, đối tượng, lý do, thời hạn hiện đủ không cần cuộn; thanh dính đáy: Từ chối trái (viền đỏ), Duyệt phải. | |
| BG-04 | admin | Duyệt: chạm 1 lần; chạm 2 lần trong 3 giây; rút ngắn số giờ; kéo dài hơn số đã xin; gõ chữ vào ô giờ | Phải chạm 2 lần; đòi mã nếu hết ân hạn; rút ngắn được, kéo dài không; chữ có lỗi tiếng Việt dưới ô. | |
| BG-05 | member2 | Sau khi được duyệt: Xem ở trình duyệt A; rồi thử ở cửa sổ ẩn danh B (đăng nhập lại) | A mở được, có đếm lùi; B nhận `BREAK_GLASS_OTHER_SESSION` có câu dễ hiểu. Đăng xuất A thì quyền hết. | Q-15 |
| BG-06 | admin | Tự duyệt phiếu của chính mình (admin tự xin) | 403 `CANNOT_APPROVE_OWN_REQUEST`; giao diện không nên có nút. | |
| BG-07 | admin | Từ chối (bắt lý do, không đòi mã); thu hồi sớm (đòi mã + lý do) | Người xin nhận thư có lý do; quyền cắt ngay. | |
| BG-08 | member2 | Rút yêu cầu; tự trả quyền | Không đòi mã. | |
| BG-09 | sa | Vô hiệu hoá `qa-d-member2` khi có phiếu chờ; rồi bấm Duyệt | Phiếu tự rút; Duyệt nhận 409 `BREAK_GLASS_WITHDRAWN` có câu rõ. | |
| BG-10 | admin | Tab Nhật ký: quyền đang chạy ghim đầu, lọc, Xuất Excel; 390px | Xuất đúng bộ lọc, có audit `break_glass.exported`; 390px thành thẻ 3 dòng. Không còn chữ "Break-glass" / "Đập tủ kính". | Q-15 |
| SEC-D1 | member | Đoán id: `POST /api/v1/vault/secrets/<id ngăn của nhóm không được gán>/reveal`; `GET /vault/secrets/:id`; `GET /approvals/<phiếu người khác>` | 403 / 403 / 404. Dò 3 lần trong 15 phút: thư "[IMS] N lượt thất bại quanh két" tới SA/Admin. | |
| SEC-D2 | admin | Step-up với `scope: 'diagram'` rồi reveal két; step-up thiếu `scope` | 401 `STEPUP_REQUIRED` với `scope: 'vault'`; 400. | Story 10.1 |
| SEC-D3 | member | `POST` ghi không có `x-csrf-token`; `Origin: https://evil.example` | `CSRF_TOKEN_INVALID`; `ORIGIN_MISMATCH`. | |
| SEC-D4 | admin | Phản hồi reveal | Header `Cache-Control: no-store`; giá trị không nằm trong URL, không vào Nhật ký, không vào localStorage/sessionStorage (kiểm devtools). | |
| SEC-D5 | admin | Nhật ký hệ thống | Có `vault.secret.revealed`, `reveal_denied` (không mang nhãn ngăn), `vault.access.granted/revoked`, `break_glass.*`, `auth.stepup.*` có phạm vi. | |

---

## 8. Lượt E: Quản lý IP · Sổ NAT

Tài khoản `qa-e-*`. Dải chỉ dùng **khoảng địa chỉ dành riêng cho thử**: `198.18.0.0/15`
(RFC 2544), ví dụ `198.18.10.0/24` tên `QA-E2E-E-LAN`. Trước khi tạo, tra Ctrl+K để chắc không chồng
dải thật. Router `QA-E2E-E-RT01` và máy `QA-E2E-E-SRV01` do lượt này tạo (loại có cờ Router/Firewall).

| Mã | Vai | Bước | Kỳ vọng | Nguồn |
| --- | --- | --- | --- | --- |
| IP-01 | admin | Thêm dải: thiếu `/`; `/33`; `/23` (rộng hơn /24); `198.18.10.37/24`; VLAN 0/4095; gateway ngoài dải; IPv6 | Lỗi đúng từng ca; `.37/24` tự quy về `.0/24` có xem trước "254 host (đầu – cuối)"; IPv6 "Chỉ nhận địa chỉ IPv4". | Story 5.1 |
| IP-02 | admin | Dải chồng: trùng hệt, nằm trong, bao trùm, ở site khác | Mọi ca bị chặn "Chồng lên dải X (tên) đã khai". | Q-01 |
| IP-03 | admin | `/31`, `/32`, `/25`, `/26` | /31 2 host, /32 1 host (không trừ mạng/quảng bá); /25, /26 trừ đúng. | |
| IP-04 | member | Cấp IP: không chọn máy cũng không nhập người; IP mạng / quảng bá; IP ngoài dải; IP đã dùng; `198.18.010.5` | Chặn đủ, câu tiếng Việt. | Story 5.2 |
| IP-05 | member | Máy đã có IP → nút "Đổi IP"; chọn lại đúng IP đang giữ | IP cũ về Trống, IP mới được cấp trong một lượt; chọn lại IP cũ bị báo. IP cấp cho người không bị luật một-máy-một-IP. | Q-20 |
| IP-06 | member | Thu hồi IP (nút cam); cấp lại cho máy khác | Ô mờ "đã thu hồi" + "trước: X"; cấp lại được, lịch sử cũ còn. | Q-02, Q-19 |
| IP-07 | admin | Xoá hồ sơ nhập nhầm (bắt lý do) | Ô thành trống, nhập lại được ngay. Member không có nút; API 403. | Q-15 |
| IP-08 | admin | Ngừng dùng dải (bắt lý do), Dùng lại, Xoá hẳn dải đã từng có hồ sơ | Gạch ngang, xám, "Đã ngừng dùng"; Dùng lại không hỏi lý do; Xoá hẳn chỉ được khi chưa từng có hồ sơ. | |
| IP-10 | mọi | Dải /24 mới dùng vài IP, chế độ "Tất cả" | Chuỗi ≥10 ô trống liền nhau thành một dòng "172.16.10.3 – .221 · 219 IP trống" có "Cấp IP" (cấp ô đầu) và "Hiện từng IP"; gateway là dòng riêng. Chế độ "Trống" và ô tìm vẫn ra từng ô. Link `?ip=` tới một ô trong chuỗi: chuỗi đó mở sẵn, dòng được tô sáng. Ở 390px không còn thẻ dải dưới ô chọn dải (menu ⋯ cạnh ô chọn). Đổi IP chọn sẵn dải hiện tại. | Q-27 |
| IP-09 | mọi | Ô tra: 1 ký tự, `999.1.1.1`, `198.18.10.300`, IP không thuộc dải nào, `/ip-addresses/<id>?ip=198.18.10.77` | Câu nhắc / khung đỏ có ✕ / "Không dải nào đang dùng chứa X" / mở đúng trang và tô sáng dòng. | |
| IP-10 | mọi | Phân trang /24 (6 trang × 50), chip Trống/Đang dùng, kiểu "Bản đồ"; thanh mức dùng | Đổi dải về trang 1; số chip đếm cả dải; thanh xanh <70%, vàng ≥70%, đỏ ≥90%; dải ≥80% lên bảng điều khiển. | |
| IP-11 | 2 tab | Hai tab cùng cấp một IP | Tab sau nhận câu "đã có người cấp" (IP_TAKEN / IP_ALREADY_CHANGED). | |
| NAT-01 | member | Luật NAT: cổng ngoài `8080`, `8000-8010`, `8010-8000`, `0`, `65535`, `65536`, `80,81`, `abc`, chip trùng | Chip đúng; "Bấm Lưu sẽ ghi N dòng"; lỗi đúng biên. | Story 5.3 |
| NAT-02 | member | Thiếu "Mở cho ai" / "Lý do mở"; IP trong là IP mạng/quảng bá; IP chưa có trong sổ | Hai ca đầu chặn; IP mạng/quảng bá chặn; IP chưa có thì cảnh báo + nút "Cấp IP này trong sổ". | |
| NAT-03 | member | Cùng router: TCP 443 hai lần; TCP 443 + UDP 443; TCP+UDP chồng TCP; khoảng >1000 cổng; cổng 3389 | Chồng cùng giao thức bị chặn; TCP/UDP khác nhau được; >1000 chỉ cảnh báo; 3389 nhãn "Nhạy cảm". | |
| NAT-04 | member | Ô Router: chỉ loại có cờ Router/Firewall; thêm chip loại khác; chọn máy không phải router; chọn "Máy đích" | Chọn máy thường chỉ cảnh báo; chọn Máy đích thì ô IP chỉ còn IP của máy đó. | Q-19, Q-20 |
| NAT-05 | member / admin | Ngừng dùng / Dùng lại luật; "Gỡ" | Member không có Gỡ (API 403); luật đã gỡ vẫn xem được Lịch sử. | |
| NAT-06 | mọi | Lọc site, router, giao thức, "Chỉ cổng nhạy cảm", trạng thái; `/nat?rule=<id>` khi luật đang bị lọc ẩn; "Sao chép link" | Tô sáng đúng luật; có nút "Bỏ lọc để thấy luật này". | Q-25 |
| NAT-07 | member | Hàng rào: IP còn luật NAT sống → thu hồi, cấp lại, xoá hồ sơ, đổi máy, ngừng cả dải | Mọi ca bị chặn, câu nêu giao thức + cổng, có link "Mở sổ NAT". Sửa ghi chú vẫn được. | |
| NAT-08 | mọi | Trang thiết bị của router và máy đích ở 390px | Khu IP / NAT là danh sách nhãn–giá trị 2 cột, không tràn ngang; bấm IP / luật đi đúng chỗ. | Story 5.4 |

---

## 9. Lượt F: Sơ đồ mạng

Tài khoản `qa-f-*`. Mọi bản vẽ tên `QA-E2E-F-…`. Bản vẽ thật **mở xem thoải mái** (chủ dự án
đồng ý; mỗi lần mở ghi một dòng `diagram.viewed`, không sao), nhưng chỉ ở chế độ Xem. Không lưu, không
kéo máy trên bản vẽ thật (R2).

Cách lái draw.io (xem thêm `e2e/tests/diagrams*.spec.ts`):

- Khung: `page.frameLocator('iframe[title="Khung vẽ draw.io"]')`.
- Trình vẽ sẵn sàng khi nút "Thiết bị kho" bật (tối đa 60 giây). Đừng chờ nút Lưu.
- Việc của IMS (chèn máy, chèn tủ, khai kết nối, sắp lại dây, lưu) đi qua thanh và menu ⋮ **ngoài
  khung** (`diagramBarAction`). Đây là đường ổn định nhất.
- Kéo bằng chuột thật được (`mouse.down` → `move` ~20 bước → `up`, toạ độ lấy từ boundingBox
  nhãn trong khung). Vẽ nét dây bằng tay **không ổn định**: dùng "Khai kết nối" trong menu. Kéo từ
  "Thiết bị kho" mà trình duyệt không giao cú thả thì IMS chèn theo lưới: **không phải lỗi**.
- Hover, nháy đúp, bấm khung bản con: kiểm ở tab **Xem** (SVG của IMS), không ở draw.io.

| Mã | Vai | Bước | Kỳ vọng | Nguồn |
| --- | --- | --- | --- | --- |
| DG-01 | mọi | `/diagrams`: xem cây, đi sâu "▸ n bản vẽ con", đường dẫn quay lại, dải "Cần làm", kiểu Danh sách, "Đã lưu trữ (n)" | Xem cây **không hỏi mã**; trạng thái luôn có chữ. 390px: chip cuộn ngang, ô 2 cột, không có nút Sửa. | Story 10.3 |
| DG-02 | member | Tạo `QA-E2E-F-GOC`, bản con loại thường ("Trang trắng" / "Chép nội dung bản vẽ cha"), bản con loại "Tủ mạng" chọn `QA-E2E-B-TU1` | "Loại bản vẽ" có câu giải thích; ô Tủ chỉ hiện khi loại là Tủ mạng; mặc định "Dựng từ kho"; bản con lấy Site của cha. | Story 10.13 |
| DG-03 | member | Mở nội dung lần đầu; mở bản thứ hai trong 10 phút; mã két (lượt D) có mở sơ đồ không | Hỏi mã một lần, ân hạn 10 phút; mã két **không** mở sơ đồ. | Story 10.1 |
| DG-04 | member | Sửa: chưa đổi gì → Lưu tắt, Ctrl+S "Không có thay đổi để lưu."; thêm 1 máy → Lưu | "Đã lưu phiên bản #n: Thêm 1 thiết bị". | |
| DG-05 | member | Thiết bị kho: tìm theo mã/IP; tick nhiều → "Chèn n thiết bị"; máy đã có trên bản vẽ; máy thanh lý (của lượt B); huy hiệu "Thiếu U" / "Chưa có ảnh" | Máy thanh lý không hiện; máy đã có hiện "Đã có trên bản vẽ"; huy hiệu chỉ báo, không chặn; lọc "Chỉ máy cần xử lý". | Story 10.4 |
| DG-06 | member | Bản vẽ tủ: "Chèn tủ mạng" | Chỉ mặt trước; U1 ở đáy; máy cao đúng n×1U; nhãn "mã · IP" một dòng bên phải; tên tủ trong dải trên khung. | Story 10.11 |
| DG-07 | member | Kéo `QA-E2E-B-SW01` từ `TU1` thả vào khung `TU2` (cả thả trong khung lẫn thả đè lên viền khung) → Huỷ | Hỏi "Chuyển máy sang tủ này?" (tủ cũ → mới, U bắt đầu, số U, kiểm chồng U). Huỷ: ô ra **ngoài** cạnh khung, kho không đổi (kiểm trang thiết bị). | Q-26 08/10 |
| DG-08 | member | Lặp DG-07 → Đồng ý | Kho đổi **ngay** (trang thiết bị, lịch sử thiết bị ghi "đổi tủ từ sơ đồ"), không chờ duyệt bản vẽ. Bỏ nháp bản vẽ **không** hoàn tác việc này. | Q-23 |
| DG-09 | member | Máy chưa khai U thả vào tủ của chính nó | Hỏi "Khai U cho máy này?"; Huỷ thì vào cột "Chưa khai U". | |
| DG-10 | member | Menu ⋮ khi sửa: thứ tự, mục ẩn/hiện; bấm vào khung vẽ khi menu đang mở | "Hướng dẫn" đứng đầu; "Chuyển máy sang tủ…" chỉ hiện khi có máy lệch tủ; **không có** Ảnh thật, Nối hàng loạt, Gắn khung, Đổi tủ của khung, Dây chưa khai, Phát hành, Gửi duyệt. Bấm vào khung thì menu tự đóng. | Q-26 08/10 |
| DG-11 | member | Khai kết nối `SW01:Gi1/0/2` ↔ `SW02:Gi1/0/2`; gõ cổng đã có cáp; chọn loại dây, màu | Cổng trùng báo ngay tại ô kèm nút "dùng cổng kế tiếp"; "Khai" ghi sơ đồ cổng **ngay** (kiểm tab Sơ đồ cổng của máy). Nhãn cổng sát hai đầu dây. | Story 10.5 |
| DG-12 | member | Xoá một nét đã khai | 3 lựa chọn: Gỡ luôn kết nối / Chỉ xoá nét vẽ / Huỷ (nét trở về). | |
| DG-13 | member | Gỡ kết nối ở trang thiết bị, rồi mở lại bản vẽ (Xem) | Nét đỏ; tạo kết nối mới giữa hai máy trên bản vẽ → "Có N kết nối mới chưa vẽ" + "Vẽ vào". | |
| DG-14 | member | Rời màn khi chưa lưu; đóng tab rồi mở lại tab Sửa | "Bản vẽ chưa lưu" (Ở lại / Rời màn); mở lại có "Có bản đang vẽ dở lúc… chưa lưu." → Khôi phục thành thay đổi **chưa lưu**. | |
| DG-15 | member ×2 | Hai tài khoản cùng mở Sửa một bản | Người sau thấy "Đang có <tên> mở sửa…"; tóm tắt phiên bản ghi "lưu đè lên bản của …". Dòng báo hết sau khoảng 60 giây im. | |
| DG-16 | member | Hết ân hạn mã giữa lúc vẽ (**chạy ở lượt Z, CFG-06**, khi ân hạn đã hạ còn 1 phút) → Lưu | Hộp mã tại chỗ; nhập xong lưu đúng bản đang vẽ, **không mất nét**. | |
| DG-17 | member | Gửi duyệt nháp của mình; gửi duyệt nháp người khác; gửi lần hai | Được; 403 có câu rõ; 409. Thư hai chiều qua Mailpit. | Story 10.7 |
| DG-18 | admin | Duyệt / Trả về (phải có ít nhất 1 ghim hoặc ghi chú); tự duyệt yêu cầu của mình; Phát hành thẳng | Trả về không có ghim bị chặn; tự duyệt 403; Phát hành thành chính thức; menu "Sơ đồ mạng" có số chờ duyệt (không tính yêu cầu của chính mình). | |
| DG-19 | admin | Tự kiểm khi gửi duyệt/phát hành: có máy đã thanh lý trên bản vẽ; nét chưa khai | Đỏ chặn (máy thanh lý / không còn); vàng cho qua (nét chưa khai, máy lệch tủ). | |
| DG-20 | mọi | Lệch kho: đổi IP máy ở lượt E (chỉ máy QA) → Xem bản chính thức | Dấu lệch "cũ → mới"; "Kiểm tra khớp" liệt kê và bay tới ô; cây hiện "Lệch kho (N)". | Story 10.9 |
| DG-21 | admin | Xuất PNG, PDF của nháp, bản trình bày, bản cũ | Chân trang + thuỷ vân người xuất; dải "BẢN NHÁP — chưa duyệt" / "BẢN TRÌNH BÀY" / "BẢN CŨ" đúng loại; audit `diagram.exported`. | Story 10.10 |
| DG-22 | admin | Phiên bản: tick 2 bản → So sánh; Dòng thời gian chọn ngày trước bản đầu; khôi phục bản trùng bản mới nhất | Xanh thêm / đỏ bỏ / vàng đổi + chú giải + bộ đếm; "Chưa có bản chính thức vào ngày này"; "Bản này trùng bản mới nhất…". | |
| DG-23 | mọi | Xem: bấm/rê máy; Tìm (2 ký tự; máy ở bản vẽ khác); Lớp; Chỉ đường giữa hai máy không nối nhau | Dây và máy đầu kia sáng, thẻ "A:cổng ↔ B:cổng"; tìm mở đúng bản qua `?focus=`; chỉ đường báo không có đường trong hộp. | Story 10.12 |
| DG-24 | mọi | Trình chiếu từ nút gốc: ← → Esc; nhánh chưa phát hành | Đi lần lượt bản chính thức; nhánh chưa phát hành có lý do tắt. Hết ân hạn khi đang trình chiếu: hỏi mã tại chỗ, không thoát. | Story 10.8 |
| DG-25 | mọi, 390px | Mở `/diagrams/<id>?mode=edit` | Về Xem kèm "Sửa sơ đồ chỉ làm trên máy tính"; không nạp draw.io; không có Gửi duyệt / Phát hành / Ghim / Phiên bản; có Tìm, Chỉ đường, thẻ máy, chú giải; không tràn ngang. | Story 10.12 |
| DG-26 | mọi | Thanh sơ đồ ở 1280px | Giữ **một dòng**. | |
| DG-27 | mọi | Theme tối khi xem sơ đồ | Giấy bản vẽ vẫn sáng, màu dây giữ bộ màu sáng; viền ô, màu so sánh, chú giải theo theme. | |
| DG-28 | member / admin | Đổi tên, lưu trữ, bỏ lưu trữ, Xoá hẳn (bản chưa phát hành của mình), Xoá vĩnh viễn (bản đã lưu trữ), Bỏ nháp khi có yêu cầu chờ | Đúng quyền theo §2; Bỏ nháp bị chặn khi có yêu cầu chờ trỏ vào bản sẽ xoá. | |

---

## 10. Lượt Z: Tham số hệ thống · Khoá tài khoản · Giới hạn · Quản trị tài khoản (chạy MỘT MÌNH, cuối cùng)

Tài khoản `qa-z-*` + một tài khoản bị hại `qa-z-victim`. Trước mỗi lần đổi tham số: ghi giá trị cũ;
sau đó bấm "Về mặc định" hoặc đặt lại đúng giá trị cũ. Ảnh chụp trước/sau.

| Mã | Vai | Bước | Kỳ vọng | Nguồn |
| --- | --- | --- | --- | --- |
| ACC-01 | sa | Tạo tài khoản: email trùng, email sai, vai; hộp mật khẩu tạm | Hỏi mã; hộp tự che sau 60 giây, có nút chép; đóng là không xem lại được. Không có thư mời (đúng thiết kế). | Story 1.4, Q-14 |
| ACC-02 | sa | Khoá / Mở khoá, Vô hiệu hoá / Bật lại (bắt lý do), Đổi vai, Đặt lại mật khẩu ("Mở khoá luôn"), Đặt lại 2 lớp, Bắt buộc 2 lớp — trên `qa-z-victim` đang đăng nhập ở trình duyệt khác | Mỗi việc hỏi mã (trừ "Đóng phiên" lẻ); phiên của nạn nhân chết ngay ở lần gọi kế tiếp; có thư; tài khoản vô hiệu hoá ẩn khỏi danh sách mặc định. | |
| ACC-03 | sa | Dòng của chính mình | Không có Khoá / Vô hiệu hoá / Đổi vai (`SELF_ROLE_CHANGE`). | |
| ACC-04 | sa | Mật khẩu tạm quá 24 giờ (nhờ câu SQL ở báo cáo, không tự chạy) | Ghi lại để người duyệt chạy; kỳ vọng "Mật khẩu tạm đã hết hạn…". | |
| ACC-05 | sa | "Đóng tất cả phiên" có tick "cả phiên mình" | Có cảnh báo rõ là sẽ tự đăng xuất. | |
| ACC-06 | sa | Khối "Đang tạm chặn · n", "Gỡ tạm chặn", lọc vai/trạng thái/2 lớp, xuất Excel; 390px dạng thẻ | Đúng; xuất có audit `accounts.exported`. | |
| LOCK-01 | — | `qa-z-victim` sai mật khẩu 5 lần cùng IP | "Tạm khoá… Thử lại sau m:ss" + nút "Chờ …"; không lộ số lần còn lại ở bước mật khẩu; thư tới chủ tài khoản **và SA** (chưa có E2E). SA bấm "Gỡ tạm chặn" thì vào lại được. | Q-06 |
| LOCK-02 | — | Sai mã TOTP lúc đăng nhập | Tính vào bộ đếm; "Còn N lần thử". | |
| LOCK-03 | sa | SA khoá tay `qa-z-victim` | "Tài khoản đang bị khoá. Liên hệ Super Admin", không tự hết. Vô hiệu hoá: câu khác (`ACCOUNT_DISABLED`). | Q-16 |
| LOCK-04 | — | Đăng nhập trình duyệt mới lần đầu, rồi lần hai cùng máy | Thư "trình duyệt mới" chỉ ở lần đầu (chưa có E2E). | |
| CFG-01 | sa | Sai kiểu ("abc"), ngoài khoảng, danh sách không tăng dần (`login.account_backoff_minutes` = `15,5`), `nat.sensitive_ports` 51 cổng / trùng, đặt 0 | Lỗi đúng ô; cảnh báo vàng khi nới rộng; cảnh báo "tắt hẳn" khi 0. **Không bấm Lưu** cho các ca này. | |
| CFG-02 | sa | Cặp `breakglass.pending_expire_hours` ≤ `approval.reminder_hours` | Bị chặn. Không lưu. | |
| CFG-03 | sa | Đang có thay đổi chưa lưu: đổi nhóm, bấm menu, Ctrl+K, nút lùi, F5 | Hỏi Lưu / Bỏ / Ở lại ở **mọi** ca (nút lùi và F5 chưa có E2E). | |
| CFG-04 | sa | Đổi `dashboard.max_items` 8 → 3, Lưu (hộp xác nhận → mã) → chờ ≤30 giây → bảng điều khiển → "Về mặc định" | Áp trong 30 giây; "Sửa lần cuối bởi…" đúng; audit `system_config.updated`; trả về 8. | |
| CFG-05 | sa | Hạ `session.idle_minutes` 30 → **5** (mức thấp nhất màn cho phép). Để yên một tab 5 phút, một tab khác chỉ có vòng hỏi định kỳ (bảng điều khiển, sơ đồ đang mở) | Lần bấm sau 5 phút đưa về /login, đăng nhập lại về đúng trang dở; vòng hỏi định kỳ **không** kéo dài phiên. Trả về 30. | Chủ dự án cho phép |
| CFG-06 | sa | Hạ `secret.stepup_grace_minutes` và `diagram.stepup_grace_minutes` 10 → **1** (thấp nhất). Rồi chạy: DG-16 (lưu bản vẽ khi hết ân hạn), DG-24 (hết ân hạn khi đang trình chiếu), VLT-03 (xem ngăn khác sau 1 phút), BG-04 (duyệt sau 1 phút), ACL-01 (gán quyền sau 1 phút), dòng "m:ss" trong hộp két đếm từ 1:00 | Hỏi mã **tại chỗ**, nhập xong làm tiếp đúng việc đang dở, không mất dữ liệu đang nhập, không bị đá về /login. Trả cả hai về 10. | Chủ dự án cho phép |
| CFG-07 | sa | Hạ `secret.reveal_seconds` 60 → **10** (thấp nhất) | Hộp két tự đóng sau 10 giây; vòng đếm khớp; hộp mật khẩu tạm ở Người dùng IMS cũng tự che sau 10 giây. Trả về 60. | |
| MAIL-01 | sa | Thư gửi lỗi: danh sách, địa chỉ che `a***@`, "Gửi lại" **chỉ với thư của QA**, gửi lại thư đã gửi xong | Câu "không còn để gửi lại"; badge menu khớp số. | Q-25 |

---

## 11. Luồng xuyên màn hình (lượt X, sau B–F, đọc kết quả của các lượt trước)

Đây là chỗ bộ E2E yếu nhất: mỗi spec kiểm một mảng.

| Mã | Luồng | Kiểm ở đâu |
| --- | --- | --- |
| XUYEN-01 | Máy `QA-E2E-B-SW01`: có IP (E), luật NAT (E), license (C), ngăn két (D), trên sơ đồ (F), có dây (B/F) → thanh lý "Gỡ hết" | Trang máy, sổ IP, sổ NAT, license (ghế trả), két (giữ), sơ đồ (dấu lệch kho, chặn phát hành), Kho thanh lý, bảng điều khiển "Vừa thanh lý 7 ngày", Nhật ký. |
| XUYEN-02 | Đổi trạng thái máy về Đang dùng | Hạn bảo hành vào lại màn Hết hạn; Thiết bị kho của sơ đồ lại hiện máy. |
| XUYEN-03 | Đổi tủ từ sơ đồ (DG-08) | Lịch sử thiết bị, danh sách lọc theo tủ, "Xem tủ", bản vẽ tủ cũ báo lệch. |
| XUYEN-04 | Khai dây từ sơ đồ, gỡ ở trang thiết bị | Hai chiều nhất quán, cả "Đang cắm vào thiết bị này". |
| XUYEN-05 | Phần mềm tự thanh lý (SW-05) | Ghế gỡ khỏi trang máy, Kho thanh lý ("Hệ thống…"), Khôi phục, thư tổng hợp không còn nhắc. |
| XUYEN-06 | Ctrl+K với mọi hồ sơ QA đã tạo | Tìm ra đủ, kể cả hồ sơ đã thanh lý; mở đúng màn của từng loại phần mềm. |
| XUYEN-07 | Bảng điều khiển sau tất cả các lượt | Mọi số khớp màn gốc. |
| XUYEN-08 | Nhật ký hệ thống: lọc theo từng tài khoản QA | Mỗi thao tác ghi có đúng một dòng, không có dòng chứa giá trị bí mật. |

---

## 12. Mẫu báo lỗi và mức độ

| Mức | Nghĩa |
| --- | --- |
| **S1** | Lộ quyền / lộ bí mật / mất hoặc hỏng dữ liệu / vượt được step-up. Dừng lượt, báo ngay. |
| **S2** | Sai nghiệp vụ so với QUYET-DINH/AC; chặn một luồng chính; số liệu sai; ghi nhầm vào kho. |
| **S3** | Khó hiểu, dễ bấm nhầm, vỡ bố cục 390px, tương phản kém ở tối, thiếu trạng thái rỗng/lỗi. |
| **S4** | Chữ, chính tả, căn lề, khoảng cách, thuật ngữ không thống nhất. |

Mỗi lỗi một khối trong `findings.md`:

```markdown
### QA-<lượt>-<số> · S2 · <tiêu đề ngắn, nói cái sai>
- Kịch bản: DEV-03 · Vai: member · Khung: 390×844 · Theme: tối
- URL: /devices/<id>?tab=ports
- Bước: 1) … 2) … 3) …
- Thấy: … (trích nguyên văn câu trên màn / mã lỗi API)
- Kỳ vọng: … (dẫn Q-xx / Story x.y / dòng của file này)
- Ảnh: shots/DEV-03-3-member-390-dark.png
- Lặp lại được: luôn / thỉnh thoảng (n/m lần)
```

Quy tắc:

- Một lỗi một khối. Cùng gốc ở nhiều màn thì gộp, liệt kê các màn.
- "Thấy" phải là thứ quan sát được: câu trên màn, mã HTTP, ảnh. Không đoán nguyên nhân trong code.
- Không chắc là lỗi hay thiết kế: ghi `?` sau mức (`S3?`) và dẫn chỗ tài liệu làm mình phân vân.
- Kịch bản trong file này sai so với QUYET-DINH: ghi vào mục cuối "Kịch bản cần sửa".

Gộp báo cáo: người điều phối xác minh lại từng lỗi S1/S2 bằng cách tự chạy lại, bỏ trùng, rồi đưa
lên trang báo cáo ở `https://ims.pmh.com.vn:8443/` (như đợt soát UI) để chủ dự án chọn Làm / Không
làm.

---

## 13. Đã bỏ hoặc đổi có chủ ý: đừng báo thiếu

- Đăng nhập: không có "Quên mật khẩu?", không đặt lại qua email, không mã dự phòng, không thư mời
  khi tạo tài khoản, không có "Email đã nhớ… Không phải tôi", không có nút "Quên máy" (Q-14, Q-18,
  Q-25). Không khoá cứng 15 phút mà chờ tăng dần (Q-06). Không có hộp cảnh báo sắp hết phiên.
- Mã lúc đăng nhập không mở két hay sơ đồ (Q-21). Mã két và mã sơ đồ không mở lẫn nhau.
- Bảng điều khiển không tự làm mới; khối Sự cố ghi "IMS chưa theo dõi sự cố" (Epic 9 chưa làm).
- Menu không có nhóm "Dành cho nhà phát triển", không có mục "Tài liệu".
- Két: không xuất toàn bộ; **có** nút Sao chép (Q-24 đảo luật cũ); không tự xoá clipboard; không có
  ô tick "Tôi đã đổi trên thiết bị"; không còn "mức nhạy cảm"; không chữ ký tay khi duyệt.
- Xin mở két: phiếu chờ tới 8 giờ, quyền gắn với phiên xem lần đầu (Q-15).
- IP: chỉ IPv4, chỉ 2 trạng thái Trống / Đang dùng, không ping tự động, dải rộng nhất /24, một máy
  một IP (Q-01, Q-02, Q-20). Không có nút khôi phục hồ sơ IP đã xoá. NAT không có hạn "rà lại".
- ISP: không ngày kết thúc, không nhắc hạn, không có trên màn Hết hạn (Q-04).
- Phần mềm: không có trạng thái "chờ gia hạn"; không Hoàn tác gia hạn; không mốc "Tháng sau /
  Quý sau"; phần mềm Hết hạn không vào thư tổng hợp; IMS không lưu file cert/khoá (Q-03, Q-13, Q-22).
- Tài khoản dịch vụ: quá hạn không tự ngừng dùng.
- Q-27 (giao diện C, 08/10): bảng thiết bị **không còn** cột Người sử dụng, cột Bảo hành và dòng phụ
  loại · model · serial dưới tên (đã có trong hồ sơ). Hộp Gán license **không còn** ô Chi phí, Hợp đồng,
  Bắt đầu, Kết thúc, Ghi chú (khai ở Sửa ghế); Sửa ghế **không còn** ô Hợp đồng; form phần mềm không
  có ô Chi phí. Tab "Hồ sơ" của phần mềm đổi tên "Tổng quan". Trang thiết bị không còn khu "Thông tin
  nhanh" và khu "License đang cài" (thay bằng dải 4 ô, Thông số, tab Phần mềm). Danh mục không còn ở
  nhóm Hệ thống. Nhãn đổi: Hãng sản xuất, Tên gọi, Loại thiết bị / Loại hồ sơ, Mã hồ sơ, "Cổng dịch vụ
  (port)".
- Soát UX 10/10 (bổ sung Q-27 + toàn portal): trang thiết bị **không còn** dòng Bảo hành trong Thông số
  (bảo hành ở dải 4 ô) và thẻ Bảo hành ở cột phải (thay bằng thẻ Nhà cung cấp); khu IP / NAT / Đường
  truyền và khu ảnh **gập sẵn** trên máy tính. Phần mềm **không còn** "Thẻ định danh". Không còn đường
  `/documents`. Nút "Xóa bộ lọc" ở Két sắt thay bằng chip "Tất cả". Ô ngày không còn mũi tên ˅.
- Soát bằng mắt 11/10: trang đường truyền và tài khoản dịch vụ **không còn** "Thẻ định danh" / thẻ
  "Khi mất mạng" (thay bằng dải 4 ô); tab "Hồ sơ" của đường truyền thành "Tổng quan". Trên điện thoại
  thanh lọc từ 3 ô trở lên **gập sau nút "Bộ lọc"**. Tab Máy đang dùng của phần mềm **không còn** thanh
  ghế (đã ở dải 4 ô). Thẻ "Khai trước khi thêm thiết bị" gập một dòng khi đủ cả 6 mục.
- Thiết bị: không xoá được, chỉ thanh lý. Ảnh model thắng ảnh riêng; mặt có ảnh model bị khoá tải
  ảnh riêng, kể cả SA (Q-26). Không có ô "phòng" cho máy không gắn tủ. Không còn "chọn ảnh từ giấy tờ".
- Sơ đồ (Q-26 08/10): đã bỏ "Ảnh thật…", "Nối hàng loạt" (chỉ còn ở trang thiết bị), "Gắn khung",
  "Đổi tủ của khung", "Dây chưa khai". Khung gắn từ trước vẫn bấm được ở Xem. Tủ chỉ vẽ mặt trước.
  Huỷ hộp chuyển tủ thì ô ra **ngoài** khung (không về chỗ cũ). Lưu/phát hành bản vẽ không ghi sơ đồ
  cổng. Chưa có "trạng thái sống", chưa xuất Excel danh sách dây. Sửa sơ đồ chỉ trên máy tính.
- Thông điệp API thanh lý có thể vẫn ghi "Đưa lại vào dùng" trong khi nút là "Đổi trạng thái": **đây
  là lỗi chữ S4 nên báo**, không phải tính năng đã bỏ.

---

## 14. Chia lượt và thứ tự chạy

| Thứ tự | Lượt | Nội dung | Chạy song song với | Ước lượng |
| --- | --- | --- | --- | --- |
| 1 | 0 | Chuẩn bị: kiểm SMTP, tài khoản QA, `qa-accounts.json` | — (một mình) | 15 phút |
| 2 | ROLE | §2 ma trận vai, với bộ `qa-a-*` | — | 30 phút |
| 3 | B | Thiết bị, danh mục, model (dựng dữ liệu nền cho E, F) | A, C | 60 phút |
| 3 | A | Đăng nhập, phiên, shell, bảng điều khiển, nhật ký | B, C | 45 phút |
| 3 | C | Phần mềm, hết hạn, thư, ISP, TKDV | A, B | 60 phút |
| 4 | D | Két, quyền két, xin/duyệt | E, F | 60 phút |
| 4 | E | IP, NAT | D, F | 45 phút |
| 4 | F | Sơ đồ mạng | D, E | 90 phút |
| 5 | X | Luồng xuyên màn hình | — | 30 phút |
| 6 | Z | Tham số, khoá, quản trị tài khoản | — (một mình) | 45 phút |
| 7 | 9 | (sau khi sửa xong) Dọn: `docker compose -f docker-compose.yml -f docker-compose.override.e2e.yml exec -T api node scripts/reset-e2e.mjs all`, kiểm không còn hàng `E2E` sống sót. Lệnh này nới `login.rate_limit_per_ip` lên 500: trả lại 20 bằng câu `UPDATE` trong CLAUDE.md | — | 5 phút |

Mỗi lượt kết thúc bằng `coverage.md`: **mọi mã** của lượt phải có một trong ba dấu ĐẠT / LỖI / CHƯA
KIỂM. Không có mã nào bị im lặng bỏ qua.

Lượt dọn (bước 7) **chỉ chạy sau khi các lỗi trong báo cáo đã được sửa và kiểm lại** (chủ dự án chốt):
hồ sơ QA là bằng chứng để tái hiện lỗi và để kiểm lại sau khi sửa.
