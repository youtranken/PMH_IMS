import { expect, test } from '@playwright/test';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * ===== ĐI KHẮP GIAO DIỆN — MỘT LƯỢT ĐI NHƯ NGƯỜI THẬT =====
 *
 * VÌ SAO FILE NÀY TỒN TẠI
 *
 * 67 file E2E trước nó kiểm từng màn rất sâu, nhưng gần như luôn TỚI màn bằng
 * `page.goto('/duong-dan')` với id lấy từ một lượt gọi API. Cách đó bỏ lọt đúng ba thứ, và cả
 * ba đều là thứ người dùng gặp đầu tiên:
 *
 *   1. NHỮNG SỢI DÂY NỐI CÁC MÀN. Thanh điều hướng, link mã trên bảng, breadcrumb, link
 *      "Xem toàn bộ" ở bảng điều khiển, nút đổi giao diện ở topbar. Một mục menu trỏ vào 404,
 *      một `PATHS.device(id)` ghép sai, một breadcrumb mất đường quay ra — không bài nào đỏ,
 *      vì mọi bài đều tự gõ URL đúng.
 *
 *   2. VAI `admin`. Hệ thống có ba vai; hạt giống E2E chỉ gieo `sa` và `member`. Nghĩa là mọi
 *      luật dành riêng cho Quản trị viên chưa từng được chứng minh — cả phần họ ĐƯỢC làm lẫn
 *      phần họ KHÔNG được. Khối 2 tự dựng lấy người đó, qua đúng màn `/admin/accounts`.
 *
 *   3. NHỮNG CÁI NÚT ĐÃ CÓ BÀI KIỂM GỌI API NHƯNG CHƯA AI BẤM. Đặt lại mật khẩu, đặt lại 2
 *      lớp, khoá/mở tài khoản, từ chối và thu hồi phiếu break-glass. Bài kiểm API xanh không
 *      chứng minh cái nút còn nối vào đúng endpoint đó — hoặc còn tồn tại.
 *
 * BỐN KHỐI, BA NGƯỜI DÙNG. Mỗi khối đi bằng CHUỘT và BÀN PHÍM. Chỗ nào chỉ là dàn cảnh (dựng
 * sẵn một thiết bị, một phiếu chờ) thì gọi API cho nhanh và nói rõ — nhưng ĐIỀU ĐANG KIỂM thì
 * luôn phải đi qua giao diện.
 */

/*
 * PHẦN 1 — "Người SA đi một vòng cả hệ thống".
 *
 * Bộ E2E hiện tại kiểm từng màn một cách RẤT sâu, nhưng gần như luôn tới màn bằng
 * `page.goto('/duong-dan')`. Nghĩa là những thứ NỐI các màn với nhau — thanh điều hướng,
 * link trên bảng, breadcrumb, link "Xem toàn bộ" trên bảng điều khiển, cái nút đổi giao diện
 * ở topbar — chưa có ai đi thử. Một link chết, một `to=` gõ sai, một mục menu trỏ vào 404 sẽ
 * KHÔNG làm đỏ bài nào, vì mọi bài đều tự gõ URL đúng.
 *
 * Năm bài dưới đây đi bằng CHUỘT và BÀN PHÍM, đúng như người dùng thật.
 */
/**
 * ===== BẢN KIỂM KÊ — TICK VÀO THỨ ĐÃ THẬT SỰ ĐI QUA =====
 *
 *   [x] đã có bài kiểm chạy thật
 *   [~] có bài, nhưng ĐANG TREO vì một lỗi phần mềm chưa vá
 *   [ ] chưa đi — và nói thẳng ra là chưa
 *
 * Dòng `→` là TÊN BÀI KIỂM giữ mục ngay trên nó.
 *
 * Bản kiểm kê này KHÔNG phải chú thích trang trí: khối `test.describe` bên dưới đọc nó cùng
 * các bài ở `di-khap-giao-dien-NN-*.spec.ts` và bắt bẻ nó — mỗi `→` phải trỏ tới một bài CÓ THẬT, mỗi bài trong file phải
 * có mặt đúng một lần ở đây, `[~]` phải đúng là bài đang `test.fixme`, và `[ ]` thì không được
 * kèm `→` nào. Một bản kiểm kê không ai canh sẽ tick cho những thứ đã bị xoá từ lâu, và như
 * thế còn tệ hơn là không có bản kiểm kê nào: nó khiến người đọc yên tâm về một vùng trống.
 *
 * ── HÀNH LANG — những sợi dây nối các màn với nhau ──────────────────────────
 * [x] Thanh điều hướng: 15 mục của SA, mỗi mục mở đúng màn, hai mục "chưa mở" KHÔNG phải link
 *     → SA đi hết mọi mục trên thanh điều hướng bằng chuột
 * [x] Danh sách → hồ sơ bằng cách BẤM mã, đi hết tab, quay ra bằng breadcrumb
 *     → SA bấm từ danh sách sang hồ sơ rồi đi hết các tab
 * [x] Bảng điều khiển: các link "Xem toàn bộ …" mở đúng màn
 *     → Bảng điều khiển là bàn đạp, không phải ảnh tĩnh
 * [x] Đổi sáng/tối ở topbar, dính lại qua đổi trang và nạp lại
 *     → Đổi sáng/tối trên máy bàn và nó dính lại sau khi đổi trang
 * [x] Bàn phím: Tab tới nút, Enter mở hộp, Esc đóng, tiêu điểm TRẢ về nút
 *     → Bàn phím một mình cũng đi được: Tab tới nút, Enter mở, Esc đóng
 * [x] Bàn phím: điểm dừng Tab ĐẦU TIÊN là "Bỏ qua menu", và nó trỏ vào vùng nội dung
 *     → Tab lần đầu chạm ngay "Bỏ qua menu", và nó trỏ vào vùng nội dung
 *
 * ── BA VAI NGƯỜI DÙNG — ai mở được cửa nào ──────────────────────────────────
 * [x] SA dựng tài khoản Quản trị qua giao diện; người đó đăng nhập lần đầu, menu đúng vai
 *     → SA tạo tài khoản Quản trị, người đó đăng nhập lần đầu và thấy đúng phần việc của mình
 * [x] Quản trị gõ thẳng URL của SA: hệ thống nói KHÔNG, không im lặng
 *     → Quản trị viên gõ thẳng URL của SA thì hệ thống nói KHÔNG, chứ không im lặng
 * [x] Quản trị làm được việc két: cất · xem (qua bước xác thực) · xoay
 *     → Quản trị viên làm được việc két sắt: cất, xem, xoay
 * [x] Quản trị BẤM "Từ chối" và "Thu hồi sớm" trên phiếu xin quyền
 *     → Quản trị viên xử được phiếu xin quyền — cả từ chối lẫn thu hồi
 * [x] Thanh điều hướng của Thành viên thiếu đúng những thứ phải thiếu
 *     → Thanh điều hướng của Thành viên thiếu đúng những thứ phải thiếu
 * [x] Thành viên gõ thẳng URL: cửa menu đã đóng thì URL cũng không mở
 *     → Gõ thẳng URL không mở được cửa mà menu đã đóng
 * [x] Thành viên trước két: thấy tên gọi, xin được quyền, không một nút ghi nào
 *     → Thành viên đứng trước két: thấy tên gọi, xin được quyền, nhưng không có một nút ghi nào
 * [x] SA đặt lại mật khẩu · xoá 2 lớp của người khác — BẤM trên màn Tài khoản
 *     → SA đặt lại mật khẩu và xoá 2 lớp của người khác — bấm bằng tay trên màn Tài khoản
 * [x] SA khoá/mở khoá, và người bị khoá THẬT SỰ không vào được
 *     → SA khoá rồi mở khoá một tài khoản, và người bị khoá thật sự không vào được
 *
 * ── PHÒNG THIẾT BỊ ──────────────────────────────────────────────────────────
 * [x] Đầu trang: đúng bộ nút · bốn ô lọc · ô tìm thu hẹp bảng THẬT
 *     → Đầu phòng Thiết bị: đúng bốn nút, bốn ô lọc, và ô tìm thu hẹp bảng thật
 * [x] Bảng: đủ cột · đúng cột sắp được · phân trang đổi số dòng thật
 *     → Bảng thiết bị: đủ cột, đúng cột sắp được, và phân trang ăn thật
 * [x] Hộp Thêm: đủ ô · đúng loại tay nắm · thiếu thì báo và KHÔNG đóng
 *     → Hộp "Thêm thiết bị": đủ ô, đúng loại tay nắm, và không đóng khi còn thiếu
 * [x] Hộp Sửa điền sẵn giá trị cũ; hộp Nhập Excel khoá nút khi chưa có file
 *     → Hộp "Sửa hồ sơ" điền sẵn đúng, hộp "Nhập từ Excel" khoá đúng lúc chưa có file
 * [x] Hồ sơ: năm tab, mỗi tab bày đúng đồ của nó
 *     → Hồ sơ một cái máy: năm tab, mỗi tab bày đúng thứ của nó
 *
 * ── PHÒNG PHẦN MỀM và PHÒNG SẮP HẾT HẠN ─────────────────────────────────────
 * [x] Đầu trang · ô tìm · đủ cột · menu ba chấm ĐỔI theo loại hồ sơ
 *     → Phòng Phần mềm: đúng bộ nút, ô tìm thu hẹp thật, đủ cột, và menu ba chấm theo loại
 * [x] Hộp Thêm/Sửa hồ sơ: đủ ô · đúng vai · ô chọn có đúng lựa chọn
 *     → Bên trong hộp "Thêm hồ sơ" và hộp "Sửa hồ sơ" — đủ ô, đúng vai, đúng lựa chọn
 * [x] Hộp Gán vào máy: hai chế độ (gán mới / sửa ghế) khác nhau đúng chỗ
 *     → Bên trong hộp "Gán vào máy" — chế độ gán mới và chế độ sửa ghế
 * [x] Hồ sơ: mỗi tab đúng đồ; tab "Máy đang dùng" CHỈ có với license
 *     → Hồ sơ phần mềm: mỗi tab có đúng đồ của tab đó, và "Máy đang dùng" chỉ dành cho license
 * [x] Sắp hết hạn — tab Danh sách: bộ lọc · bảng · nút Gia hạn đúng chỗ
 *     → Phòng Sắp hết hạn — tab Danh sách: bộ lọc, bảng, và nút Gia hạn chỉ ở nơi gia hạn được
 * [x] Sắp hết hạn — tab Luật gửi báo cáo, và bên trong hộp Thêm luật
 *     → Phòng Sắp hết hạn — tab Luật gửi báo cáo, và bên trong hộp "Thêm luật"
 * [x] Link sâu ?tab= mở đúng tab — tab mọc-theo-dữ-liệu ở lại trong lúc đang tải
 *     → Link sâu ?tab=devices phải mở đúng tab "Máy đang dùng", không rơi về tab Hồ sơ
 *
 * ── PHÒNG ĐỊA CHỈ IP và PHÒNG SỔ NAT ────────────────────────────────────────
 * [x] Đầu trang · rail dải · menu thẻ dải ĐỔI theo dải trống hay đã dùng
 *     → Phòng Địa chỉ IP: nút đầu trang, rail dải, và menu mỗi thẻ đổi theo dải trống hay dải đã dùng
 * [x] Pane phải: nhóm nút lọc · bảng địa chỉ · ô trống · không chip hồ sơ đã xóa (Q-15)
 *     → Pane phải màn Địa chỉ IP: nhóm nút lọc, bảng địa chỉ, ô trống, không chip hồ sơ đã xóa
 * [x] Hộp Cấp IP và hộp Sửa hồ sơ IP: đủ ô · đúng vai · Sửa có giá trị cũ
 *     → Bên trong hộp "Cấp IP" và hộp "Sửa hồ sơ IP": đủ ô, đúng vai, và mở Sửa phải có giá trị cũ
 * [x] Menu hồ sơ IP ĐỔI theo trạng thái; hộp chuyển trạng thái hỏi đúng thứ
 *     → Menu của một hồ sơ IP đổi theo trạng thái, và hộp chuyển trạng thái hỏi đúng thứ cần hỏi
 * [x] Hộp Sửa dải / Vô hiệu hóa dải: giá trị cũ còn nguyên, lý do bắt buộc
 *     → Bên trong hộp "Sửa dải" và hộp "Vô hiệu hóa dải": giá trị cũ phải còn nguyên, lý do vẫn bắt buộc
 * [x] Sổ NAT: đầu trang · bộ lọc · đủ cột · menu một dòng
 *     → Phòng Sổ NAT: nút đầu trang, bộ lọc, đủ cột trên bảng và menu của một dòng
 * [x] Hộp Thêm rule: ba khối · chip cổng · nhóm giao thức · hai hộp con
 *     → Bên trong hộp "Thêm rule" NAT: ba khối, chip cổng, nhóm giao thức và hai hộp con
 * [x] Hộp Sửa rule / Gỡ rule: giá trị cũ còn nguyên
 *     → Bên trong hộp "Sửa rule" và hộp "Gỡ rule": giá trị cũ còn nguyên, cổng chỉ còn một khoảng
 *
 * ── PHÒNG ĐƯỜNG TRUYỀN, TÀI KHOẢN DỊCH VỤ và KHO THANH LÝ ───────────────────
 * [x] Đường truyền: đủ nút · đủ cột · ô tìm · và KHÔNG có menu ba chấm
 *     → Màn Đường truyền: đủ nút, đủ cột, ô tìm thu hẹp bảng thật, và KHÔNG có menu ba chấm
 * [x] Hộp Thêm đường truyền: đủ ô · đúng vai · chặn thiếu · đóng cả hai đường
 *     → Hộp "Thêm đường truyền": đủ ô, đúng loại tay nắm, chặn thiếu nhà mạng, đóng được cả hai đường
 * [x] Hồ sơ đường truyền: bấm từ danh sách · đủ nút · đủ tab · không còn gì về hạn
 *     → Hồ sơ đường truyền: bấm từ danh sách, đủ nút và đủ tab, không có gì về hạn, mở hộp Sửa
 * [x] Esc khi ô chọn đang mở chỉ đóng ô chọn, không đóng hộp Sửa
 *     → Esc khi đang mở ô chọn chỉ đóng ô chọn, KHÔNG đóng cả hộp Sửa
 * [x] Tài khoản dịch vụ: menu dòng đúng ở CẢ HAI trạng thái; Thành viên không thấy
 *     → Tài khoản dịch vụ: menu dòng đúng ở cả hai trạng thái, hồ sơ có Chép · Sửa hồ sơ · ba chấm, Thành viên không thấy ba chấm
 * [x] Hộp Thêm tài khoản ĐỔI HÌNH theo loại; hộp Vô hiệu hóa bắt nhập lý do
 *     → Hộp "Thêm tài khoản" đổi hình theo loại, và hộp "Vô hiệu hóa" không cho bỏ trống lý do
 * [x] Kho thanh lý: năm nút lọc kèm số đếm · bốn cột · KHÔNG một nút ghi nào
 *     → Kho thanh lý: năm nút lọc kèm số đếm, bốn cột, một dòng ghi chú — và KHÔNG một nút ghi nào
 *
 * ── PHÒNG DANH MỤC, PHÒNG TÀI KHOẢN và PHÒNG BỘ GIAO DIỆN ───────────────────
 * [x] Danh mục: bảy ngăn, nhãn nút "Thêm …" và bộ cột ĐỔI theo từng ngăn
 *     → Bảy ngăn của phòng Danh mục: nhãn nút "Thêm …" và bộ cột đổi theo từng tab
 * [x] Bên trong BẢY hộp "Thêm …": đủ ô · đúng vai · đóng cả ✕ lẫn Esc
 *     → Bên trong bảy hộp "Thêm …" của Danh mục: đủ ô, đúng loại tay nắm, đóng được cả ✕ lẫn Esc
 * [x] Hộp Tủ mạng từ chối lưu khi thiếu site / số U sai, và KHÔNG đóng
 *     → Hộp Tủ mạng từ chối lưu khi thiếu site hoặc số U sai, và hộp KHÔNG đóng
 * [x] Menu dòng Danh mục ĐỔI theo trạng thái; hộp Sửa nhớ giá trị cũ
 *     → Menu dòng của Danh mục đổi theo trạng thái, hộp Sửa nhớ giá trị cũ, và site mới tới ngay ô "Thuộc site"
 * [x] Tải file mẫu / Nhập Excel chỉ có ở danh mục có sheet; hộp nhập ba bước
 *     → Nút "Tải file mẫu" · "Nhập từ Excel" chỉ có ở danh mục có sheet, và hộp nhập có ba bước khóa nhau
 * [x] Phòng Tài khoản: nút · bộ cột · menu năm việc · hộp Phiên đang mở
 *     → Phòng Tài khoản: nút, bộ cột, menu năm việc và bên trong hộp "Phiên đang mở"
 * [x] Hộp tài khoản: chế độ TẠO khác chế độ SỬA đúng ở chỗ nào
 *     → Hộp tài khoản: chế độ TẠO có Email và ba vai trò, chế độ SỬA thì email là chữ tĩnh và các ô còn nguyên giá trị cũ
 * [x] Bộ giao diện liệt kê đủ mọi khu, đúng thứ tự
 *     → Phòng Bộ giao diện liệt kê đủ mọi khu, đúng thứ tự
 *
 * ── PHÒNG KÉT SẮT, QUYỀN XEM, DUYỆT YÊU CẦU và BẢNG ĐIỀU KHIỂN ──────────────
 * [x] Trang tổng Két sắt: bốn nút lọc đổi bảng THẬT · popup · luật của két
 *     → Trang tổng Két sắt: bốn nút lọc đổi bảng thật, popup mở đúng két, luật đủ bốn gạch
 * [x] Ma trận Quyền: đủ cột · Member có nút gán · SA/Admin ở khối "toàn quyền theo vai"
 *     → Ma trận Quyền xem két sắt: lưới đủ cột, Member có nút gán, SA/Admin ở khối "toàn quyền theo vai"
 * [x] Duyệt yêu cầu: đủ ba ngăn, phiếu treo nói đủ và có đúng hai nút
 *     → Phòng Duyệt yêu cầu: đủ ba ngăn, phiếu treo nói đủ và có đúng hai nút
 * [x] Bảng điều khiển: SA đủ sáu khối, Member THIẾU đúng hai khối an ninh
 *     → Bảng điều khiển: SA thấy đủ sáu khối, Member thiếu đúng hai khối an ninh
 * [x] Hộp Cất mật khẩu/khóa · Xác nhận danh tính · Hiện secret
 *     → Bên trong hộp Cất mật khẩu/khóa, hộp Xác nhận danh tính và hộp Hiện secret
 * [x] Hộp Duyệt · Từ chối · gán quyền hàng loạt
 *     → Bên trong hộp Duyệt, hộp Từ chối và hộp gán quyền hàng loạt
 * [x] Esc lúc menu ô chọn đang mở chỉ đóng MENU (canh bản vá `ui/dialog.tsx`)
 *     → Esc lúc menu ô chọn đang mở chỉ đóng MENU, không đóng cả hộp thoại
 *
 * ── CHƯA ĐI — biết là chưa đi, và nói thẳng là chưa ─────────────────────────
 * [ ] Màn Tài liệu (`/documents`) — thuộc epic sau, chưa có route
 * [ ] Viewport 390px của từng phòng — nằm ở bộ `*.mobile.spec.ts` riêng
 * [ ] Nhập Excel đi trọn ba bước tới lúc GHI — `device-import.spec.ts` giữ phần đó
 */

/**
 * CỔNG CHẶN CHO BẢN KIỂM KÊ Ở NGAY TRÊN.
 *
 * Một danh sách tick tay là thứ hỏng nhanh nhất trong repo: bài kiểm bị đổi tên, bị gộp, bị
 * xoá — dấu tick vẫn nằm đó, và người đọc tiếp theo yên tâm về một vùng trống. Nó không chỉ vô
 * dụng, nó gây hại, vì nó là lời hứa mà không ai còn giữ.
 *
 * Nên bản kiểm kê ở trên phải TỰ CHỨNG MINH. Ba bài dưới đây đọc file này cùng các file
 * `di-khap-giao-dien-NN-*.spec.ts` và đối chiếu hai chiều: mỗi dòng `→` phải trỏ tới một bài có thật, và mỗi bài trong file phải có mặt đúng
 * một lần trong bản kiểm kê. Thêm một bài mà quên khai là đỏ; xoá một bài mà quên gỡ tick cũng
 * đỏ. Dấu tick vì thế không thể nói dối quá một lượt chạy.
 */
test.describe('Bản kiểm kê tự canh chính nó', () => {
  const SELF = fileURLToPath(import.meta.url);
  /** Chuẩn hoá CRLF: mọi phép cắt bên dưới giả định LF (repo này lưu CRLF). */
  const read = (path: string) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
  /** Bản kiểm kê nằm ở chính file này. */
  const source = read(SELF);
  /**
   * Các bài nằm ở `di-khap-giao-dien-NN-*.spec.ts` cạnh file này, mỗi file một nhóm phòng
   * (QA-04). Số thứ tự trong tên giữ thứ tự chạy như lúc các khối còn chung một file
   * (`workers: 1`, file chạy theo thứ tự tên).
   */
  const testSource = readdirSync(dirname(SELF))
    .filter((f) => /^di-khap-giao-dien-\d{2}-.+\.spec\.ts$/.test(f))
    .map((f) => read(join(dirname(SELF), f)))
    .concat(source)
    .join('\n');

  /** Ba bài của CHÍNH cổng này không nằm trong bản kiểm kê — chúng canh nó, không phải nội dung của nó. */
  const GATE_TITLES = [
    'mỗi dòng → trong bản kiểm kê phải trỏ tới một bài CÓ THẬT',
    'mỗi bài trong file phải có mặt đúng một lần trong bản kiểm kê',
    'dấu tick phải nói đúng trạng thái: [x] chạy thật, [~] đang treo, [ ] chưa có bài',
  ];

  interface InventoryEntry {
    mark: string;
    label: string;
    title: string | null;
  }

  /** Đọc bản kiểm kê: `[x] nhãn` và dòng `→ tên bài` đi ngay sau nó (nếu có). */
  function readInventory(): InventoryEntry[] {
    const out: InventoryEntry[] = [];
    const lines = source.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      const item = /^ \* \[([x~ ])\] (.+)$/.exec(lines[i]);
      if (!item) continue;
      const next = /^ \* {5}→ (.+)$/.exec(lines[i + 1] ?? '');
      out.push({ mark: item[1], label: item[2], title: next ? next[1] : null });
    }
    return out;
  }

  /** Mọi bài trong file, kèm cờ nó có đang `test.fixme` hay không. */
  function readTests(): { title: string; fixme: boolean }[] {
    const out: { title: string; fixme: boolean }[] = [];
    const re = /^ {2}test(\.fixme)?\(\s*\n?\s*'([^']+)'/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(testSource)) !== null) {
      out.push({ title: m[2], fixme: m[1] !== undefined });
    }
    return out;
  }

  /*
   * TỰ CANH TRƯỚC KHI CANH NGƯỜI KHÁC. Hai hàm đọc ở trên đều bằng biểu thức chính quy trên mã
   * nguồn, và một biểu thức hỏng thì trả về mảng RỖNG — lúc đó cả ba bài dưới đây vẫn xanh
   * trong khi chẳng kiểm gì cả. Chốt sàn để kiểu hỏng đó không im lặng được.
   */
  test('mỗi dòng → trong bản kiểm kê phải trỏ tới một bài CÓ THẬT', () => {
    const inventory = readInventory();
    const tests = readTests();
    expect(inventory.length, 'không đọc được bản kiểm kê — cổng này đang mù').toBeGreaterThan(50);
    expect(tests.length, 'không đọc được bài kiểm nào — cổng này đang mù').toBeGreaterThan(50);

    const actual = new Set(tests.map((b) => b.title));
    const dangling = inventory
      .filter((m) => m.title !== null && !actual.has(m.title))
      .map((m) => `[${m.mark}] ${m.label} → ${m.title ?? ''}`);
    expect(
      dangling,
      'bản kiểm kê tick cho một bài không còn tồn tại — đổi tên bài thì phải sửa cả dòng → của nó',
    ).toEqual([]);
  });

  test('mỗi bài trong file phải có mặt đúng một lần trong bản kiểm kê', () => {
    const inventory = readInventory();
    const tests = readTests().filter((b) => !GATE_TITLES.includes(b.title));
    expect(tests.length, 'không đọc được bài kiểm nào — cổng này đang mù').toBeGreaterThan(50);

    const declared = inventory.map((m) => m.title).filter((t): t is string => t !== null);
    const undeclared = tests.map((b) => b.title).filter((t) => !declared.includes(t));
    expect(
      undeclared,
      'có bài kiểm không nằm trong bản kiểm kê — thêm bài thì phải khai vào, không thì bản đồ thiếu một phòng',
    ).toEqual([]);

    const duplicateDeclarations = declared.filter((t, i) => declared.indexOf(t) !== i);
    expect(duplicateDeclarations, 'một bài được khai hai lần — bản kiểm kê phải là ánh xạ một-một').toEqual([]);
  });

  test('dấu tick phải nói đúng trạng thái: [x] chạy thật, [~] đang treo, [ ] chưa có bài', () => {
    const inventory = readInventory();
    const fixme = new Set(readTests().filter((b) => b.fixme).map((b) => b.title));
    expect(inventory.length, 'không đọc được bản kiểm kê — cổng này đang mù').toBeGreaterThan(50);

    const falseClaims: string[] = [];
    for (const m of inventory) {
      if (m.mark === 'x') {
        if (m.title === null) falseClaims.push(`[x] "${m.label}" — tick mà không chỉ ra bài nào giữ nó`);
        else if (fixme.has(m.title)) falseClaims.push(`[x] "${m.label}" — bài đang test.fixme, phải là [~]`);
      } else if (m.mark === '~') {
        if (m.title === null) falseClaims.push(`[~] "${m.label}" — treo mà không chỉ ra bài nào`);
        else if (!fixme.has(m.title)) falseClaims.push(`[~] "${m.label}" — bài đã chạy thật rồi, phải là [x]`);
      } else if (m.title !== null) {
        falseClaims.push(`[ ] "${m.label}" — nói chưa đi mà lại chỉ ra một bài; sửa dấu thành [x] hoặc [~]`);
      }
    }
    expect(
      falseClaims,
      'dấu tick nói một đằng, bài kiểm làm một nẻo — đây đúng là kiểu hỏng bản kiểm kê sinh ra để chặn',
    ).toEqual([]);
  });
});

