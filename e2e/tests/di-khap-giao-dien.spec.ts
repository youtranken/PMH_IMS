import { expect, test, type Locator, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  APP_ORIGIN,
  E2E_MEMBER,
  E2E_SA,
  SECOND_BROWSER,
  catalogItem,
  confirmAction,
  expireStepUp,
  fillLogin,
  devicesPageButton,
  firstLogin,
  freshTotpCode,
  ispProviderId,
  logout,
  resetAccessList,
  resetApprovals,
  resetCatalog,
  resetDevices,
  resetDigestRules,
  isoInDays,
  resetIpam,
  resetIsp,
  resetSecrets,
  resetServiceAccounts,
  resetSoftware,
  resetUsers,
  rowAction,
  mailpitMessages,
  rowActionNames,
  sql,
  timVaChoLoc,
  writeHeaders,
  uniqueStamp,
} from './helpers';

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
 * Bản kiểm kê này KHÔNG phải chú thích trang trí: khối `test.describe` đầu tiên bên dưới đọc
 * chính file này và bắt bẻ nó — mỗi `→` phải trỏ tới một bài CÓ THẬT, mỗi bài trong file phải
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
 * [x] Link sâu ?tab= mở đúng tab — VÁ 19/09: tab mọc-theo-dữ-liệu ở lại trong lúc đang tải
 *     → Link sâu ?tab=devices phải mở đúng tab "Máy đang dùng", không rơi về tab Hồ sơ
 *
 * ── PHÒNG ĐỊA CHỈ IP và PHÒNG SỔ NAT ────────────────────────────────────────
 * [x] Đầu trang · rail dải · menu thẻ dải ĐỔI theo dải trống hay đã dùng
 *     → Phòng Địa chỉ IP: nút đầu trang, rail dải, và menu mỗi thẻ đổi theo dải trống hay dải đã dùng
 * [x] Pane phải: nhóm nút lọc · bảng địa chỉ · ô trống · ô tick hồ sơ đã ẩn
 *     → Pane phải màn Địa chỉ IP: nhóm nút lọc, bảng địa chỉ, ô trống và ô tick hồ sơ đã ẩn
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
 * Nên bản kiểm kê ở trên phải TỰ CHỨNG MINH. Ba bài dưới đây đọc chính file này và đối chiếu
 * hai chiều: mỗi dòng `→` phải trỏ tới một bài có thật, và mỗi bài trong file phải có mặt đúng
 * một lần trong bản kiểm kê. Thêm một bài mà quên khai là đỏ; xoá một bài mà quên gỡ tick cũng
 * đỏ. Dấu tick vì thế không thể nói dối quá một lượt chạy.
 */
test.describe('Bản kiểm kê tự canh chính nó', () => {
  const SELF = fileURLToPath(import.meta.url);
  /** Chuẩn hoá CRLF: mọi phép cắt bên dưới giả định LF (repo này lưu CRLF). */
  const source = readFileSync(SELF, 'utf8').replace(/\r\n/g, '\n');

  /** Ba bài của CHÍNH cổng này không nằm trong bản kiểm kê — chúng canh nó, không phải nội dung của nó. */
  const GATE_TITLES = [
    'mỗi dòng → trong bản kiểm kê phải trỏ tới một bài CÓ THẬT',
    'mỗi bài trong file phải có mặt đúng một lần trong bản kiểm kê',
    'dấu tick phải nói đúng trạng thái: [x] chạy thật, [~] đang treo, [ ] chưa có bài',
  ];

  interface Muc {
    mark: string;
    label: string;
    title: string | null;
  }

  /** Đọc bản kiểm kê: `[x] nhãn` và dòng `→ tên bài` đi ngay sau nó (nếu có). */
  function docKiemKe(): Muc[] {
    const out: Muc[] = [];
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
  function docCacBai(): { title: string; fixme: boolean }[] {
    const out: { title: string; fixme: boolean }[] = [];
    const re = /^ {2}test(\.fixme)?\(\s*\n?\s*'([^']+)'/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) {
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
    const kiemKe = docKiemKe();
    const bai = docCacBai();
    expect(kiemKe.length, 'không đọc được bản kiểm kê — cổng này đang mù').toBeGreaterThan(50);
    expect(bai.length, 'không đọc được bài kiểm nào — cổng này đang mù').toBeGreaterThan(50);

    const coThat = new Set(bai.map((b) => b.title));
    const treoLoLung = kiemKe
      .filter((m) => m.title !== null && !coThat.has(m.title))
      .map((m) => `[${m.mark}] ${m.label} → ${m.title ?? ''}`);
    expect(
      treoLoLung,
      'bản kiểm kê tick cho một bài không còn tồn tại — đổi tên bài thì phải sửa cả dòng → của nó',
    ).toEqual([]);
  });

  test('mỗi bài trong file phải có mặt đúng một lần trong bản kiểm kê', () => {
    const kiemKe = docKiemKe();
    const bai = docCacBai().filter((b) => !GATE_TITLES.includes(b.title));
    expect(bai.length, 'không đọc được bài kiểm nào — cổng này đang mù').toBeGreaterThan(50);

    const daKhai = kiemKe.map((m) => m.title).filter((t): t is string => t !== null);
    const chuaKhai = bai.map((b) => b.title).filter((t) => !daKhai.includes(t));
    expect(
      chuaKhai,
      'có bài kiểm không nằm trong bản kiểm kê — thêm bài thì phải khai vào, không thì bản đồ thiếu một phòng',
    ).toEqual([]);

    const khaiTrung = daKhai.filter((t, i) => daKhai.indexOf(t) !== i);
    expect(khaiTrung, 'một bài được khai hai lần — bản kiểm kê phải là ánh xạ một-một').toEqual([]);
  });

  test('dấu tick phải nói đúng trạng thái: [x] chạy thật, [~] đang treo, [ ] chưa có bài', () => {
    const kiemKe = docKiemKe();
    const fixme = new Set(docCacBai().filter((b) => b.fixme).map((b) => b.title));
    expect(kiemKe.length, 'không đọc được bản kiểm kê — cổng này đang mù').toBeGreaterThan(50);

    const noiDoi: string[] = [];
    for (const m of kiemKe) {
      if (m.mark === 'x') {
        if (m.title === null) noiDoi.push(`[x] "${m.label}" — tick mà không chỉ ra bài nào giữ nó`);
        else if (fixme.has(m.title)) noiDoi.push(`[x] "${m.label}" — bài đang test.fixme, phải là [~]`);
      } else if (m.mark === '~') {
        if (m.title === null) noiDoi.push(`[~] "${m.label}" — treo mà không chỉ ra bài nào`);
        else if (!fixme.has(m.title)) noiDoi.push(`[~] "${m.label}" — bài đã chạy thật rồi, phải là [x]`);
      } else if (m.title !== null) {
        noiDoi.push(`[ ] "${m.label}" — nói chưa đi mà lại chỉ ra một bài; sửa dấu thành [x] hoặc [~]`);
      }
    }
    expect(
      noiDoi,
      'dấu tick nói một đằng, bài kiểm làm một nẻo — đây đúng là kiểu hỏng bản kiểm kê sinh ra để chặn',
    ).toEqual([]);
  });
});

test.describe('SA đi một vòng cả hệ thống', () => {
  test.beforeEach(() => {
    resetUsers();
    resetDevices();
    resetSoftware();
  });

  /** Một chặng trên thanh điều hướng: bấm nhãn nào, tới đường nào, thấy tiêu đề nào. */
  interface NavStop {
    /** Nhãn mục trong sidebar — khớp CHÍNH XÁC ("Tài khoản" không được vớ "Tài khoản dịch vụ"). */
    link: string;
    /** `pathname` mong đợi sau khi bấm. */
    path: string;
    /** `<h1>` của màn đích. Neo hai đầu để không khớp nhầm một tiêu đề dài hơn. */
    heading: RegExp;
  }

  /**
   * Bản đồ menu của vai SA, đúng thứ tự trong `web/src/shell/app-nav.ts`.
   * Mục `planned` (Tài liệu) KHÔNG có ở đây — nó được kiểm riêng bên dưới, vì nó không phải
   * link.
   */
  const NAV_STOPS: NavStop[] = [
    { link: 'Bảng điều khiển', path: '/', heading: /^Bảng điều khiển$/ },
    { link: 'Thiết bị', path: '/devices', heading: /^Thiết bị$/ },
    { link: 'Phần mềm', path: '/software', heading: /^Phần mềm$/ },
    { link: 'Đường truyền', path: '/isp-lines', heading: /^Đường truyền$/ },
    { link: 'Sắp hết hạn', path: '/expiry', heading: /^Sắp hết hạn$/ },
    { link: 'Địa chỉ IP', path: '/ip-addresses', heading: /^Địa chỉ IP$/ },
    { link: 'Sổ NAT', path: '/nat', heading: /^Sổ NAT$/ },
    { link: 'Tài khoản dịch vụ', path: '/service-accounts', heading: /^Tài khoản dịch vụ$/ },
    { link: 'Duyệt mở két', path: '/approvals', heading: /^Duyệt mở két$/ },
    { link: 'Két sắt', path: '/vault', heading: /^Két sắt$/ },
    { link: 'Kho thanh lý', path: '/disposal', heading: /^Kho thanh lý$/ },
    { link: 'Người dùng IMS', path: '/admin/accounts', heading: /^Người dùng IMS$/ },
    { link: 'Danh mục', path: '/admin/catalog', heading: /^Danh mục$/ },
    { link: 'Quyền két sắt', path: '/admin/vault-access', heading: /^Quyền két sắt$/ },
    { link: 'Nhật ký hệ thống', path: '/admin/audit-log', heading: /^Nhật ký hệ thống$/ },
    { link: 'Tham số hệ thống', path: '/admin/settings', heading: /^Tham số hệ thống$/ },
    { link: 'Bộ giao diện', path: '/dev/components', heading: /^Bộ giao diện$/ },
  ];

  /*
   * VÌ SAO BÀI NÀY TỒN TẠI
   *
   * `app-nav.ts` và `App.tsx` là HAI danh sách đường dẫn riêng, chỉ tình cờ gặp nhau ở
   * `PATHS`. Thêm một mục menu mà quên khai `<Route>` (hoặc gác nhầm vai) thì mục đó bấm vào
   * ra trang 404 — và không bài kiểm nào hiện có bắt được, vì mọi bài đều `goto` thẳng URL
   * đúng thay vì bấm menu.
   *
   * ĐỎ KHI: một mục menu trỏ sai đường, một route bị xóa hoặc gác nhầm vai (ra 404), một
   * `<h1>` đổi chữ mà i18n không đổi theo, hoặc mục "chưa mở" bỗng thành link bấm được
   * (đưa người dùng vào màn của epic chưa làm).
   */
  test('SA đi hết mọi mục trên thanh điều hướng bằng chuột', async ({ page }) => {
    // 15 lượt điều hướng + một luồng đăng nhập lần đầu: 60 giây mặc định không đủ.
    test.setTimeout(150_000);
    await firstLogin(page, E2E_SA);

    const nav = page.getByRole('navigation', { name: 'Điều hướng chính' });

    for (const stop of NAV_STOPS) {
      await nav.getByRole('link', { name: stop.link, exact: true }).click();

      await expect(
        page.getByRole('heading', { level: 1, name: stop.heading }),
        `Bấm menu "${stop.link}" phải mở đúng màn có tiêu đề ${stop.heading}`,
      ).toBeVisible();
      // Trang 404 cũng có <h1>, nên phải nói rõ nó KHÔNG được là trang 404.
      await expect(
        page.getByRole('heading', { name: 'Không tìm thấy trang' }),
        `Menu "${stop.link}" trỏ vào một đường không có route — người dùng nhận trang 404`,
      ).toHaveCount(0);
      expect(
        new URL(page.url()).pathname,
        `Menu "${stop.link}" phải đưa tới ${stop.path}`,
      ).toBe(stop.path);
    }

    /*
     * Mục của epic sau: `<span title="…">` kèm lời giải thích `sr-only`, KHÔNG phải `<a>`.
     * Nó có mặt để bản đồ điều hướng không phải vẽ lại mỗi epic — nhưng có mặt mà bấm
     * được thì tệ hơn không có.
     */
    for (const planned of ['Tài liệu']) {
      await expect(
        nav.getByRole('link', { name: planned, exact: true }),
        `"${planned}" thuộc epic sau — nó KHÔNG được là link bấm được`,
      ).toHaveCount(0);

      const label = nav.getByText(planned, { exact: true });
      await expect(
        label,
        `Mục "${planned}" vẫn phải hiện trong menu (chỗ đã dành sẵn cho epic sau)`,
      ).toBeVisible();

      const host = await label.evaluate((el) => {
        const owner = el.closest('[title]');
        return {
          text: owner?.textContent ?? '',
          title: owner?.getAttribute('title') ?? null,
        };
      });
      /*
       * Lời giải thích phải nằm trong CHỮ của mục (bản `sr-only`) — `title` chỉ tới được người
       * rê chuột, còn `aria-disabled` trên một <span> không vai trò thì trình đọc màn hình bỏ
       * qua (OLD-A11Y-01).
       */
      expect(
        host.text,
        `"${planned}" phải tự giải thích bằng chữ mà trình đọc màn hình đọc được`,
      ).toContain('Phần này chưa mở trong bản hiện tại');
      expect(
        host.title,
        `"${planned}" phải tự giải thích vì sao bấm không được, không im lặng`,
      ).toBe('Phần này chưa mở trong bản hiện tại');
    }
  });

  /*
   * VÌ SAO BÀI NÀY TỒN TẠI
   *
   * Đây là khoảng trống thật: chưa bài nào đi từ DANH SÁCH sang CHI TIẾT bằng cách bấm rồi
   * quay ra bằng breadcrumb. Cột "Mã thiết bị" cố ý là `<Link>` chứ không phải `onClick` trên
   * `<tr>` (để mở tab mới và chép link được) — nếu ai đó đổi lại thành `onClick`, hoặc
   * `PATHS.device(id)` ghép sai id, thì mọi bài `goto('/devices/<id>')` vẫn xanh y nguyên.
   *
   * Breadcrumb cũng vậy: nó đã GÁNH việc của nút "Về danh sách" đã bị bỏ. Mục đầu tiên mất
   * `to` là trang chi tiết trở thành ngõ cụt, mà không bài nào biết.
   *
   * ĐỎ KHI: ô mã thôi không còn là link, link ghép sai id, breadcrumb mất đường quay ra,
   * hoặc một tab của trang chi tiết không mở được / không sáng lên khi bấm.
   */
  test('SA bấm từ danh sách sang hồ sơ rồi đi hết các tab', async ({ page }) => {
    test.setTimeout(150_000);
    await firstLogin(page, E2E_SA);

    const stamp = uniqueStamp();
    const code = `SW-E2E-TOUR-${stamp}`;

    await page
      .getByRole('navigation', { name: 'Điều hướng chính' })
      .getByRole('link', { name: 'Thiết bị', exact: true })
      .click();
    await expect(page.getByRole('heading', { level: 1, name: /^Thiết bị$/ })).toBeVisible();

    // Tạo qua GIAO DIỆN (không phải API): cửa vào phải là đúng cái người dùng thật bấm.
    await devicesPageButton(page, 'Thêm thiết bị').click();
    const form = page.getByRole('dialog');
    await form.getByLabel('Mã thiết bị').fill(code);
    await form.getByLabel('Tên thiết bị').fill('Switch của bài đi một vòng');
    await form.getByRole('button', { name: 'Loại' }).click();
    await page.getByRole('option', { name: 'Switch', exact: true }).click();
    await form.getByRole('button', { name: 'Lưu' }).click();

    const row = page.getByRole('row', { name: new RegExp(code) });
    await expect(row, 'Thiết bị vừa tạo phải xuất hiện ngay trên danh sách').toBeVisible();

    // BẤM vào ô mã — không `goto`. Đây chính là điều bài này sinh ra để kiểm.
    await page.getByRole('main').getByRole('link', { name: code, exact: true }).click();

    await expect(
      page.getByRole('heading', { level: 1, name: new RegExp(code) }),
      'Bấm mã trên danh sách phải mở đúng hồ sơ của máy đó',
    ).toBeVisible();
    expect(
      new URL(page.url()).pathname,
      'Đường dẫn phải là /devices/<id>, không phải một đường ghép sai',
    ).toMatch(/^\/devices\/[0-9a-f-]{36}$/);

    /*
     * Đi hết CÁC TAB ĐANG CÓ, không gõ cứng danh sách: tab "Port map" chỉ hiện với loại
     * thiết bị bật port map, nên chốt cứng năm cái tên là bài kiểm sẽ đỏ vì lý do sai.
     * Đọc thanh tab ra rồi bấm từng cái — nhưng bốn tab LUÔN phải có mặt thì vẫn chốt cứng.
     */
    const tabNames = await page.getByRole('tab').allInnerTexts();
    expect(
      tabNames.length,
      `Hồ sơ thiết bị phải có ít nhất 4 tab, đang thấy: ${tabNames.join(' · ')}`,
    ).toBeGreaterThanOrEqual(4);

    for (const required of [/^Tổng quan/, /^Giấy tờ/, /^Két sắt/, /^Lịch sử/]) {
      await expect(
        page.getByRole('tab', { name: required }),
        `Thanh tab của hồ sơ thiết bị thiếu đúng một tab khớp ${required}`,
      ).toHaveCount(1);
    }

    /*
     * Đi theo VỊ TRÍ chứ không theo tên đọc được ra: nhãn tab có số đếm nối sau ("Giấy tờ 3"),
     * nên vòng tên-đọc-ra → tên-trợ-năng thêm một chỗ để trượt mà chẳng kiểm được gì thêm.
     */
    for (let i = 0; i < tabNames.length; i += 1) {
      const tab = page.getByRole('tab').nth(i);
      await tab.click();
      await expect(
        tab,
        `Bấm tab "${tabNames[i]}" thì chính nó phải sáng lên (aria-selected)`,
      ).toHaveAttribute('aria-selected', 'true');
      await expect(
        page.getByRole('tabpanel'),
        `Tab "${tabNames[i]}" phải mở ra một vùng nội dung, không phải khoảng trắng`,
      ).toBeVisible();
    }

    // Quay ra bằng BREADCRUMB — đường về duy nhất của trang chi tiết.
    await page
      .getByRole('navigation', { name: 'breadcrumb' })
      .getByRole('link', { name: 'Thiết bị', exact: true })
      .click();

    await expect(
      page.getByRole('heading', { level: 1, name: /^Thiết bị$/ }),
      'Bấm mục đầu của breadcrumb phải quay lại danh sách thiết bị',
    ).toBeVisible();
    expect(new URL(page.url()).pathname, 'Breadcrumb phải trả về đúng /devices').toBe('/devices');
  });

  /*
   * VÌ SAO BÀI NÀY TỒN TẠI
   *
   * `dashboard.spec.ts` kiểm rất kỹ SỐ LIỆU của từng khối, nhưng không bấm cái link ở cuối
   * khối lần nào. Mà mỗi khối chỉ vẽ link ấy khi `available && total > 0` — nghĩa là chúng là
   * nhánh code hiếm khi chạy trong test, đúng chỗ một `to={PATHS.…}` gõ sai sống lâu nhất.
   *
   * Bảng điều khiển là màn người dùng mở đầu tiên mỗi sáng. Nếu nó chỉ để NGẮM mà không nhảy
   * đi đâu được thì nó là một tấm ảnh, không phải bàn đạp.
   *
   * ĐỎ KHI: một link "Xem toàn bộ …" trỏ sai màn hoặc trỏ vào 404.
   *
   * Gieo sẵn MỘT hồ sơ sắp hết hạn để khối đầu chắc chắn có link — bài kiểm không được phép
   * xanh vì nó chẳng kiểm gì cả. Ba khối còn lại phụ thuộc dữ liệu sẵn có nên bỏ qua TƯỜNG
   * MINH (kiểm `count()` trước), và cuối bài chốt lại link nào đã thật sự đi qua.
   */
  test('Bảng điều khiển là bàn đạp, không phải ảnh tĩnh', async ({ page }) => {
    test.setTimeout(150_000);
    await firstLogin(page, E2E_SA);

    const stamp = uniqueStamp();
    const soon = isoInDays(3);
    const seeded = await page.request.post('/api/v1/software', {
      headers: await writeHeaders(page),
      data: {
        code: `LIC-E2E-TOUR-${stamp}`,
        name: 'License mồi cho bài đi một vòng',
        kind: 'license',
        endDate: soon,
      },
    });
    expect(
      seeded.ok(),
      'Không gieo được hồ sơ sắp hết hạn thì phần còn lại của bài kiểm vô nghĩa',
    ).toBeTruthy();

    const stops: { label: string; path: string; heading: RegExp }[] = [
      { label: 'Xem toàn bộ danh sách hạn', path: '/expiry', heading: /^Sắp hết hạn$/ },
      { label: 'Xem toàn bộ dải mạng', path: '/ip-addresses', heading: /^Địa chỉ IP$/ },
      { label: 'Xem toàn bộ két sắt', path: '/vault', heading: /^Két sắt$/ },
      { label: 'Xem toàn bộ kho thanh lý', path: '/disposal', heading: /^Kho thanh lý$/ },
    ];

    const walked: string[] = [];
    const skipped: string[] = [];

    for (const stop of stops) {
      await page.goto('/');
      await expect(page.getByRole('heading', { level: 1, name: 'Bảng điều khiển' })).toBeVisible();
      /*
       * Chờ ĐÚNG cái link chắc chắn có trước khi đếm mấy cái kia: cả bảng dựng từ MỘT lượt
       * gọi `/dashboard`, nên khi link này hiện là dữ liệu đã về hết. Đếm sớm hơn thì khối
       * nào cũng ra "không có dữ liệu" và bài kiểm bỏ qua sạch mà vẫn xanh.
       */
      await expect(
        page.getByRole('main').getByRole('link', { name: stops[0].label, exact: true }),
        'Đã gieo một hồ sơ hết hạn sau 3 ngày — khối "Sắp hết hạn" phải có link xem toàn bộ',
      ).toBeVisible();

      const link = page.getByRole('main').getByRole('link', { name: stop.label, exact: true });
      if ((await link.count()) === 0) {
        // Khối rỗng thì theo thiết kế nó KHÔNG vẽ link — bỏ qua, và nói ra là đã bỏ qua.
        skipped.push(stop.label);
        continue;
      }

      await link.click();
      await expect(
        page.getByRole('heading', { level: 1, name: stop.heading }),
        `Link "${stop.label}" phải mở đúng màn ${stop.path}`,
      ).toBeVisible();
      expect(new URL(page.url()).pathname, `Link "${stop.label}" trỏ sai đường`).toBe(stop.path);
      walked.push(stop.label);
    }

    expect(
      walked,
      `Phải đi được ít nhất link "Xem toàn bộ danh sách hạn" (đã bỏ qua: ${skipped.join(', ') || 'không có khối nào'})`,
    ).toContain(stops[0].label);
  });

  /*
   * VÌ SAO BÀI NÀY TỒN TẠI
   *
   * Nút đổi giao diện nằm ở topbar, ngoài mọi màn nghiệp vụ, nên không spec màn nào bấm nó.
   * `toggleTheme()` làm HAI việc: đặt `<html data-theme>` và ghi `localStorage`. Chỉ làm việc
   * đầu thì giao diện đổi ngay trước mắt nhưng mất sạch khi nạp lại — đúng kiểu hỏng người
   * dùng báo là "nó cứ tự sáng lại".
   *
   * ĐỎ KHI: nút không đổi `data-theme`, theme không dính lại sau khi chuyển màn hoặc nạp lại,
   * hoặc nhãn trợ năng của nút không lật theo trạng thái (người dùng bàn phím không biết bấm
   * vào sẽ ra sáng hay tối).
   */
  test('Đổi sáng/tối trên máy bàn và nó dính lại sau khi đổi trang', async ({ page }) => {
    await firstLogin(page, E2E_SA);

    const topbar = page.getByRole('banner');
    const themeOf = () => page.evaluate(() => document.documentElement.dataset.theme ?? '');

    /*
     * Khởi điểm phụ thuộc `prefers-color-scheme` của trình duyệt chạy test, nên đưa về SÁNG
     * trước rồi mới đo. Không có bước này thì bài kiểm xanh/đỏ theo cấu hình máy chứ không
     * theo code.
     */
    if ((await themeOf()) === 'dark') {
      await topbar.getByRole('button', { name: 'Chuyển sang chế độ sáng' }).click();
    }
    expect(await themeOf(), 'Bài kiểm bắt đầu từ giao diện sáng').toBe('light');

    await topbar.getByRole('button', { name: 'Chuyển sang chế độ tối' }).click();
    expect(
      await themeOf(),
      'Bấm nút đổi giao diện phải đặt data-theme="dark" trên <html>',
    ).toBe('dark');
    await expect(
      topbar.getByRole('button', { name: 'Chuyển sang chế độ sáng' }),
      'Đang tối thì nhãn nút phải mời quay về sáng, không được đứng im',
    ).toBeVisible();

    // Đổi màn: theme phải theo người dùng, không theo từng trang.
    await page
      .getByRole('navigation', { name: 'Điều hướng chính' })
      .getByRole('link', { name: 'Thiết bị', exact: true })
      .click();
    await expect(page.getByRole('heading', { level: 1, name: /^Thiết bị$/ })).toBeVisible();
    expect(await themeOf(), 'Đổi trang xong vẫn phải còn tối').toBe('dark');

    // Và nạp lại cứng cũng vậy — đó mới là chỗ `localStorage` được dùng thật.
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: /^Thiết bị$/ })).toBeVisible();
    expect(
      await themeOf(),
      'Nạp lại trang mà mất theme = toggleTheme không ghi localStorage',
    ).toBe('dark');

    await page.getByRole('banner').getByRole('button', { name: 'Chuyển sang chế độ sáng' }).click();
    expect(await themeOf(), 'Bấm lần nữa phải quay về sáng').toBe('light');
  });

  /*
   * VÌ SAO BÀI NÀY TỒN TẠI
   *
   * Mọi bài kiểm hiện có mở hộp thoại bằng `.click()` của Playwright — thứ gọi thẳng sự kiện
   * click, kể cả trên một `<div onClick>` không bao giờ nhận được tiêu điểm bàn phím. Nghĩa
   * là "nút" có thể đã rơi khỏi luồng Tab từ lâu mà không bài nào biết.
   *
   * `ui/dialog.tsx` dựng trên Radix Dialog, và ba lời hứa của nó — tự đưa tiêu điểm VÀO hộp,
   * nhốt tiêu điểm ở đó, Esc đóng rồi TRẢ tiêu điểm về đúng nút đã mở — chưa ai kiểm. Mất lời
   * hứa thứ ba là người dùng bàn phím bị ném về đầu trang sau mỗi lần đóng hộp.
   *
   * ĐỎ KHI: nút "Thêm thiết bị" không tới được bằng Tab, Enter không mở hộp, tiêu điểm không
   * vào trong hộp, Esc không đóng, hoặc đóng xong tiêu điểm rơi mất.
   */
  /**
   * ĐIỂM DỪNG TAB ĐẦU TIÊN LÀ "BỎ QUA MENU" (WCAG 2.4.1, thêm 18/09/2026).
   *
   * `css/base.css` có sẵn luật `.skip-link` từ lâu — ẩn off-screen, hiện ra khi Tab tới —
   * nhưng tới 18/09 KHÔNG component nào render nó, nên luật ấy là CSS chết và người đi bàn
   * phím phải Tab qua trọn sidebar ở MỖI lần đổi trang. Bài "Bàn phím một mình cũng đi được"
   * ngay dưới đây đếm tới 80 lượt Tab để tới được nút đầu trang — đó chính là quãng đường ấy.
   *
   * Phải là một bài RIÊNG, ngay sau một lượt nạp trang: sau khi bấm chuột vào link điều hướng
   * thì tiêu điểm đang nằm ở link đó, nên Tab kế tiếp đi tới phần tử SAU nó chứ không quay về
   * đầu tài liệu — bản gộp vào bài kia đỏ đúng vì lý do này.
   *
   * Kiểm luôn nó ĐI TỚI ĐÂU: một skip-link trỏ vào hư không còn tệ hơn không có.
   */
  test('Tab lần đầu chạm ngay "Bỏ qua menu", và nó trỏ vào vùng nội dung', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    await page.goto('/devices');
    await expect(page.getByRole('heading', { level: 1, name: /^Thiết bị$/ })).toBeVisible();

    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: /Bỏ qua menu/ });
    await expect(skip).toBeFocused();
    await expect(skip).toHaveAttribute('href', '#noi-dung');
    // Đích đến phải CÓ THẬT, và phải đúng là vùng nội dung chính.
    await expect(page.getByRole('main')).toHaveAttribute('id', 'noi-dung');
  });

  test('Bàn phím một mình cũng đi được: Tab tới nút, Enter mở, Esc đóng', async ({ page }) => {
    test.setTimeout(150_000);
    await firstLogin(page, E2E_SA);

    await page
      .getByRole('navigation', { name: 'Điều hướng chính' })
      .getByRole('link', { name: 'Thiết bị', exact: true })
      .click();
    await expect(page.getByRole('heading', { level: 1, name: /^Thiết bị$/ })).toBeVisible();

    const addButton = devicesPageButton(page, 'Thêm thiết bị');
    await expect(addButton).toBeVisible();

    /*
     * Gõ Tab cho tới khi tới nút — KHÔNG dùng `.focus()`. Chính việc đi tới được mới là điều
     * cần chứng minh: `.focus()` gọi được trên cả thứ không hề nằm trong luồng Tab.
     * 80 lượt là dư cho sidebar (~15 mục) + chân sidebar + topbar + hàng nút đầu trang.
     */
    let reached = false;
    for (let i = 0; i < 80 && !reached; i += 1) {
      await page.keyboard.press('Tab');
      reached = await addButton.evaluate((el) => el === document.activeElement);
    }
    expect(
      reached,
      'Không gõ Tab tới được nút "Thêm thiết bị" — nút đã rơi khỏi luồng bàn phím',
    ).toBe(true);

    await page.keyboard.press('Enter');

    const dialog = page.getByRole('dialog');
    await expect(dialog, 'Enter trên nút phải mở hộp thoại y như bấm chuột').toBeVisible();

    /*
     * Tiêu điểm phải NẰM TRONG hộp. Không chốt đúng phần tử nào: Radix đưa tiêu điểm tới ô
     * nhận được đầu tiên, và thứ tự đó là chuyện nội bộ của khung hộp — chốt cứng vào nút ✕
     * là bài kiểm sẽ đỏ vì một lần đổi bố cục hoàn toàn vô hại.
     */
    const focusInside = await page.evaluate(
      () => document.activeElement?.closest('[role="dialog"]') != null,
    );
    expect(
      focusInside,
      'Mở hộp xong tiêu điểm phải nhảy vào TRONG hộp, không ở lại sau lưng lớp nền mờ',
    ).toBe(true);

    await page.keyboard.press('Escape');
    await expect(dialog, 'Esc phải đóng hộp "Thêm thiết bị" (lúc này chưa ghi gì)').toHaveCount(0);

    await expect(
      addButton,
      'Đóng hộp xong tiêu điểm phải TRẢ về đúng nút đã mở nó, không rơi về đầu trang',
    ).toBeFocused();
  });
});

/**
 * ===== PHẦN 2 — "SA dựng một Quản trị viên, rồi người đó vào làm việc" =====
 *
 * VÌ SAO KHỐI NÀY TỒN TẠI: hệ thống có ba vai (`sa` · `admin` · `member`) nhưng 67 file E2E
 * hiện có KHÔNG file nào chạm vai `admin` — hạt giống chỉ gieo hai tài khoản `e2e-sa@` và
 * `e2e-member@`. Nghĩa là mọi luật phân quyền dành riêng cho Quản trị viên chưa từng được
 * chứng minh: cả phần họ ĐƯỢC làm (két sắt, duyệt phiếu) lẫn phần họ KHÔNG được làm (quản trị
 * tài khoản, bộ giao diện). Khối này lấp đúng khoảng trống đó, và lấp bằng con đường một
 * người thật đi: SA tạo tài khoản QUA MÀN `/admin/accounts`, đọc mật khẩu tạm, rồi người mới
 * tự đăng nhập lần đầu.
 */
test.describe('Quản trị viên — vai chưa từng ai kiểm', () => {
  /**
   * Email BẮT BUỘC theo mẫu `e2e-tao-moi-%`: script dọn (`api/scripts/reset-e2e.mjs`, vùng
   * `users`) chỉ xoá đúng mẫu này. Sai một chữ là tài khoản ở lại DB vĩnh viễn và làm đỏ mọi
   * lượt chạy sau vì email trùng.
   */
  const ADMIN_EMAIL = 'e2e-tao-moi-admin@pmh.com.vn';
  const ADMIN_NAME = 'E2E Quản trị viên';

  test.beforeEach(() => {
    resetUsers();
    resetApprovals();
    resetAccessList();
    resetSecrets();
    resetDevices();
  });

  /**
   * Tạo tài khoản Quản trị bằng API của SA — dùng cho ba bài SAU, không dùng cho bài 1.
   *
   * Bài 1 cố tình đi qua GIAO DIỆN (đó chính là điều nó kiểm). Ba bài còn lại kiểm việc admin
   * LÀM ĐƯỢC GÌ, nên khúc dựng người được rút ngắn — mỗi bài đã phải trả giá hai lượt đăng
   * nhập đầy đủ kèm hai lần chờ mã TOTP mới rồi.
   */
  async function taoTaiKhoanAdmin(page: Page): Promise<string> {
    const created = await page.request.post('/api/v1/accounts', {
      headers: await writeHeaders(page),
      data: {
        email: ADMIN_EMAIL,
        fullName: ADMIN_NAME,
        role: 'admin',
        totpLoginRequired: true,
        phone: '',
        employeeCode: '',
        birthDate: '',
      },
    });
    expect(created.status(), 'SA phải tạo được tài khoản vai admin').toBe(201);
    const body = (await created.json()) as { temporaryPassword: string };
    expect(
      body.temporaryPassword.length,
      'API phải trả mật khẩu tạm — không có nó thì không ai đăng nhập lần đầu được',
    ).toBeGreaterThanOrEqual(12);
    return body.temporaryPassword;
  }

  /** Lấy id loại thiết bị "Switch" từ danh mục — mọi vai đều đọc được danh mục. */
  async function loaiSwitch(page: Page): Promise<string> {
    const res = await page.request.get('/api/v1/catalog');
    expect(res.status(), 'danh mục phải đọc được thì mới tạo được thiết bị').toBe(200);
    const catalog = (await res.json()) as { deviceTypes: { id: string; name: string }[] };
    const type = catalog.deviceTypes.find((item) => item.name === 'Switch');
    expect(type, 'hạt giống phải có loại thiết bị "Switch"').toBeTruthy();
    return type!.id;
  }

  /** Tạo một thiết bị (mã luôn chứa "E2E" để `resetDevices()` dọn được). */
  async function taoThietBi(page: Page, code: string, typeId: string): Promise<string> {
    const created = await page.request.post('/api/v1/devices', {
      headers: await writeHeaders(page),
      data: { code, name: `Switch ${code}`, deviceTypeId: typeId, serial: `FOC-${code}` },
    });
    expect(created.status(), `phải tạo được thiết bị ${code}`).toBe(201);
    return ((await created.json()) as { device: { id: string } }).device.id;
  }

  /**
   * ===== BÀI 1 =====
   *
   * Đây là bài NỀN của cả khối: nó dựng ra vai `admin` bằng đúng con đường con người dùng —
   * SA bấm vào màn `/admin/accounts`, điền form, đọc mật khẩu tạm hiện MỘT LẦN, rồi người mới
   * tự đi hết luồng lần đầu (mật khẩu tạm → cài 2 lớp → đổi mật khẩu).
   *
   * ĐỎ KHI: form tạo tài khoản không nhận vai `admin`; mật khẩu tạm không hiện ra (người mới
   * không bao giờ vào được); hoặc — quan trọng nhất — menu của admin sai. `visibleGroups()`
   * lọc theo `item.roles`, nên một lần thêm/xoá `roles` nhầm ở `app-nav.ts` sẽ bày ra cho
   * Quản trị viên một cánh cửa họ không được vào ("Tài khoản", "Bộ giao diện"), hoặc giấu mất
   * cửa họ cần ("Quyền két sắt", "Két sắt"). Không bài nào khác trong repo bắt được chuyện đó.
   */
  test('SA tạo tài khoản Quản trị, người đó đăng nhập lần đầu và thấy đúng phần việc của mình', async ({
    page,
  }) => {
    // Hai lượt đăng nhập đầy đủ (SA enroll → admin mới enroll), mỗi lượt chờ một mã TOTP chưa
    // dùng — vượt xa trần 60 giây mặc định.
    test.setTimeout(150_000);

    await firstLogin(page, E2E_SA);

    /*
     * `exact: true`: menu có cả "Tài khoản" (tài khoản đăng nhập IMS) lẫn "Tài khoản dịch vụ"
     * (0032) — khớp lỏng là trúng hai mục và Playwright từ chối ở chế độ strict.
     */
    await page.getByRole('link', { name: 'Người dùng IMS', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Người dùng IMS', exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Thêm tài khoản' }).click();
    const form = page.getByRole('dialog');
    await form.getByRole('textbox', { name: 'Họ tên' }).fill(ADMIN_NAME);
    await form.getByRole('textbox', { name: 'Email' }).fill(ADMIN_EMAIL);
    // Vai trò là ba lựa chọn radio có mô tả (nhóm "Vai trò").
    await form.getByRole('group', { name: 'Vai trò' }).getByRole('radio', { name: /^Quản trị/ }).check();
    await form.getByRole('button', { name: 'Lưu' }).click();

    // Mật khẩu tạm hiện ĐÚNG MỘT LẦN — đọc trượt là bài này không đi tiếp được.
    await expect(page.getByText('Mật khẩu tạm')).toBeVisible();
    const matKhauTam = (await page.getByTestId('temp-password').innerText()).trim();
    expect(
      matKhauTam.length,
      'mật khẩu tạm phải đủ dài — đây là thứ duy nhất mở được tài khoản mới',
    ).toBeGreaterThanOrEqual(12);

    /*
     * Nhãn nút là một LỜI XÁC NHẬN chứ không phải "Đóng" (rà UI/UX 12/09): hộp này chặn Esc
     * và chặn click-nền, nên bấm nút là đường ra DUY NHẤT — và người bấm phải tự khẳng định
     * đã ghi lại mật khẩu, vì không có lần hiện thứ hai.
     */
    await page.getByRole('button', { name: 'Tôi đã ghi lại mật khẩu này', exact: true }).click();

    const dong = page.getByRole('row', { name: new RegExp(ADMIN_NAME) });
    await expect(dong).toBeVisible();
    await expect(
      dong.getByText('Quản trị', { exact: true }),
      'dòng vừa tạo phải mang huy hiệu vai Quản trị, không phải Thành viên mặc định',
    ).toBeVisible();

    // Cửa DUY NHẤT để đăng xuất (helpers.logout) — bấm thẳng nút thì lượt POST logout bị hủy
    // giữa đường và phiên cũ sống tiếp.
    await logout(page);

    // ===== Người mới vào làm việc =====
    await firstLogin(page, { email: ADMIN_EMAIL, password: matKhauTam });

    const menu = page.getByRole('navigation', { name: 'Điều hướng chính' });

    // Phần admin ĐƯỢC thấy.
    await expect(
      menu.getByRole('link', { name: 'Quyền két sắt', exact: true }),
      'Quản trị viên phải thấy ma trận Quyền két sắt — đó là việc của họ',
    ).toBeVisible();
    await expect(
      menu.getByRole('link', { name: 'Két sắt', exact: true }),
      'Quản trị viên phải thấy trang tổng Két sắt (Member thì không)',
    ).toBeVisible();
    await expect(menu.getByRole('link', { name: 'Danh mục', exact: true })).toBeVisible();
    await expect(menu.getByRole('link', { name: 'Duyệt mở két', exact: true })).toBeVisible();

    // Phần admin KHÔNG được thấy.
    await expect(
      menu.getByRole('link', { name: 'Người dùng IMS', exact: true }),
      'quản trị tài khoản là việc của SA — admin không được thấy cửa vào',
    ).toHaveCount(0);
    await expect(
      menu.getByRole('link', { name: 'Bộ giao diện', exact: true }),
      'Bộ giao diện là trang nội bộ của đội phát triển, chỉ SA',
    ).toHaveCount(0);
    await expect(
      menu.getByRole('link', { name: 'Tham số hệ thống', exact: true }),
      'nới/siết hàng rào đăng nhập và két là việc của SA (Q-14)',
    ).toHaveCount(0);

    /*
     * Mục "chưa mở" (Tài liệu) là chữ thường `<span>`, KHÔNG phải link. Kiểm bằng
     * "không có link mang tên đó" thay vì bám `title` — nếu một ngày ai đó biến nó thành link
     * trỏ vào hư không, bài này đỏ.
     */
    await expect(
      menu.getByRole('link', { name: 'Tài liệu', exact: true }),
      'màn thuộc epic sau chỉ được hiện mờ, không được là link',
    ).toHaveCount(0);
    // `audit.controller.ts` mở cho sa + admin — menu phải khớp cửa sau nó.
    await expect(
      menu.getByRole('link', { name: 'Nhật ký hệ thống', exact: true }),
      'Quản trị viên phải thấy Nhật ký hệ thống',
    ).toBeVisible();

    // Và cửa Két sắt phải MỞ THẬT, không chỉ hiện trên menu.
    await menu.getByRole('link', { name: 'Két sắt', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Két sắt', exact: true })).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Không tìm thấy trang' }),
      '/vault phải mở được với vai admin (App.tsx gác cho sa + admin)',
    ).toHaveCount(0);
  });

  /**
   * ===== BÀI 2 =====
   *
   * Một cánh cửa bị khoá phải NÓI ra là nó khoá. Bài này gõ thẳng bốn URL của SA bằng phiên
   * admin và khẳng định ĐIỀU THẬT SỰ XẢY RA — không phải điều dễ nghe.
   *
   * ĐÃ ĐỌC `web/src/App.tsx` (bản 09/09) trước khi viết, và ba route ứng xử KHÁC NHAU:
   *
   *   • `/dev/components` — route chỉ được ĐĂNG KÝ khi `me.role === 'sa'` (App.tsx, khối
   *     `{me.role === 'sa' ? <Route …/> : null}`). Admin gõ URL rơi xuống `*` → 404. Gác thật
   *     ở web.
   *   • `/documents` — CHƯA có route nào cả (mục menu còn `planned`), nên mọi vai đều nhận
   *     404, kể cả SA.
   *   • `/admin/accounts` — **KHÔNG gác vai ở web**. `<Route path={PATHS.adminAccounts}
   *     element={<AccountsScreen me={me} />} />` nằm ngoài mọi điều kiện vai; `app-nav.ts` chỉ
   *     ẩn MỤC MENU (`roles: ['sa']`). Admin gõ thẳng URL thì màn VẪN dựng ra.
   *
   * Hàng rào thật của `/admin/accounts` nằm ở API: `AccountsController` mang `@Roles('sa')`
   * trên MỌI endpoint (AD-9), nên `GET /api/v1/accounts` trả 403 cho admin. Bài này vì thế
   * khẳng định hai thứ, và cả hai đều đáng giá:
   *   1. API là nơi chặn — 403, không phải 200 với danh sách rỗng.
   *   2. Màn PHẢI NÓI RA là nó không tải được (`LoadError`), tuyệt đối không được biến 403
   *      thành "Chưa có dữ liệu". Đây là kiểu hỏng nguy hiểm nhất của màn này: một Quản trị
   *      viên đọc "công ty không có tài khoản nào" và tin là mình vừa kiểm tra xong.
   *
   * ĐỎ KHI: một trong hai route 404 bỗng mở ra cho admin; hoặc `/admin/accounts` nuốt 403
   * thành bảng rỗng; hoặc API nới `@Roles` cho admin mà không ai bàn.
   */
  test('Quản trị viên gõ thẳng URL của SA thì hệ thống nói KHÔNG, chứ không im lặng', async ({
    page,
  }) => {
    test.setTimeout(150_000);

    await firstLogin(page, E2E_SA);
    const matKhauTam = await taoTaiKhoanAdmin(page);
    await logout(page);

    await firstLogin(page, { email: ADMIN_EMAIL, password: matKhauTam });

    // --- Trang có thật nhưng không dành cho vai này → 403 nói rõ thiếu quyền (MISC-001);
    //     trang chưa có route → 404.
    await page.goto('/dev/components');
    await expect(
      page.getByRole('heading', { name: 'Bạn không có quyền xem trang này' }),
      'admin gõ /dev/components phải nhận trang 403 nói rõ thiếu quyền, không phải "không tồn tại"',
    ).toBeVisible();
    await page.goto('/documents');
    await expect(
      page.getByRole('heading', { name: 'Không tìm thấy trang' }),
      'admin gõ /documents phải nhận trang 404 tử tế, không phải màn trắng hay redirect câm',
    ).toBeVisible();

    // --- `/admin/accounts`: màn MỞ (web không gác), API mới là nơi chặn.
    const truoc = await page.request.get('/api/v1/accounts');
    expect(
      truoc.status(),
      'hàng rào thật nằm ở API: @Roles(\'sa\') phải trả 403 cho vai admin',
    ).toBe(403);

    await page.goto('/admin/accounts');
    /*
     * `/admin/accounts` — HAI HÀNG RÀO, và bài này chốt cả hai (B-09, sửa 22/09).
     *
     * Bản trước chốt rằng màn VẪN dựng ra cho admin, kèm câu "ĐÂY LÀ SỰ THẬT, không phải điều
     * mong muốn … ai muốn 404 thì phải sửa App.tsx, sửa xong hãy sửa bài này". Đã sửa
     * `App.tsx` (bảng `ROUTE_ROLES`), nên sửa bài này theo — đúng lời dặn của chính nó.
     *
     * Vế API ngay trên giữ NGUYÊN: router gác là tiện cho người dùng, `@Roles('sa')` mới là
     * hàng rào. Bỏ vế ấy thì một lượt "dọn dẹp" App.tsx sau này gỡ mất lớp router mà không gì
     * kêu lên rằng cửa sau đang mở.
     */
    await expect(
      page.getByRole('heading', { name: 'Bạn không có quyền xem trang này' }),
      'router cũng gác: admin gõ thẳng URL của SA nhận trang 403',
    ).toBeVisible();

    /*
     * KHỐI "403 phải nói ra là lỗi QUYỀN" ĐÃ RỜI KHỎI ĐÂY (B-09, 22/09).
     *
     * Vế cũ chốt một điều thật sự đáng giá: 403 phải hiện thành khối lỗi nói rõ "Bạn không có
     * quyền", KHÔNG được hoá thành "Chưa có dữ liệu" — câu đọc lên nghe như "công ty chưa có
     * tài khoản nào", một lời nói dối với người vừa bị từ chối.
     *
     * Route đã 404 thì admin không còn tới được nhánh ấy qua cửa này, nên vế đó không còn chỗ
     * đứng Ở ĐÂY. Nó KHÔNG mất: `web/src/ui/load-state.test.tsx` canh đúng hành vi đó ở tầng
     * component — "in đúng câu API gửi về" và "403 không có câu kèm → nói là thiếu quyền,
     * không nói là lỗi tải". Đó mới là chỗ đúng của một component dùng chung: nó áp cho MỌI
     * màn, không chỉ cho hai màn quản trị.
     */
  });

  /**
   * ===== BÀI 3 =====
   *
   * Vai admin ĐƯỢC làm trọn việc két sắt: cất · xem · xoay. `vault-panel.tsx` dựng nút theo
   * `isAdmin = role === 'sa' || role === 'admin'`, nhưng cho tới nay chỉ nhánh `sa` từng chạy
   * trong E2E — nhánh `admin` là code chưa ai bấm thử.
   *
   * ĐỎ KHI: admin không thấy nút "Cất mật khẩu/khóa" hoặc menu Sửa/Xoay/Thu hồi; API chặn nhầm vai
   * admin ở đường ghi két; bước xác thực (step-up) không bật lên khi grace đã hết; hoặc — tệ
   * nhất — giá trị xoay xong mà lượt Xem vẫn trả giá trị cũ.
   *
   * Thứ tự cố ý: cất → XEM (qua step-up) → xoay → XEM LẠI. Chỉ tốn MỘT lần gõ TOTP: sau
   * step-up thành công server mở grace, nên lượt xem thứ hai không bị hỏi lại — và chính lượt
   * thứ hai mới chứng minh việc xoay có tác dụng thật.
   */
  test('Quản trị viên làm được việc két sắt: cất, xem, xoay', async ({ page }) => {
    test.setTimeout(150_000);

    await firstLogin(page, E2E_SA);
    const matKhauTam = await taoTaiKhoanAdmin(page);
    await logout(page);

    const adminTotp = await firstLogin(page, { email: ADMIN_EMAIL, password: matKhauTam });

    const stamp = uniqueStamp();
    const code = `SW-E2E-ADMIN-${stamp}`;
    // Chính việc tạo được thiết bị đã là một khẳng định: vai admin có quyền GHI hồ sơ.
    const deviceId = await taoThietBi(page, code, await loaiSwitch(page));

    const label = `admin web E2E ${stamp}`;
    const giaTriGoc = `Adm1n#Goc#${stamp}`;
    const giaTriMoi = `Adm1n#Moi#${stamp}`;

    await page.goto(`/devices/${deviceId}`);
    await page.getByRole('tab', { name: 'Két sắt' }).click();
    await expect(page.getByText('Két chưa có ngăn nào')).toBeVisible();

    // --- CẤT.
    await expect(
      page.getByRole('button', { name: 'Cất mật khẩu/khóa' }),
      'admin phải thấy nút cất secret — vault-panel dựng nút này theo isAdmin',
    ).toBeVisible();
    await page.getByRole('button', { name: 'Cất mật khẩu/khóa' }).click();
    const form = page.getByRole('dialog');
    await form.getByRole('textbox', { name: 'Tên gọi' }).fill(label);
    await form.getByRole('textbox', { name: 'Tên đăng nhập' }).fill('admin');
    await form.getByRole('textbox', { name: 'Giá trị', exact: true }).fill(giaTriGoc);
    await form.getByRole('button', { name: 'Lưu' }).click();

    const dong = page.getByRole('row', { name: new RegExp(label) });
    await expect(dong).toBeVisible();
    // Bảng CHỈ có metadata (FR-021/FR-026): giá trị không được nằm ở đâu trên trang.
    await expect(
      page.getByText(giaTriGoc),
      'giá trị bí mật không được lộ trên bảng, kể cả trong DOM ẩn',
    ).toHaveCount(0);

    /*
     * Ép hết grace step-up thay vì ngồi chờ 10 phút. Không có bước này thì hộp "Xác nhận danh
     * tính" có thể không bật lên (vì vừa đăng nhập xong), và bài kiểm sẽ treo ở chỗ chờ một
     * hộp thoại không bao giờ tới — một lượt đỏ chẳng nói lên điều gì.
     */
    expireStepUp(ADMIN_EMAIL);

    // --- XEM (đi qua bước xác thực bằng mã TOTP thật).
    await page.getByRole('button', { name: 'Xem' }).click();
    await expect(page.getByRole('dialog', { name: 'Xác nhận danh tính' })).toBeVisible();
    await page.getByLabel('Mã xác thực').fill(await freshTotpCode(adminTotp));
    await expect(
      page.getByTestId('secret-value'),
      'sau khi xác thực, admin phải đọc được đúng giá trị đã cất',
    ).toHaveText(giaTriGoc);
    await page.getByRole('button', { name: 'Ẩn ngay' }).click();

    // --- XOAY.
    await rowAction(page, label, 'Đổi giá trị');
    const hopXoay = page.getByRole('dialog');
    await hopXoay.getByRole('textbox', { name: 'Giá trị mới' }).fill(giaTriMoi);
    await hopXoay.getByRole('button', { name: 'Đổi giá trị' }).click();
    await expect(page.getByText('Đã đổi giá trị.')).toBeVisible();

    // --- XEM LẠI: grace còn hiệu lực nên không bị hỏi mã nữa, và giá trị phải là bản MỚI.
    await page.getByRole('button', { name: 'Xem' }).click();
    await expect(
      page.getByTestId('secret-value'),
      'xoay xong mà lượt xem vẫn trả giá trị cũ thì việc xoay chỉ là hình thức',
    ).toHaveText(giaTriMoi);
  });

  /**
   * ===== BÀI 4 =====
   *
   * Hai nút "Từ chối" và "Thu hồi sớm" trên `/approvals` CHƯA BAO GIỜ được bấm trên giao diện
   * trong cả bộ E2E — `break-glass.spec.ts` chỉ đi đường "Duyệt". Đó là khoảng trống thật, và
   * nó nằm đúng ở hai nhánh lấy-quyền-đi: từ chối một phiếu đang chờ, và cắt sớm một quyền đã
   * cấp (`BREAK_GLASS_FLOW`: `pending→denied`, `approved→revoked`).
   *
   * ĐỎ KHI: hộp quyết định không mở cho vai admin; nút "Thu hồi sớm" không hiện ở tab Nhật ký
   * cho phiếu còn hiệu lực; hoặc — thứ chỉ DB nói ra được — bấm nút mà `state` trong bảng
   * `approval` không đổi, tức là giao diện báo xong mà quyền vẫn còn sống.
   *
   * Phần của Member dựng bằng `page.request` cho nhanh (đó không phải thứ bài này kiểm); phần
   * của admin thì BẤM THẬT từng nút.
   */
  test('Quản trị viên xử được phiếu xin quyền — cả từ chối lẫn thu hồi', async ({ page, browser }) => {
    // Ba lượt đăng nhập đầy đủ (SA → Member → admin mới), mỗi lượt một lần chờ mã TOTP mới.
    test.setTimeout(150_000);

    const stamp = uniqueStamp();
    const lyDoA = `E2E xin xem switch A ${stamp}`;
    const lyDoB = `E2E xin xem switch B ${stamp}`;

    // ===== SA: dựng người, dựng máy, mở tầng "cần duyệt" cho Member =====
    await firstLogin(page, E2E_SA);
    const matKhauTam = await taoTaiKhoanAdmin(page);

    const typeId = await loaiSwitch(page);
    const deviceA = await taoThietBi(page, `SW-E2E-DUYET-A-${stamp}`, typeId);
    const deviceB = await taoThietBi(page, `SW-E2E-DUYET-B-${stamp}`, typeId);

    const saHeaders = await writeHeaders(page);
    const granted = await page.request.post('/api/v1/vault/access', {
      headers: saHeaders,
      data: {
        memberEmail: E2E_MEMBER.email,
        scopeType: 'device_type',
        scopeRef: typeId,
        tier: 'needs_approval',
      },
    });
    expect(granted.status(), 'phải gán được tầng cần-duyệt thì Member mới xin được').toBeLessThan(300);
    await logout(page);

    // ===== Member: gửi HAI phiếu (mỗi chủ thể chỉ được một phiếu treo — nên phải hai máy) =====
    // Ngữ cảnh riêng, KHÔNG đăng xuất: phiên người xin chết thì lượt quét rút phiếu đang chờ
    // (Q-15) và admin không còn phiếu nào để xử. Đóng ngữ cảnh không đóng phiên.
    const memberCtx = await browser.newContext(SECOND_BROWSER);
    const memberPage = await memberCtx.newPage();
    await firstLogin(memberPage, E2E_MEMBER);
    const memberHeaders = await writeHeaders(memberPage);
    for (const [ownerId, reason] of [
      [deviceA, lyDoA],
      [deviceB, lyDoB],
    ] as const) {
      const sent = await memberPage.request.post('/api/v1/vault/break-glass', {
        headers: memberHeaders,
        data: { ownerType: 'device', ownerId, reason, hours: 4 },
      });
      expect(sent.status(), `Member phải gửi được phiếu: ${reason}`).toBe(201);
    }
    await memberCtx.close();

    // ===== Quản trị viên: xử phiếu bằng tay =====
    await firstLogin(page, { email: ADMIN_EMAIL, password: matKhauTam });
    await page.goto('/approvals');

    // Ba tab của người duyệt — Member chỉ có một, nên đây cũng là một khẳng định về vai.
    await expect(page.getByRole('tab', { name: /Chờ duyệt/ })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Nhật ký' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Yêu cầu của tôi' })).toBeVisible();

    await expect(page.getByText(lyDoA)).toBeVisible();
    await expect(page.getByText(lyDoB)).toBeVisible();

    // --- TỪ CHỐI một phiếu. Không đoán thứ tự hai thẻ: bấm cái đầu tiên rồi ĐỌC hộp thoại để
    //     biết mình vừa từ chối phiếu nào.
    await page.getByRole('button', { name: 'Từ chối', exact: true }).first().click();
    const hopTuChoi = page.getByRole('dialog');
    const lyDoBiTuChoi = (
      await hopTuChoi.getByText(/E2E xin xem switch [AB] /).innerText()
    ).trim();
    const lyDoDuocDuyet = lyDoBiTuChoi === lyDoA ? lyDoB : lyDoA;
    await hopTuChoi.getByRole('textbox', { name: 'Lý do từ chối' }).fill('E2E: chưa cần');
    await hopTuChoi.getByRole('button', { name: 'Từ chối', exact: true }).click();
    await expect(page.getByText('Đã từ chối.')).toBeVisible();
    /*
     * CHỜ hàng chờ thật sự rụng mất phiếu vừa từ chối, ĐỪNG bấm tiếp ngay sau toast.
     *
     * Toast hiện ra trong `onSuccess`, còn danh sách chỉ đổi sau khi lượt refetch của
     * `invalidateQueries` về. Ở giữa hai mốc đó màn vẫn còn HAI nút "Duyệt", và
     * `getByRole(...).click()` gặp hai phần tử là ném strict-mode violation NGAY — không
     * chờ lại. Đây là kiểu đỏ chập chờn tệ nhất: nó thắng cuộc đua trên máy nhanh.
     */
    await expect(page.getByText(lyDoBiTuChoi)).toHaveCount(0);

    // --- DUYỆT phiếu còn lại (giờ chỉ còn một, không cần `.first()`), cấp 1 giờ.
    await page.getByRole('button', { name: 'Duyệt', exact: true }).click();
    const hopDuyet = page.getByRole('dialog');
    await hopDuyet.getByRole('textbox', { name: 'Cấp trong bao lâu (giờ)' }).fill('1');
    await hopDuyet.getByRole('button', { name: 'Duyệt 1 giờ', exact: true }).click();
    await expect(page.getByText('Đã duyệt.')).toBeVisible();

    // Hàng chờ phải sạch — cả hai phiếu đã có người quyết.
    await expect(page.getByText('Không có yêu cầu nào đang chờ')).toBeVisible();

    // --- THU HỒI SỚM. Phiếu đã duyệt nằm ở tab Nhật ký; chỉ phiếu còn hiệu lực mới có nút này
    //     (phiếu bị từ chối thì không có). Quyền đang chạy nay được ghim thành nhóm "Đang có hiệu lực" ở đầu tab (VLT-020) nên
    //     nó hiện hai lần (nhóm + dòng nhật ký) — bấm ở nhóm ghim, chỗ người trực tìm tới.
    await page.getByRole('tab', { name: 'Nhật ký' }).click();
    const nhomHieuLuc = page.getByRole('region', { name: /^Đang có hiệu lực/ });
    await expect(nhomHieuLuc.getByText(lyDoDuocDuyet)).toBeVisible();
    await nhomHieuLuc.getByRole('button', { name: 'Thu hồi sớm' }).click();

    /*
     * TỪ 12/09 NÚT NÀY PHẢI HỎI LẠI (rà UI/UX #4).
     *
     * Nó cắt một quyền ĐANG CHẠY của người khác — có thể họ đang mở két giữa lúc xử sự cố —
     * mà lại nằm ngay dưới cặp Duyệt/Từ chối trên cùng một thẻ phiếu, nên trượt tay là cắt
     * nhầm. Hai chỗ anh em trong cụm Két sắt (gỡ quyền ở ma trận, thu hồi ngăn ở panel) đều
     * đã qua `askConfirm({ danger: true })`; riêng chỗ này đi thẳng vào `mutate`.
     *
     * Vế "chưa xác nhận thì CHƯA thu hồi" mới là vế có giá trị: một bản vá dựng hộp lên rồi
     * vẫn gọi API ngay cũng làm câu `toBeVisible` phía dưới xanh.
     */
    const hopThuHoi = page.getByRole('dialog');
    await expect(
      hopThuHoi.getByText(/Quyền này ĐANG chạy/),
      'câu hỏi lại phải nói rõ đang cắt thứ đang chạy, không phải một câu "chắc chưa?"',
    ).toBeVisible();
    expect(
      sql(`SELECT state FROM approval WHERE reason = '${lyDoDuocDuyet}'`),
      'mới mở hộp hỏi lại thì TUYỆT ĐỐI chưa được đụng vào sổ',
    ).toBe('approved');

    await hopThuHoi.getByRole('textbox', { name: 'Lý do thu hồi' }).fill('E2E: xong việc, cắt sớm');
    await confirmAction(page, 'Thu hồi sớm');
    await expect(page.getByText('Đã thu hồi quyền.')).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Thu hồi sớm' }),
      'thu hồi xong thì không còn gì để thu hồi nữa',
    ).toHaveCount(0);

    /*
     * VÀ HỎI THẲNG CƠ SỞ DỮ LIỆU.
     *
     * Toast là lời của giao diện; `approval.state` mới là thứ quyết định lần đọc két kế tiếp
     * (AD-6: hiệu lực kiểm tại MỖI lần đọc). Không có ba câu dưới đây thì một bản sửa làm nút
     * bấm xong chỉ hiện toast mà không ghi gì vẫn xanh — đúng kiểu hỏng để lại một quyền
     * break-glass còn sống trong khi mọi người tin là đã cắt.
     */
    expect(
      sql(`SELECT state FROM approval WHERE reason = '${lyDoBiTuChoi}'`),
      'phiếu bị bấm Từ chối phải nằm ở state denied',
    ).toBe('denied');
    expect(
      sql(`SELECT state FROM approval WHERE reason = '${lyDoDuocDuyet}'`),
      'phiếu đã duyệt rồi thu hồi sớm phải nằm ở state revoked, không phải approved',
    ).toBe('revoked');
    expect(
      sql(`SELECT decided_by FROM approval WHERE reason = '${lyDoBiTuChoi}'`),
      'người quyết phải là chính Quản trị viên vừa bấm — nhật ký phải chỉ đúng người',
    ).toBe(ADMIN_EMAIL);
  });
});

/* ===========================================================================================
 * PHẦN 3 — "Thành viên nhìn hệ thống hẹp hơn" + "Ba cửa quản trị chưa ai bấm bằng tay"
 * ===========================================================================================
 *
 * Hai khối dưới đây hỏi hai câu mà cả bộ E2E hiện tại chưa hỏi trọn vẹn:
 *
 *  1. Hệ thống HẸP LẠI đúng chỗ nào khi người ngồi trước máy là Thành viên? Từng bài lẻ có
 *     kiểm một mục ("member không thấy mục Tài khoản"), nhưng chưa bài nào KIỂM KÊ cả thanh
 *     điều hướng một lượt. Thêm một mục quản trị mà quên gắn `roles` là lỗi im lặng: nó không
 *     làm đỏ bài nào, chỉ bày một cánh cửa ra cho người không được vào.
 *
 *  2. Ba việc quản trị nặng nhất — đặt lại mật khẩu, đặt lại 2 lớp, khóa/mở tài khoản — đã có
 *     bài kiểm GỌI API và bài kiểm SỬA THẲNG DB, nhưng NÚT trên màn Tài khoản thì chưa một
 *     lần nào được bấm. Nút gọi sai endpoint, nút mất nhãn, nút mất luôn khỏi menu ba chấm:
 *     cả ba đều để bộ E2E xanh nguyên.
 */

test.describe('Thành viên thấy một hệ thống hẹp hơn', () => {
  test.beforeEach(() => {
    resetUsers();
    resetApprovals();
    resetAccessList();
    resetSecrets();
    resetDevices();
  });

  /**
   * TẠI SAO BÀI NÀY TỒN TẠI
   *
   * `app-nav.ts` là nơi DUY NHẤT quyết định ai thấy cửa nào, và nó quyết định bằng một
   * trường tùy chọn: `roles?: Me['role'][]`. Quên trường đó khi thêm mục mới thì mục ấy hiện
   * cho MỌI vai — TypeScript không đỏ (nó tùy chọn), lint không đỏ, và không bài kiểm nào
   * hiện có đếm số mục. Thành viên sẽ thấy một cửa mà bấm vào chỉ nhận 404 hoặc màn lỗi.
   *
   * Bài này đỏ khi: một mục quản trị rò rỉ sang vai member (danh sách dài ra), một mục
   * nghiệp vụ bị gắn `roles` nhầm (danh sách ngắn lại), hoặc mục "Tài liệu" của epic sau
   * biến thành link bấm được trong khi màn hình chưa hề tồn tại.
   */
  test('Thanh điều hướng của Thành viên thiếu đúng những thứ phải thiếu', async ({ page }) => {
    await firstLogin(page, E2E_MEMBER);

    const nav = page.getByRole('navigation', { name: 'Điều hướng chính' });
    await expect(nav).toBeVisible();

    /*
     * KIỂM KÊ chứ không chỉ kiểm một mục: so cả danh sách, sắp xếp trước khi so để thứ tự
     * hiển thị đổi (việc UX làm được) không kéo bài này đỏ theo.
     */
    const seen = (await nav.getByRole('link').allInnerTexts())
      .map((text) => text.trim())
      .sort();
    const expected = [
      // 10 link nghiệp vụ (chia nhóm Tổng quan · Tài sản · Mạng · Bảo mật) + mục "Tài liệu"
      // không phải link (xem dưới).
      'Bảng điều khiển',
      'Thiết bị',
      'Phần mềm',
      'Đường truyền',
      'Sắp hết hạn',
      'Địa chỉ IP',
      'Sổ NAT',
      'Tài khoản dịch vụ',
      // Member chỉ xin, không duyệt — nên cửa này mang tên việc của họ (VLT-026), cùng
      // đường `/approvals` mà SA/Admin thấy là "Duyệt yêu cầu".
      'Xin mở két',
      'Kho thanh lý',
      // Nhóm "Hệ thống" — đúng MỘT mục.
      'Danh mục',
    ].sort();
    expect(
      seen,
      'Thành viên phải thấy đúng 11 cửa bấm được — thừa một mục là quên gắn `roles`, thiếu một mục là gắn nhầm',
    ).toEqual(expected);

    // Nhãn nhóm vẫn phải còn: "Hệ thống" biến mất nghĩa là Danh mục cũng đã rơi mất; nhóm
    // "Dành cho nhà phát triển" chỉ SA thấy (SHELL-008, SHELL-012).
    for (const nhom of ['Tổng quan', 'Tài sản', 'Mạng', 'Bảo mật', 'Hệ thống']) {
      await expect(nav.getByText(nhom, { exact: true })).toBeVisible();
    }
    await expect(nav.getByText('Dành cho nhà phát triển', { exact: true })).toHaveCount(0);

    /*
     * Bốn cửa PHẢI KHÔNG có. Viết rời từng cái thay vì tin vào phép so danh sách ở trên, vì
     * thông điệp lúc đỏ mới là thứ có giá trị: "Két sắt lọt vào menu member" đọc một phát
     * hiểu ngay, còn "hai mảng khác nhau" thì phải ngồi so mắt.
     *
     * `exact: true` ở "Tài khoản": menu còn có "Tài khoản dịch vụ" — thứ hoàn toàn khác, và
     * member ĐƯỢC thấy. Khớp lỏng là bài này đỏ oan.
     */
    await expect(
      nav.getByRole('link', { name: 'Két sắt', exact: true }),
      'trang tổng Két sắt là bản đồ "công ty giữ bí mật ở đâu" — chỉ SA/Admin',
    ).toHaveCount(0);
    await expect(
      nav.getByRole('link', { name: 'Người dùng IMS', exact: true }),
      'màn quản trị tài khoản chỉ của SA',
    ).toHaveCount(0);
    await expect(
      nav.getByRole('link', { name: 'Quyền két sắt', exact: true }),
      'ma trận quyền là bản đồ phòng thủ — chỉ SA/Admin',
    ).toHaveCount(0);
    await expect(
      nav.getByRole('link', { name: 'Bộ giao diện', exact: true }),
      'trang nội bộ của đội phát triển — chỉ SA',
    ).toHaveCount(0);

    // Còn Danh mục thì PHẢI có: form thiết bị cần biết danh mục có gì (quyền sửa do API chặn).
    await expect(nav.getByRole('link', { name: 'Danh mục', exact: true })).toBeVisible();

    /*
     * "Tài liệu" là mục của epic sau: nó HIỆN RA (để bản đồ điều hướng không phải vẽ lại mỗi
     * epic) nhưng KHÔNG phải link — chữ thường `<span>`. Đây là chỗ dễ hỏng nhất
     * trong cả file `app-shell.tsx`: bỏ cờ `planned` sớm một epic là người dùng bấm vào và
     * rơi thẳng xuống trang 404, mà không lỗi biên dịch nào báo.
     */
    await expect(
      nav.getByText('Tài liệu', { exact: true }),
      'mục của epic sau vẫn phải hiện để giữ chỗ trên bản đồ điều hướng',
    ).toBeVisible();
    await expect(
      nav.getByRole('link', { name: 'Tài liệu', exact: true }),
      'màn Tài liệu chưa tồn tại — bày nó thành link là hứa một đường đi không có thật',
    ).toHaveCount(0);
  });

  /**
   * TẠI SAO BÀI NÀY TỒN TẠI
   *
   * Ẩn mục menu KHÔNG phải là gác cửa. Người dùng chép URL cho nhau qua chat, ghim vào trình
   * duyệt, hoặc chỉ đơn giản là gõ tay. Bài này đi thẳng vào bốn đường mà menu của Thành viên
   * đã đóng, rồi khẳng định ĐÚNG điều thật sự xảy ra ở mỗi đường — chứ không khẳng định điều
   * ta mong nó xảy ra.
   *
   * Và đó là hai chuyện khác nhau, vì `App.tsx` gác KHÔNG ĐỀU:
   *  - `/vault` và `/dev/components` bọc trong `me.role === ...` → route không tồn tại → 404.
   *  - `/documents` chưa có route nào cả → 404.
   *  - `/admin/accounts` và `/admin/vault-access` KHÔNG gác vai ở router. Màn VẪN render.
   *    Hàng rào thật nằm ở API (`@Roles('sa')` trên `accounts.controller.ts`), nên cái Thành
   *    viên nhìn thấy là một màn đầu trang bình thường + khối "Không tải được dữ liệu."
   *
   * Bài này đỏ khi: có người gỡ nhầm điều kiện vai ở `App.tsx` (404 thành màn thật), HOẶC
   * khi màn quản trị nuốt lỗi 403 thành "Chưa có dữ liệu" — thứ đọc lên nghe như "hệ thống
   * chưa có tài khoản nào", một câu nói dối trắng trợn với người vừa bị từ chối quyền.
   */
  test('Gõ thẳng URL không mở được cửa mà menu đã đóng', async ({ page }) => {
    await firstLogin(page, E2E_MEMBER);

    for (const [path, why, heading] of [
      ['/vault', 'trang tổng Két sắt gác vai ngay ở route', 'Bạn không có quyền xem trang này'],
      ['/dev/components', 'Bộ giao diện là trang nội bộ, chỉ SA', 'Bạn không có quyền xem trang này'],
      ['/admin/settings', 'Tham số hệ thống chỉ SA (Q-14)', 'Bạn không có quyền xem trang này'],
      ['/documents', 'màn Tài liệu thuộc epic sau — chưa có route nào', 'Không tìm thấy trang'],
    ] as const) {
      await page.goto(path);
      await expect(
        page.getByRole('heading', { name: heading }),
        `${path}: ${why} — gõ thẳng URL nhận "${heading}"`,
      ).toBeVisible();
    }

    /*
     * ===== HAI CỬA CÒN LẠI KHÔNG PHẢI 404, VÀ ĐÓ LÀ SỰ THẬT PHẢI GHI RA =====
     *
     * `/admin/accounts` và `/admin/vault-access` nằm ngoài mọi điều kiện vai trong `App.tsx`
     * — chúng chỉ bị ẩn khỏi menu. Viết `toBeVisible()` cho tiêu đề 404 ở đây là viết một bài
     * kiểm sai sự thật; viết `getByText('Chưa có dữ liệu')` cũng sai nốt.
     *
     * Điều THẬT SỰ xảy ra: màn render (đầu trang, cả nút "Thêm tài khoản" — nút đó không gác
     * vai), rồi lượt `GET /api/v1/accounts` nhận 403 và khối bảng đổi thành `LoadError`.
     * Hàng rào thật là `@Roles('sa')` ở API, và vế cuối bài này chốt đúng nó.
     */
    /*
     * HAI CỬA NÀY NAY CŨNG 404 (B-09, sửa 22/09).
     *
     * Chú thích ngay trên đây từng ghi: "Viết `toBeVisible()` cho tiêu đề 404 ở đây là viết
     * một bài kiểm sai sự thật", và bài chị em ở trên dặn thẳng: "ai muốn 404 thì phải sửa
     * App.tsx, sửa xong hãy sửa bài này". Đã sửa `App.tsx` — quyền theo đường dẫn nay nằm
     * trong bảng `ROUTE_ROLES` và cả năm cửa gác cùng một kiểu — nên bài này sửa theo.
     *
     * Vế "403 phải nói ra là lỗi QUYỀN, không hoá thành Chưa có dữ liệu" chuyển về
     * `web/src/ui/load-state.test.tsx`, nơi nó áp cho MỌI màn chứ không riêng hai màn này.
     */
    for (const path of ['/admin/accounts', '/admin/vault-access'] as const) {
      await page.goto(path);
      await expect(
        page.getByRole('heading', { name: 'Bạn không có quyền xem trang này' }),
        `${path}: router gác vai — Member gõ thẳng URL nhận trang 403`,
      ).toBeVisible();
    }

    // Hàng rào THẬT, ở đúng chỗ nó nằm.
    expect(
      (await page.request.get('/api/v1/accounts')).status(),
      'API mới là nơi chặn — ẩn mục menu chỉ là dọn nhà cho gọn',
    ).toBe(403);
    expect(
      (await page.request.get('/api/v1/vault/access')).status(),
      'ma trận quyền két sắt cũng chặn ở API',
    ).toBe(403);
  });

  /**
   * TẠI SAO BÀI NÀY TỒN TẠI
   *
   * Story 6.3 mở tab "Két sắt" cho MỌI vai, kể cả Thành viên chưa có quyền — cố ý, vì quyền
   * đến từ ma trận 6.2 cộng với grant còn hạn, và client không suy ra được từ vai. Đổi lại,
   * cái tab ấy phải tự nói rõ ba điều cùng lúc:
   *
   *   1. CÓ gì trong két (tên gọi secret) — không thì người ta không biết mình đang xin cái gì;
   *   2. mình đang đứng ở tầng nào và phải làm gì tiếp;
   *   3. và KHÔNG bày ra một nút ghi nào — bấm vào chỉ nhận 403, tức là bày ra để lừa.
   *
   * Bài này đi trọn cung đường của một Thành viên đứng trước két: nhìn, đọc, xin, và thấy
   * trạng thái đổi sang "Đang chờ duyệt". Nó đỏ khi `canEdit` của `VaultPanel` bị nới lỏng
   * (nút "Cất mật khẩu/khóa" hoặc menu ba chấm hiện ra), khi panel im lặng thay vì nói tầng, hoặc
   * khi hộp xin quyền gửi xong mà giao diện không đổi trạng thái — cái cuối là kiểu hỏng
   * khiến người dùng bấm gửi ba lần rồi đi hỏi tay.
   */
  test('Thành viên đứng trước két: thấy tên gọi, xin được quyền, nhưng không có một nút ghi nào', async ({
    page,
  }) => {
    // Hai lượt đăng nhập đầy đủ (SA dựng dữ liệu → Member đi xem), mỗi lượt phải chờ một mã
    // TOTP chưa dùng để tránh chống-replay. Trần 60 giây mặc định không đủ.
    test.setTimeout(150_000);

    // --- SA dựng: một thiết bị + một secret, rồi gán Member tầng "cần được duyệt".
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-5);
    const headers = await writeHeaders(page);

    const catalogRes = await page.request.get('/api/v1/catalog');
    expect(catalogRes.status(), 'SA phải đọc được danh mục để lấy loại thiết bị').toBe(200);
    const catalog = (await catalogRes.json()) as { deviceTypes: { id: string; name: string }[] };
    const switchTypeId = catalog.deviceTypes.find((type) => type.name === 'Switch')!.id;

    const deviceRes = await page.request.post('/api/v1/devices', {
      headers,
      data: {
        code: `SW-E2E-TOUR-${stamp}`,
        name: `Switch tour E2E ${stamp}`,
        deviceTypeId: switchTypeId,
      },
    });
    expect(deviceRes.status(), 'dựng thiết bị cho bài kiểm').toBe(201);
    const deviceId = ((await deviceRes.json()) as { device: { id: string } }).device.id;

    const secretLabel = `admin web E2E ${stamp}`;
    const secretRes = await page.request.post('/api/v1/vault/secrets', {
      headers,
      data: {
        ownerType: 'device',
        ownerId: deviceId,
        kind: 'password',
        label: secretLabel,
        value: `TourE2E#${stamp}`,
      },
    });
    expect(secretRes.status(), 'cất một secret vào két của thiết bị vừa dựng').toBe(201);

    const grantRes = await page.request.post('/api/v1/vault/access', {
      headers,
      data: {
        memberEmail: E2E_MEMBER.email,
        scopeType: 'device_type',
        scopeRef: switchTypeId,
        tier: 'needs_approval',
      },
    });
    expect(grantRes.status(), 'gán Member tầng cần-được-duyệt trên nhóm loại thiết bị').toBeLessThan(300);

    await logout(page);

    // --- Member: nhìn thấy két, đọc được mình đang ở đâu, và không có nút ghi nào.
    await firstLogin(page, E2E_MEMBER);
    await page.goto(`/devices/${deviceId}`);
    await page.getByRole('tab', { name: 'Két sắt' }).click();

    await expect(
      page.getByText(secretLabel),
      'phải THẤY tên gọi — không biết trong két có gì thì xin quyền cũng không biết xin cái gì',
    ).toBeVisible();
    await expect(
      page.getByText(/cần được duyệt trước khi xem/i),
      'panel phải nói rõ tầng của người đang xem, không để họ bấm rồi bị từ chối mà không hiểu vì sao',
    ).toBeVisible();

    await expect(
      page.getByRole('button', { name: 'Cất mật khẩu/khóa' }),
      'Member không ghi được vào két — bày nút ra là hứa một việc mà API sẽ từ chối bằng 403',
    ).toHaveCount(0);
    /*
     * Sửa · Xoay · Thu hồi nằm trong menu ba chấm, và mục menu chỉ vào DOM khi menu đang mở
     * — nên bám theo chữ "Sửa"/"Xoay" ở đây là một khẳng định LUÔN XANH, kể cả với người có
     * đủ quyền. Bám đúng cái nút MỞ menu: nó chỉ được vẽ khi `canEdit`.
     */
    await expect(
      page.getByRole('button', { name: /^Thao tác với/ }),
      'nút mở menu ghi chỉ được vẽ khi canEdit — Member không có nó',
    ).toHaveCount(0);

    // --- Xin quyền, bằng tay, đúng đường người thật đi.
    await page.getByRole('button', { name: 'Xin mở két' }).click();
    const form = page.getByRole('dialog');
    await form.getByRole('textbox', { name: 'Lý do' }).fill(`switch tour E2E ${stamp} mất kết nối`);
    await form.getByRole('textbox', { name: 'Xin trong bao lâu (giờ)' }).fill('3');
    await form.getByRole('button', { name: 'Gửi yêu cầu' }).click();

    await expect(
      page.getByText('Đang chờ duyệt'),
      'gửi xong mà giao diện không đổi trạng thái thì người dùng sẽ bấm gửi lần nữa — và lần hai là 409',
    ).toBeVisible();

    /*
     * Màn duyệt của Thành viên chỉ có MỘT tab. "Chờ duyệt" là hàng chờ của người duyệt và
     * "Nhật ký" là toàn bộ lịch sử của cả công ty — cả hai đều chặn ở API, nên bày tab ra
     * chỉ để bấm vào rồi nhận màn lỗi.
     */
    await page.goto('/approvals');
    await expect(page.getByRole('heading', { level: 1, name: 'Xin mở két' })).toBeVisible();
    await expect(
      page.getByRole('tab'),
      'Thành viên chỉ có một ngăn — thanh tab một-tab là vạch trang trí, không vẽ',
    ).toHaveCount(0);

    // Và mở ra là thấy NGAY yêu cầu vừa gửi, không phải đi tìm tab.
    await expect(page.getByText(`switch tour E2E ${stamp} mất kết nối`)).toBeVisible();
  });
});

test.describe('Ba cửa quản trị chưa ai bấm bằng tay', () => {
  test.beforeEach(() => {
    resetUsers();
  });

  /**
   * TẠI SAO BÀI NÀY TỒN TẠI
   *
   * "Đặt lại mật khẩu" và "Đặt lại 2 lớp" là hai việc SA làm đúng vào lúc căng nhất: người
   * dùng mất điện thoại, hoặc nghi tài khoản bị chiếm. Cả hai đã có bài kiểm ở tầng API và
   * tầng service — nhưng NÚT thì chưa một lần nào được bấm trong cả bộ E2E (`grep "Đặt lại
   * mật khẩu" tests/` không ra dòng nào trước bài này). Nghĩa là ba kiểu hỏng dưới đây đi
   * qua toàn bộ cổng CI mà không ai biết:
   *
   *   - mục biến mất khỏi menu ba chấm (đổi `RowActions` mà quên một `items`);
   *   - mục còn đó nhưng gọi nhầm endpoint / nhầm `account.id`;
   *   - lệnh chạy đúng nhưng mật khẩu tạm không hiện ra — và mật khẩu tạm chỉ hiện MỘT LẦN,
   *     mất là phải làm lại từ đầu với một người đang chờ máy ở đầu dây bên kia.
   *
   * Bài này bấm cả hai nút và chốt HỆ QUẢ, không chốt cái nhãn: mật khẩu tạm hiện ra,
   * `must_change_password` bật lên, phiên đang mở của người đó chết, và `totp_secret_ct` về
   * null. Ba mốc "trước" đều được đo trước khi bấm, để không có khẳng định nào luôn-xanh.
   */
  test('SA đặt lại mật khẩu và xoá 2 lớp của người khác — bấm bằng tay trên màn Tài khoản', async ({
    page,
    browser,
  }) => {
    // Hai lượt đăng nhập đầy đủ: Member (ở trình duyệt thứ hai, để có phiên SỐNG mà giết) và SA.
    test.setTimeout(150_000);

    const memberCtx = await browser.newContext(SECOND_BROWSER);
    const memberPage = await memberCtx.newPage();
    try {
      /*
       * Member phải đi TRỌN luồng lần đầu, không chỉ đăng nhập: chính lượt đó mới đặt
       * `must_change_password = false` và ghi `totp_secret_ct`. Bỏ bước này thì hai khẳng
       * định cuối bài trở thành luôn-xanh — `resetUsers()` ở `beforeEach` đã để sẵn
       * `must_change_password = true` và `totp_secret_ct = NULL` rồi.
       */
      await firstLogin(memberPage, E2E_MEMBER);
      expect(
        (await memberPage.request.get('/api/v1/auth/me')).status(),
        'phiên của Member phải sống trước khi SA ra tay — không thì "phiên chết" chẳng chứng minh gì',
      ).toBe(200);

      const memberWhere = `email = '${E2E_MEMBER.email}'`;
      expect(
        sql(`SELECT must_change_password FROM users WHERE ${memberWhere}`),
        'Member vừa đổi mật khẩu xong nên cờ này phải TẮT — đây là mốc "trước"',
      ).toBe('f');
      expect(
        sql(`SELECT totp_secret_ct IS NULL FROM users WHERE ${memberWhere}`),
        'Member vừa cài 2 lớp xong nên secret phải CÓ — đây là mốc "trước"',
      ).toBe('f');

      const liveSessions = () =>
        Number(
          sql(
            `SELECT count(*) FROM sessions WHERE revoked_at IS NULL AND user_id = (SELECT id FROM users WHERE ${memberWhere})`,
          ),
        );
      expect(liveSessions(), 'Member đang có ít nhất một phiên mở').toBeGreaterThan(0);

      // --- SA vào màn Tài khoản và bấm nút, đúng như người thật.
      await firstLogin(page, E2E_SA);
      await page.getByRole('link', { name: 'Người dùng IMS', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Người dùng IMS', exact: true })).toBeVisible();

      // Lọc trước rồi mới bấm: danh sách phân trang 20 dòng, và người cần tìm không nhất
      // thiết nằm ở trang đang xem.
      // Chờ bộ lọc ÁP XONG chứ không chỉ chờ hàng hiện ra: hàng cần tìm vốn đã nằm ở trang 1
      // của danh sách CHƯA lọc, nên câu chờ xanh ngay, rồi lượt nạp lại đổ xuống giữa lúc menu
      // ba chấm đang mở và giật nó khỏi DOM. Lý do đầy đủ: `di-khap-giao-dien.spec.ts`, bài
      // "Phòng Tài khoản" (25/09/2026).
      await timVaChoLoc(page, 'E2E Thành viên');
      await expect(page.getByRole('table').getByRole('row')).toHaveCount(2);
      await expect(page.getByRole('button', { name: 'Thao tác với E2E Thành viên' })).toBeVisible();

      // ===== CỬA 1: ĐẶT LẠI MẬT KHẨU =====
      await rowAction(page, 'E2E Thành viên', 'Đặt lại mật khẩu');
      // Chốt luôn CHỮ trên nút xác nhận: hộp hỏi "Đặt lại mật khẩu cho X?" mà nút ghi "Đồng ý"
      // thì người bấm phải đọc lại câu hỏi mới biết mình sắp làm gì.
      await confirmAction(page, 'Đặt lại mật khẩu');

      await expect(page.getByText('Mật khẩu tạm')).toBeVisible();
      const temporaryPassword = (await page.getByTestId('temp-password').innerText()).trim();
      expect(
        temporaryPassword.length,
        'mật khẩu tạm chỉ hiện MỘT LẦN — không hiện ra là SA phải làm lại cả quy trình',
      ).toBeGreaterThanOrEqual(12);
      // Nhãn nút là LỜI XÁC NHẬN, không phải "Đóng": hộp chặn Esc và click-nền nên đây là
      // đường ra duy nhất, và người bấm phải tự khẳng định đã ghi lại (rà UI/UX 12/09).
      await page
        .getByRole('button', { name: 'Tôi đã ghi lại mật khẩu này', exact: true })
        .click();

      expect(
        sql(`SELECT must_change_password FROM users WHERE ${memberWhere}`),
        'đặt lại mật khẩu phải BUỘC đổi ở lần đăng nhập tới — không thì mật khẩu tạm sống mãi',
      ).toBe('t');

      /*
       * `expect.poll` chứ không đọc một phát: việc thu hồi phiên chạy trong cùng transaction
       * với lượt ghi, và phản hồi HTTP có thể về trước khi COMMIT kịp hiện ra ở kết nối khác.
       */
      await expect
        .poll(() => liveSessions(), {
          message: 'đặt lại mật khẩu mà phiên cũ còn sống là người bị nghi chiếm tài khoản vẫn ngồi trong hệ thống',
        })
        .toBe(0);
      await expect
        .poll(async () => (await memberPage.request.get('/api/v1/auth/me')).status())
        .toBe(401);

      // ===== CỬA 2: ĐẶT LẠI 2 LỚP =====
      await rowAction(page, 'E2E Thành viên', 'Đặt lại xác thực 2 lớp');
      await confirmAction(page, 'Đặt lại xác thực 2 lớp');

      // Toast tự tắt sau 4 giây — khẳng định nó TRƯỚC, rồi mới đi hỏi DB (mỗi câu SQL đi qua
      // một lượt `docker compose exec`, đủ chậm để toast kịp biến mất).
      await expect(
        page.getByText('Đã đặt lại xác thực 2 lớp.'),
        'giao diện phải báo đã xong — im lặng thì SA không biết có nên bấm lại không',
      ).toBeVisible();

      expect(
        sql(`SELECT totp_secret_ct IS NULL FROM users WHERE ${memberWhere}`),
        'xoá 2 lớp phải XOÁ THẬT secret: người mất điện thoại phải quét lại được mã QR mới',
      ).toBe('t');
    } finally {
      await memberCtx.close();
    }
  });

  /**
   * TẠI SAO BÀI NÀY TỒN TẠI
   *
   * "Khóa tài khoản" đã có hai bài kiểm, nhưng cả hai đều dừng ở nửa đường:
   *   - `accounts.spec.ts` bấm nút rồi chốt CÁI NHÃN đổi thành "Đang khóa";
   *   - `account-locked-guard.spec.ts` chứng minh `status = 'locked'` chặn được đăng nhập,
   *     nhưng nó đặt trạng thái ấy bằng một câu `UPDATE` thẳng vào DB.
   *
   * Giữa hai bài đó có một khoảng trống đúng bằng thứ SA thật sự bấm: nếu nút "Khóa" gửi sai
   * `status`, hoặc gửi đúng nhưng vào nhầm `account.id`, thì bài thứ nhất vẫn xanh (nhãn đổi
   * theo dữ liệu server trả về) và bài thứ hai cũng xanh (nó không đi qua nút). Người bị khóa
   * vẫn đăng nhập bình thường — đúng lớp lỗi mà rà soát 07/09 gọi tên: hệ thống nói một đằng,
   * làm một nẻo.
   *
   * Bài này nối liền hai đầu: bấm nút, rồi ở một trình duyệt KHÁC thử đăng nhập thật và đọc
   * đúng câu báo lỗi trên màn. Rồi mở khóa và chứng minh cửa mở lại được — vế đối chứng, thứ
   * chặn một bản vá thô bạo kiểu "chặn hết cho chắc".
   */
  test('SA khoá rồi mở khoá một tài khoản, và người bị khoá thật sự không vào được', async ({
    page,
    browser,
    request,
  }) => {
    // Một lượt đăng nhập đầy đủ của SA + hai lượt thử đăng nhập của người bị khóa.
    test.setTimeout(150_000);

    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();

    /*
     * Tài khoản DÙNG MỘT LẦN, không đụng vào `E2E_MEMBER` mà mấy chục bài khác đang dùng —
     * khóa nhầm người dùng chung là một lượt chạy đỏ hàng loạt ở những chỗ chẳng liên quan.
     * Tiền tố `e2e-tao-moi-` để `resetUsers()` tự dọn, không cần script xóa riêng.
     */
    const email = `e2e-tao-moi-khoa-tay-${stamp}@pmh.com.vn`;
    const fullName = `E2E Khoa Tay ${stamp}`;
    const created = await page.request.post('/api/v1/accounts', {
      headers: await writeHeaders(page),
      data: { email, fullName, role: 'member' },
    });
    expect(created.status(), 'dựng một tài khoản dùng một lần để khóa').toBe(201);
    const temporaryPassword = ((await created.json()) as { temporaryPassword: string })
      .temporaryPassword;

    await page.getByRole('link', { name: 'Người dùng IMS', exact: true }).click();
    await page.getByRole('searchbox').fill(stamp);
    const row = page.getByRole('row', { name: new RegExp(fullName) });
    await expect(row).toBeVisible();

    /*
     * MỐC "TRƯỚC", VÀ VÌ SAO NÓ KHÔNG ĐI QUA GIAO DIỆN.
     *
     * Không có vế này thì lượt thử sau khi khóa chẳng chứng minh được gì — mật khẩu có thể
     * sai ngay từ đầu, và bài kiểm vẫn xanh.
     *
     * Nhưng nó phải đi bằng `request` (một hũ cookie RIÊNG, không dính vào phiên nào): một
     * lượt đăng nhập THÀNH CÔNG qua giao diện để lại phiên sống ở trình duyệt đó, và từ lúc
     * ấy `AppRoutes` đá mọi lượt `goto('/login')` về đúng bước còn thiếu (`/totp-enroll`).
     * `fillLogin` kế tiếp sẽ ngồi chờ ô Email trên một màn không hề có ô Email — đỏ ở
     * `locator.fill`, một chỗ chẳng liên quan gì tới việc khóa tài khoản.
     */
    const beforeLock = await request.post('/api/v1/auth/login', {
      headers: { Origin: APP_ORIGIN },
      data: { email, password: temporaryPassword },
      failOnStatusCode: false,
    });
    expect(
      beforeLock.status(),
      'còn active thì mật khẩu tạm phải vào được — đây là mốc "trước"',
    ).toBeLessThan(400);

    const victimCtx = await browser.newContext(SECOND_BROWSER);
    const victimPage = await victimCtx.newPage();
    try {
      // ===== CỬA 3: KHÓA =====
      await rowAction(page, fullName, 'Khóa');
      await page.getByRole('dialog').getByRole('textbox', { name: /Lý do/ }).fill('E2E khóa thử');
      await confirmAction(page, 'Khóa');
      await expect(
        row.getByText('Đang khóa'),
        'huy hiệu trạng thái phải đổi — nhưng đây MỚI LÀ NỬA ĐẦU của việc',
      ).toBeVisible();

      await fillLogin(victimPage, email, temporaryPassword);
      /*
       * Chốt ĐÚNG CÂU trên màn, không chỉ chốt "có lỗi gì đó". Câu này đến từ
       * `auth.service.ts` (mã `ACCOUNT_LOCKED`) và cố tình KHÁC câu của tài khoản bị vô hiệu
       * hóa: khóa là tạm và mở lại được, vô hiệu hóa là dứt điểm. Gộp một câu thì người trực
       * không biết nên bảo người dùng chờ hay bảo họ đi gặp SA.
       */
      await expect(
        victimPage.getByRole('alert'),
        'SA đã bấm Khóa thì người đó phải bị chặn NGAY ở cửa đăng nhập, và được nói rõ vì sao',
      ).toContainText('Tài khoản đã bị quản trị viên tạm ngưng. Liên hệ Super Admin để mở lại.');
      await expect(
        victimPage.getByRole('heading', { name: 'Cài xác thực 2 lớp' }),
        'không được đi tiếp một bước nào trong luồng đăng nhập',
      ).toHaveCount(0);

      // ===== VÀ MỞ KHÓA LẠI =====
      // Mở khóa hỏi lại ngắn: nút nằm sát "Vô hiệu hóa", bấm trượt là mở một tài khoản bị nghi.
      await rowAction(page, fullName, 'Mở khóa');
      await confirmAction(page, 'Mở khóa');
      await expect(row.getByText('Đang hoạt động')).toBeVisible();

      await fillLogin(victimPage, email, temporaryPassword);
      await expect(
        victimPage.getByRole('heading', { name: 'Cài xác thực 2 lớp' }),
        'mở khóa phải mở THẬT — một bản vá kiểu "chặn hết cho chắc" sẽ đỏ ở đây',
      ).toBeVisible();
    } finally {
      await victimCtx.close();
    }
  });
});

/**
 * ===== PHẦN HAI: VÀO HẲN TỪNG PHÒNG =====
 *
 * Bốn khối trên đi HÀNH LANG — menu nối đi đâu, ai mở được cửa nào, breadcrumb có đường về
 * không. Sáu khối dưới đây bước hẳn VÀO TRONG từng phòng và kiểm kê đồ đạc: đầu trang có đúng
 * những nút nào, lọc được theo gì, bảng có đúng những cột nào và cột nào sắp được, menu ba
 * chấm của một dòng có đúng những việc nào — và ở mỗi trạng thái khác nhau thì nó đổi ra sao.
 *
 * Rồi mở TỪNG hộp thoại ra soi bên trong: đủ ô chưa, mỗi ô đúng loại tay nắm chưa (ô chữ hay
 * ô chọn hay ô tra cứu — người dùng bàn phím thao tác khác hẳn nhau), bấm Lưu lúc còn thiếu
 * thì báo đúng câu gì và hộp có chịu ở lại không, mở form Sửa ra thì giá trị cũ còn nguyên
 * không, và đóng được bằng cả ✕ lẫn Esc không.
 *
 * VÌ SAO PHẢI SO TẬP HỢP, KHÔNG PHẢI `toBeVisible()` TỪNG CÁI: một khẳng định "nút X có mặt"
 * không bao giờ đỏ khi nút Y THỪA ra. Mà thừa mới là kiểu hỏng nguy hiểm — một nút ghi lọt vào
 * màn chỉ-đọc, một mục "Xóa" mọc ra ở hồ sơ đã khóa, một ô của danh mục này bày sang danh mục
 * kia. Nên gần như mọi khẳng định dưới đây là `toEqual` trên MỘT TẬP HỢP ĐẦY ĐỦ.
 */

/*
 * ===== PHÒNG THIẾT BỊ — BƯỚC HẲN VÀO TRONG, KHÔNG ĐỨNG Ở CỬA =====
 *
 * Bốn khối trên kia đi HÀNH LANG: menu dẫn tới đâu, breadcrumb quay ra lối nào, vai nào mở
 * được cửa nào. Chúng chứng minh cánh cửa `/devices` còn mở — nhưng KHÔNG nói gì về thứ nằm
 * sau cánh cửa đó.
 *
 * Năm bài dưới đây làm đúng phần còn thiếu: kiểm KIỂM KÊ của căn phòng. Đầu trang có đúng
 * mấy cái nút, thanh lọc có mấy ô và mỗi ô mở ra những lựa chọn nào, bảng có đủ cột không và
 * cột nào sắp xếp được, phân trang đổi số dòng có ăn thật không, mỗi hộp thoại ghi có đủ ô
 * nhập không — và trong hồ sơ một cái máy, từng tab bày ra cái gì.
 *
 * VÌ SAO KIỂM KÊ LẠI ĐÁNG MỘT BÀI RIÊNG. `devices.spec.ts` và `device-detail.spec.ts` kiểm
 * NGHIỆP VỤ: tạo được máy, lọc ra đúng máy, thanh lý thì khóa hồ sơ. Mọi bài đó vẫn xanh
 * nguyên khi một cái nút biến mất, một cột bị gỡ, một ô nhập lặng lẽ rơi khỏi form — vì chúng
 * chỉ chạm vào đúng những tay nắm chúng cần. Một trường không còn ô để nhập là một trường
 * không bao giờ được điền nữa, và không có gì đỏ lên.
 *
 * NÊN MỌI KHẲNG ĐỊNH Ở ĐÂY LÀ SO TẬP HỢP ĐẦY ĐỦ (`toEqual` trên một mảng tên), không phải
 * `toBeVisible()` từng cái. `toBeVisible()` bắt được thứ MẤT ĐI; chỉ so tập hợp mới bắt được
 * thứ THỪA RA — một nút mới ai đó nhét vào đầu trang, một ô chọn mọc thêm trong form.
 */

/*
 * ===== PHÒNG THIẾT BỊ — BƯỚC HẲN VÀO TRONG, KHÔNG ĐỨNG Ở CỬA =====
 *
 * Bốn khối trên kia đi HÀNH LANG: menu dẫn tới đâu, breadcrumb quay ra lối nào, vai nào mở
 * được cửa nào. Chúng chứng minh cánh cửa `/devices` còn mở — nhưng KHÔNG nói gì về thứ nằm
 * sau cánh cửa đó.
 *
 * Năm bài dưới đây làm đúng phần còn thiếu: kiểm KIỂM KÊ của căn phòng. Đầu trang có đúng
 * mấy cái nút, thanh lọc có mấy ô và mỗi ô mở ra những lựa chọn nào, bảng có đủ cột không và
 * cột nào sắp xếp được, phân trang đổi số dòng có ăn thật không, mỗi hộp thoại ghi có đủ ô
 * nhập không — và trong hồ sơ một cái máy, từng tab bày ra cái gì.
 *
 * VÌ SAO KIỂM KÊ LẠI ĐÁNG MỘT BÀI RIÊNG. `devices.spec.ts` và `device-detail.spec.ts` kiểm
 * NGHIỆP VỤ: tạo được máy, lọc ra đúng máy, thanh lý thì khóa hồ sơ. Mọi bài đó vẫn xanh
 * nguyên khi một cái nút biến mất, một cột bị gỡ, một ô nhập lặng lẽ rơi khỏi form — vì chúng
 * chỉ chạm vào đúng những tay nắm chúng cần. Một trường không còn ô để nhập là một trường
 * không bao giờ được điền nữa, và không có gì đỏ lên.
 *
 * NÊN MỌI KHẲNG ĐỊNH Ở ĐÂY LÀ SO TẬP HỢP ĐẦY ĐỦ (`toEqual` trên một mảng tên), không phải
 * `toBeVisible()` từng cái. `toBeVisible()` bắt được thứ MẤT ĐI; chỉ so tập hợp mới bắt được
 * thứ THỪA RA — một nút mới ai đó nhét vào đầu trang, một ô chọn mọc thêm trong form.
 */
test.describe('Phòng Thiết bị — bên trong có gì', () => {
  test.beforeEach(() => {
    resetUsers();
    resetDevices();
    // Loại thiết bị là danh mục CHUNG do migration 0011 gieo, nhưng site/tủ/NCC thì các bài
    // khác tự dựng bằng tiền tố `E2E-`. Không dọn thì tập hợp lựa chọn của ô lọc phình ra
    // theo lần chạy trước và bài này đỏ vì lý do chẳng liên quan.
    resetCatalog();
  });

  /**
   * 12 loại thiết bị của migration `0011_seed_device_type.sql` — danh mục CHUNG của mọi công
   * ty, nên nó là hằng số kiểm được. Site · tủ · nhà cung cấp thì KHÔNG: đó là dữ liệu riêng
   * của PMH, nhập qua màn Danh mục, nên bài này chỉ chốt mục "Tất cả …" đứng đầu.
   */
  const LOAI_THIET_BI_GOC = [
    'Switch',
    'Firewall',
    'Server',
    'NAS',
    'UPS',
    'Access Point',
    'PC',
    'Laptop',
    'Printer',
    'Camera',
    'Điện thoại IP',
    'Thiết bị khác',
  ];

  /**
   * Tên TRỢ NĂNG của một tập điều khiển, đúng thứ tự chúng nằm trong DOM.
   *
   * Vì sao không dùng `allInnerTexts()`: một nửa số điều khiển của phòng này KHÔNG có chữ nào
   * bên trong. Nút mở `Select` hiện nhãn placeholder ("— Chọn loại —") chứ không hiện tên ô;
   * nút lịch chỉ có một cái icon; ô chọn file là `<input type="file">` bị giấu về 1px và mượn
   * tên từ `<label for>` bên cạnh. Người dùng trình đọc màn hình nghe đúng chuỗi mà hàm này
   * trả về — nên đó mới là thứ đáng chốt, không phải chữ vẽ trên màn hình.
   */
  async function tenDieuKhien(scope: Locator): Promise<string[]> {
    return scope.evaluateAll((els) =>
      els.map((el) => {
        const aria = el.getAttribute('aria-label');
        if (aria) return aria.trim();
        const id = el.getAttribute('id');
        const tied = id ? el.ownerDocument.querySelector(`label[for="${id}"]`) : null;
        return ((tied ?? el).textContent ?? '').replace(/\s+/g, ' ').trim();
      }),
    );
  }

  /**
   * NHÃN của một tập phần tử — đọc `textContent`, KHÔNG đọc `innerText`.
   *
   * Lượt chạy đầu đã dạy đúng bài này: `allInnerTexts()` trả về chữ ĐÃ QUA `text-transform`
   * của hệ thiết kế, nên đầu bảng ra "MÃ THIẾT BỊ" còn tiêu đề hộp thoại (`.sheet-title`, không
   * bị biến hoa) vẫn ra "Thêm thiết bị" — cùng một mảng mà nửa hoa nửa thường. Cái ta muốn chốt
   * là NHÃN (chuỗi trong `vi.ts`), không phải kiểu chữ: đổi `text-transform` là một quyết định
   * thị giác, đổi nhãn mới là đổi nghĩa. `textContent` không bị biến đổi nên nói đúng nhãn.
   */
  async function nhanCua(scope: Locator): Promise<string[]> {
    const texts = await scope.allTextContents();
    return texts.map((text) => text.replace(/\s+/g, ' ').trim());
  }

  /**
   * Mở một ô chọn, đọc hết lựa chọn, rồi ĐÓNG LẠI BẰNG CHÍNH NÚT ĐÓ.
   *
   * Không đóng bằng Esc: ô chọn của form nằm trong hộp thoại, và một phím Esc lọt ra ngoài là
   * đóng luôn cả hộp — bài kiểm sẽ đỏ ở bước sau, cách xa chỗ thật sự sai. Bấm lại nút mở thì
   * chỉ có một thứ đóng, và đó đúng là thứ ta vừa mở.
   */
  async function luaChonCua(page: Page, trigger: Locator): Promise<string[]> {
    const options = page.getByRole('option');
    let names: string[] = [];
    /*
     * Lặp cả vòng mở–đọc–đóng: bảng nạp lại (sau khi sắp xếp, lọc) dựng lại thanh phân trang,
     * nút cũ bị gỡ khỏi DOM giữa hai cú bấm và cú thứ hai rơi vào một nút MỚI đang đóng — tức
     * là mở lại. Lỗi đó thuộc về nhịp của bài kiểm, không phải của `Select`.
     */
    await expect(async () => {
      if ((await options.count()) === 0) await trigger.click();
      await expect(options.first(), 'ô chọn mở ra phải có ít nhất một lựa chọn').toBeVisible({
        timeout: 2_000,
      });
      // `allTextContents` chứ không phải `allInnerTexts` — xem chú thích ở `nhanCua`.
      names = await options.allTextContents();
      await trigger.click();
      await expect(options, 'bấm lại nút mở phải đóng danh sách lựa chọn').toHaveCount(0, {
        timeout: 2_000,
      });
    }).toPass({ timeout: 15_000 });
    return names.map((name) => name.trim());
  }

  /** Loại thiết bị "Switch" — loại duy nhất trong bài này cần BẬT port map (seed: `has_port_map`). */
  async function idLoaiSwitch(page: Page): Promise<string> {
    const res = await page.request.get('/api/v1/catalog');
    const lists = (await res.json()) as { deviceTypes: { id: string; name: string }[] };
    const found = lists.deviceTypes.find((type) => type.name === 'Switch');
    expect(found, 'danh mục gốc phải có loại "Switch" (migration 0011 gieo)').toBeTruthy();
    return found!.id;
  }

  /*
   * ===== BÀI 1 =====
   *
   * VÌ SAO BÀI NÀY TỒN TẠI
   *
   * Đầu trang Thiết bị có bốn cái nút, và ba trong số đó là CỬA DUY NHẤT tới một việc: không
   * có "Tải file mẫu" thì không ai biết file nhập phải có cột nào; không có "Nhập từ Excel"
   * thì cả story 2.6 không có lối vào từ giao diện. `devices.spec.ts` bấm "Thêm thiết bị"
   * suốt, `device-import.spec.ts` bấm "Nhập từ Excel" — nhưng KHÔNG bài nào hỏi "đầu trang có
   * đúng bốn nút này thôi chứ?". Gỡ một nút đi, hoặc nhét thêm một nút thứ năm, cả bộ E2E vẫn
   * xanh.
   *
   * Thanh lọc cũng vậy: bốn ô chọn là bốn câu hỏi người dùng hỏi kho thiết bị (ở site nào, tủ
   * nào, loại gì, còn dùng không). Bài này mở từng ô ra xem bên trong.
   *
   * ĐỎ KHI: đầu trang thừa/thiếu một nút hoặc một nút đổi nhãn, thanh lọc mất một ô chọn, ô
   * "Trạng thái" mọc thêm/rụng đi một trạng thái, ô "Loại" không còn khớp danh mục gốc, hoặc
   * ô tìm kiếm gõ vào mà bảng KHÔNG thu hẹp (lọc chạy hụt ở client thay vì đi tới server).
   */
  test('Đầu phòng Thiết bị: đúng bốn nút, bốn ô lọc, và ô tìm thu hẹp bảng thật', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await firstLogin(page, E2E_SA);

    const stamp = uniqueStamp();
    const headers = await writeHeaders(page);
    const deviceTypeId = await idLoaiSwitch(page);

    // Dàn cảnh qua API: điều đang kiểm là THANH LỌC, không phải đường tạo máy.
    for (const [suffix, name] of [
      ['A', 'Máy mồi thứ nhất của bài kiểm kê'],
      ['B', 'Máy mồi thứ hai của bài kiểm kê'],
    ]) {
      const created = await page.request.post('/api/v1/devices', {
        headers,
        data: { code: `TB-E2E-DAU-${stamp}-${suffix}`, name, deviceTypeId },
      });
      expect(created.ok(), `dựng máy mồi ${suffix} phải thành công`).toBe(true);
    }

    await page.goto('/devices');
    await expect(page.getByRole('heading', { level: 1, name: /^Thiết bị$/ })).toBeVisible();

    const main = page.getByRole('main');
    const timKiem = page.getByRole('searchbox', {
      name: 'Tìm mã, tên, serial, IP hoặc người dùng',
    });

    /*
     * ĐẾM NÚT TRÊN MỘT BẢNG RỖNG, CÓ CHỦ Ý.
     *
     * Còn dòng nào là mỗi dòng đẻ thêm một nút "Sửa máy …" và một nút phân trang — tập hợp
     * cần chốt bị chôn giữa hai chục nút của dữ liệu. Lọc về rỗng thì trong `<main>` chỉ còn
     * đúng thứ LUÔN có mặt: ba nút đầu trang (file mẫu nằm TRONG hộp nhập), bốn ô lọc, nút
     * "Xóa lọc" của thanh lọc và nút "Xóa bộ lọc" của khối rỗng.
     */
    await timKiem.fill(`KHONG-CO-MAY-NAO-E2E-${stamp}`);
    await expect(
      main.getByText(`Không có thiết bị nào khớp “KHONG-CO-MAY-NAO-E2E-${stamp}”.`),
      'lọc về rỗng phải ra empty-state, không phải bảng trắng',
    ).toBeVisible();

    await expect
      .poll(() => tenDieuKhien(main.getByRole('button')), {
        message:
          'Bộ khung đầu phòng Thiết bị: ba nút hành động, bốn ô lọc, hai nút gỡ lọc — không thừa, không thiếu',
      })
      .toEqual([
        'Xuất Excel',
        'Nhập từ Excel',
        'Thêm thiết bị',
        'Site',
        'Tủ mạng',
        'Loại',
        'Trạng thái',
        'Xóa lọc (1)',
        'Xóa bộ lọc',
      ]);

    /*
     * Ô TÌM PHẢI THU HẸP THẬT — đếm dòng TRƯỚC và SAU.
     *
     * Chỉ khẳng định "thấy máy A" thì một ô tìm hỏng hoàn toàn (gửi lên server rồi bỏ qua)
     * vẫn xanh, vì máy A vốn đã nằm trong bảng. Hai con số mới nói được điều gì đó.
     */
    await timKiem.fill(`TB-E2E-DAU-${stamp}`);
    await expect(
      page.getByRole('row'),
      'lọc theo dấu của lần chạy này phải còn đúng hai máy mồi (kèm dòng tiêu đề)',
    ).toHaveCount(3);

    await timKiem.fill(`TB-E2E-DAU-${stamp}-A`);
    await expect(
      page.getByRole('row'),
      'gõ thêm hậu tố "-A" phải thu bảng xuống còn một máy — không thu tức là ô tìm không đi tới server',
    ).toHaveCount(2);
    await expect(
      // `exact: true` là bắt buộc: ô "Thao tác" của CHÍNH dòng đó chứa nút "Sửa máy <mã>", nên
      // khớp theo chuỗi con là trúng hai ô một lúc và Playwright báo strict-mode violation.
      page.getByRole('cell', { name: `TB-E2E-DAU-${stamp}-A`, exact: true }),
      'máy còn lại phải đúng là máy A',
    ).toBeVisible();

    await timKiem.fill('');

    /*
     * BÊN TRONG TỪNG Ô LỌC.
     *
     * `exact: true` là bắt buộc ở đây: đầu bảng cũng có nút "Sắp xếp theo Trạng thái", và
     * `getByRole` khớp tên theo CHUỖI CON — không neo thì một cú bấm rơi nhầm vào đầu bảng.
     */
    const trangThai = await luaChonCua(
      page,
      main.getByRole('button', { name: 'Trạng thái', exact: true }),
    );
    expect(
      trangThai,
      'Ô lọc Trạng thái phải bày đúng vòng đời thiết bị: mục "mọi" rồi bốn trạng thái của DEVICE_STATUSES',
    ).toEqual(['Mọi trạng thái', 'Đang dùng', 'Dự phòng', 'Hỏng', 'Đã thanh lý']);

    const loai = await luaChonCua(page, main.getByRole('button', { name: 'Loại', exact: true }));
    expect(loai[0], 'Ô lọc Loại phải mở đầu bằng mục bỏ lọc').toBe('Tất cả loại');
    // So theo TẬP HỢP đã sắp, không theo thứ tự: API sắp theo `name` bằng collation của
    // Postgres, mà thứ tự của "Điện thoại IP" trong bảng chữ cái phụ thuộc collation ấy —
    // chốt cứng thứ tự là chốt vào một thứ không thuộc về phòng này.
    expect(
      [...loai.slice(1)].sort(),
      'Ô lọc Loại phải khớp ĐÚNG 12 loại do migration 0011 gieo — thừa một loại nghĩa là danh mục E2E chưa được dọn, thiếu một loại nghĩa là seed đã đổi',
    ).toEqual([...LOAI_THIET_BI_GOC].sort());

    // Site và tủ là dữ liệu riêng của PMH (nhập qua màn Danh mục), nên chỉ chốt được mục đầu.
    expect(
      (await luaChonCua(page, main.getByRole('button', { name: 'Site', exact: true })))[0],
      'Ô lọc Site phải mở đầu bằng mục bỏ lọc',
    ).toBe('Tất cả site');
    expect(
      (await luaChonCua(page, main.getByRole('button', { name: 'Tủ mạng', exact: true })))[0],
      'Ô lọc Tủ mạng phải mở đầu bằng mục bỏ lọc',
    ).toBe('Tất cả tủ');
  });

  /*
   * ===== BÀI 2 =====
   *
   * VÌ SAO BÀI NÀY TỒN TẠI
   *
   * `devices.spec.ts` đã chứng minh sắp xếp CHẠY Ở SERVER và hai cột danh mục không sắp được.
   * Bài này hỏi câu khác: bảng có ĐỦ cột không, và cột nào là nút sắp xếp — chốt bằng tập
   * hợp, nên nó bắt được cả việc ai đó thêm một cột sắp-được thứ sáu mà API chưa có khóa
   * tương ứng trong `DEVICE_SORT_KEYS` (bấm vào là bảng im lặng bỏ qua).
   *
   * Và phần chưa ai chạm: PHÂN TRANG. `Pagination` là tài sản dùng chung, `total === 0` thì
   * nó KHÔNG vẽ gì cả — nghĩa là mọi bài kiểm chạy trên vài dòng dữ liệu đều không nhìn thấy
   * nó bao giờ. Ô "Số dòng" (10/20/50/100) chưa có bài nào bấm.
   *
   * ĐỎ KHI: một cột biến mất hay mọc thêm, một cột đang sắp được thôi sắp được (hoặc ngược
   * lại), `aria-sort` không lật asc→desc, thứ tự dòng không đổi theo cột vừa bấm, ô "Số dòng"
   * mất một cỡ, hoặc đổi cỡ mà số dòng thật không đổi theo.
   */
  test('Bảng thiết bị: đủ cột, đúng cột sắp được, và phân trang ăn thật', async ({ page }) => {
    test.setTimeout(150_000);
    await firstLogin(page, E2E_SA);

    const stamp = uniqueStamp();
    const headers = await writeHeaders(page);
    const deviceTypeId = await idLoaiSwitch(page);

    /*
     * 12 máy — đủ để trang thứ hai TỒN TẠI ở cỡ 10 dòng. Tên đi NGƯỢC chiều với mã (máy `-01`
     * tên "Máy L", máy `-12` tên "Máy A") để "sắp theo tên" không thể tình cờ trùng với "sắp
     * theo mã": trùng thì bài kiểm xanh cả khi nút sắp xếp chẳng làm gì.
     */
    const chuCai = ['L', 'K', 'J', 'I', 'H', 'G', 'F', 'E', 'D', 'C', 'B', 'A'];
    for (let i = 0; i < chuCai.length; i += 1) {
      const created = await page.request.post('/api/v1/devices', {
        headers,
        data: {
          code: `TB-E2E-BANG-${stamp}-${String(i + 1).padStart(2, '0')}`,
          name: `Máy ${chuCai[i]} của bài kiểm kê bảng`,
          deviceTypeId,
        },
      });
      expect(created.ok(), `dựng máy thứ ${i + 1} phải thành công`).toBe(true);
    }

    await page.goto('/devices');
    await page
      .getByRole('searchbox', { name: 'Tìm mã, tên, serial, IP hoặc người dùng' })
      .fill(`TB-E2E-BANG-${stamp}`);
    await expect(page.getByRole('row'), 'lọc xong phải còn đúng 12 máy vừa dựng').toHaveCount(13);

    await expect
      .poll(() => nhanCua(page.getByRole('columnheader')), {
        message:
          'Bảng thiết bị có đúng 7 cột, đúng thứ tự này. Loại máy là dòng phụ dưới Tên (không bớt thông tin): thêm cột là cột Tên bị ép và nút Sửa bị đẩy khỏi khung ở 1280px',
      })
      .toEqual([
        'Mã thiết bị',
        'Tên thiết bị',
        'Vị trí',
        'Người sử dụng',
        'Bảo hành',
        'Trạng thái',
        'Thao tác',
      ]);

    /*
     * CỘT NÀO SẮP ĐƯỢC — chốt bằng TẬP HỢP nút trong dòng tiêu đề.
     *
     * Danh sách này phải soi gương `DEVICE_SORT_KEYS` bên API. "Loại" và "Vị trí và người
     * giữ" đứng ngoài vì sắp theo chúng đòi join sang module danh mục (AD-2); "Thao tác"
     * đứng ngoài vì nó không phải dữ liệu. Một nút thứ sáu mọc ra ở đây mà API chưa có khóa
     * tương ứng thì bấm vào bảng sẽ im lặng không đổi gì — không có tập hợp thì không ai biết.
     */
    const dongTieuDe = page.getByRole('row').first();
    await expect
      .poll(() => tenDieuKhien(dongTieuDe.getByRole('button')), {
        message:
          'Đúng năm cột sắp xếp được, và nhãn phải NÓI RÕ đây là nút sắp xếp (thanh lọc cũng có nút tên "Loại")',
      })
      .toEqual([
        'Sắp xếp theo Mã thiết bị',
        'Sắp xếp theo Tên thiết bị',
        'Sắp xếp theo Người sử dụng',
        'Sắp xếp theo Bảo hành',
        'Sắp xếp theo Trạng thái',
      ]);

    const cotMa = page.getByRole('columnheader', { name: /Mã thiết bị/ });
    const cotTen = page.getByRole('columnheader', { name: /Tên thiết bị/ });
    const dongDauTien = page.getByRole('row').nth(1);

    await expect(cotMa, 'mở màn bảng sắp theo Mã thiết bị tăng dần').toHaveAttribute(
      'aria-sort',
      'ascending',
    );
    await expect(dongDauTien, 'sắp theo mã tăng thì máy -01 đứng đầu').toContainText(`${stamp}-01`);

    await dongTieuDe.getByRole('button', { name: 'Sắp xếp theo Tên thiết bị' }).click();
    await expect(
      cotTen,
      'bấm nút sắp xếp của cột Tên thì CHÍNH cột đó phải mang aria-sort',
    ).toHaveAttribute('aria-sort', 'ascending');
    await expect(
      cotMa,
      'và cột Mã phải về "none" (sắp được, đang không sắp) — hai cột cùng khai đang-sắp là nói dối trình đọc màn hình',
    ).toHaveAttribute('aria-sort', 'none');
    await expect(
      dongDauTien,
      'sắp theo tên tăng thì "Máy A" lên đầu — tức máy mang mã -12, khác hẳn thứ tự theo mã',
    ).toContainText(`${stamp}-12`);

    await dongTieuDe.getByRole('button', { name: 'Sắp xếp theo Tên thiết bị' }).click();
    await expect(cotTen, 'bấm lần hai phải lật sang giảm dần').toHaveAttribute(
      'aria-sort',
      'descending',
    );
    await expect(
      dongDauTien,
      'sắp theo tên giảm thì "Máy L" lên đầu — thứ tự phải ĐỔI THẬT, không chỉ đổi mũi tên',
    ).toContainText(`${stamp}-01`);

    /*
     * MỘT DÒNG CÓ ĐÚNG MỘT VIỆC LÀM ĐƯỢC TẠI CHỖ.
     *
     * Phòng này CỐ Ý không dùng menu ba chấm `RowActions` như các bảng khác: cột "Thao tác"
     * chỉ có một nút "Sửa máy <mã>" mở thẳng hộp thoại. Chốt lại đây để lần sau ai gom về
     * menu ba chấm cho "đồng bộ" thì bài này đỏ và người đó biết mình đang đổi một quyết định,
     * chứ không phải đang dọn dẹp.
     */
    await expect
      .poll(
        () =>
          tenDieuKhien(
            page.getByRole('row', { name: new RegExp(`${stamp}-01`) }).getByRole('button'),
          ),
        {
          message:
            'Mỗi dòng thiết bị có đúng MỘT nút, và nhãn phải riêng cho từng dòng (hai chục nút cùng tên "Sửa" là không ai bấm đúng được)',
        },
      )
      .toEqual([`Sửa máy TB-E2E-BANG-${stamp}-01`]);

    /*
     * PHÂN TRANG.
     *
     * `Pagination` không render gì khi `total === 0`, nên nó là khu vực gần như không bài nào
     * đi qua. 12 máy ở cỡ 10 dòng là cấu hình nhỏ nhất mà trang thứ hai thật sự tồn tại.
     */
    const pager = page.getByRole('navigation', { name: 'Trang', exact: true });
    await expect(pager, 'lọc ra 12 dòng thì thanh phân trang phải có mặt').toBeVisible();
    await expect(
      pager,
      'thanh phân trang phải nói rõ đang xem bao nhiêu trên tổng bao nhiêu',
    ).toContainText('trên 12 dòng');

    const soDong = pager.getByLabel('Số dòng');
    expect(
      await luaChonCua(page, soDong),
      'Ô "Số dòng" phải bày đủ bốn cỡ của PAGE_SIZES — 10 cho điện thoại, 100 cho lúc soi cả kho',
    ).toEqual(['10', '20', '50', '100']);

    await soDong.click();
    await page.getByRole('option', { name: '10', exact: true }).click();
    await expect(
      page.getByRole('row'),
      'đổi sang cỡ 10 thì bảng phải còn đúng 10 dòng dữ liệu — không đổi tức là ô "Số dòng" chỉ để trang trí',
    ).toHaveCount(11);

    const trangSau = pager.getByRole('button', { name: 'Trang sau' });
    await expect(trangSau, '12 dòng ở cỡ 10 thì phải còn trang thứ hai để đi tới').toBeEnabled();
    await trangSau.click();
    await expect(
      page.getByRole('row'),
      'trang hai của 12 dòng ở cỡ 10 phải còn đúng 2 dòng',
    ).toHaveCount(3);
    await expect(trangSau, 'hết trang thì nút "Trang sau" phải tắt').toBeDisabled();
    await expect(
      pager.getByRole('button', { name: 'Trang trước' }),
      'và nút "Trang trước" phải bật lên',
    ).toBeEnabled();

    // Dãy số trang: trang đang xem mang aria-current, bấm số là nhảy thẳng tới đó.
    await expect(
      pager.getByRole('button', { name: 'Trang 2', exact: true }),
      'trang đang xem phải được đánh dấu aria-current="page"',
    ).toHaveAttribute('aria-current', 'page');
    await pager.getByRole('button', { name: 'Trang 1', exact: true }).click();
    await expect(page.getByRole('row'), 'bấm số 1 thì về trang đầu, 10 dòng').toHaveCount(11);

    /*
     * FE-03 — trang KHÔNG TỒN TẠI trên thanh địa chỉ (link cũ, gõ tay) phải được kéo về trang
     * cuối, không phải "91–12 trên 12 dòng" kèm câu rỗng "chưa có thiết bị nào".
     */
    const xa = new URL(page.url());
    xa.searchParams.set('page', '99');
    await page.goto(xa.toString());
    await expect(page.getByRole('row'), '?page=99 của 12 dòng phải rơi về trang 2').toHaveCount(3);
    await expect(
      page.getByRole('navigation', { name: 'Trang', exact: true }).getByRole('button', {
        name: 'Trang 2',
        exact: true,
      }),
    ).toHaveAttribute('aria-current', 'page');
    await expect(page).toHaveURL(/[?&]page=2(&|$)/);
  });

  /*
   * ===== BÀI 3 =====
   *
   * VÌ SAO BÀI NÀY TỒN TẠI
   *
   * `devices.spec.ts` mở hộp "Thêm thiết bị" hàng chục lần, nhưng lần nào cũng chỉ chạm ba ô:
   * Mã, Tên, Loại. Mười một ô còn lại — Model, Serial, Site, Tủ mạng, Người sử dụng, Bộ phận,
   * Nhà cung cấp, ba ô ngày, Ghi chú — chưa có bài nào biết chúng còn tồn tại hay không. Xóa
   * hẳn ô "Bảo hành đến" khỏi form thì cả bộ E2E vẫn xanh, và cái máy tiếp theo được khai sẽ
   * không có hạn bảo hành, mãi mãi.
   *
   * Bài này còn chốt hai quyết định thiết kế mà chỉ đọc chú thích trong code mới biết:
   *   - Ô "Trạng thái" KHÔNG hiện khi thêm mới (máy mới thì luôn "đang dùng"; bày một ô có
   *     đúng một câu trả lời hợp lý là mở đường cho hồ sơ vừa tạo đã "đã thanh lý").
   *   - Từng ô phải đúng LOẠI tay nắm: Bộ phận là `combobox` (gõ tự do được, vì bộ phận mới
   *     lập tuần này phải khai được ngay), Loại là `button` mở listbox, ngày là nút mở lịch.
   *     Nhầm vai nghĩa là người dùng bàn phím thao tác khác hẳn điều ta tưởng.
   *
   * ĐỎ KHI: một ô nhập rơi khỏi form hoặc mọc thêm, một ô đổi loại tay nắm, ô "Trạng thái"
   * lọt vào chế độ thêm mới, danh sách loại thiết bị trong form lệch khỏi danh mục, bấm Lưu
   * lúc thiếu dữ liệu mà hộp vẫn đóng, hoặc một trong hai đường đóng hộp (✕ / Esc) chết.
   */
  test('Hộp "Thêm thiết bị": đủ ô, đúng loại tay nắm, và không đóng khi còn thiếu', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await firstLogin(page, E2E_SA);

    const stamp = uniqueStamp();
    await page.goto('/devices');
    await devicesPageButton(page, 'Thêm thiết bị').click();

    const hop = page.getByRole('dialog', { name: 'Thêm thiết bị' });
    await expect(hop, 'bấm "Thêm thiết bị" phải mở đúng hộp mang tên đó').toBeVisible();

    /*
     * Năm tiêu đề cấp 2, không phải bốn: `Dialog` dựng tiêu đề hộp bằng `RD.Title` của Radix,
     * mà mặc định nó render ra `<h2>` — nên nó đứng CÙNG cấp với tiêu đề bốn khối bên trong và
     * lọt vào cùng tập hợp. Chốt cả năm, đúng thứ tự đọc từ trên xuống.
     */
    await expect
      .poll(() => nhanCua(hop.getByRole('heading', { level: 2 })), {
        message:
          'Form thiết bị chia đúng bốn khối dưới tiêu đề hộp, kể một mạch chuyện: là máy gì → đứng ở đâu → mua của ai → giấy tờ kèm theo',
      })
      .toEqual([
        'Thêm thiết bị',
        'Hồ sơ',
        'Vị trí và người giữ',
        'Mua sắm và bảo hành',
        'Giấy tờ đính kèm',
      ]);

    /*
     * TẬP HỢP Ô GÕ CHỮ. Sáu ô, không hơn không kém.
     *
     * Đếm `textbox` rồi mới soi từng nhãn: chỉ soi từng nhãn thì một ô THỪA ra (ai đó thêm ô
     * "Vị trí trong tủ" mà không khai vào API) sẽ lọt qua sạch sẽ.
     */
    await expect(
      hop.getByRole('textbox'),
      'Hộp thêm thiết bị có đúng 6 ô gõ chữ: Mã · Tên · Model · Serial · Người sử dụng · Ghi chú',
    ).toHaveCount(6);
    for (const nhan of [
      'Mã thiết bị',
      'Tên thiết bị',
      'Model',
      'Serial',
      'Người sử dụng',
      'Ghi chú',
    ]) {
      await expect(
        hop.getByLabel(nhan),
        `Ô "${nhan}" phải là một ô gõ chữ có nhãn nối đúng — mất nhãn là người dùng bàn phím mất luôn ô`,
      ).toHaveCount(1);
    }

    /*
     * ĐÚNG LOẠI TAY NẮM. Bộ phận là `combobox` chứ không phải `Select`: danh mục ở đây chỉ
     * HƯỚNG chứ không được ép, nên nó phải gõ tự do được. Đổi nó thành `Select` là lặng lẽ
     * cấm khai một bộ phận vừa lập.
     */
    await expect(
      hop.getByRole('combobox', { name: 'Bộ phận' }),
      'Ô Bộ phận phải là combobox (gõ tự do + gợi ý), không phải ô chọn cứng',
    ).toHaveCount(1);

    /*
     * TẬP HỢP NÚT — gộp cả ô chọn, ô ngày, ô chọn file và chân hộp.
     *
     * Đây là khẳng định gắt nhất của bài: nó chốt cùng lúc "có đủ" và "không thừa". Đặc biệt
     * là KHÔNG có "Trạng thái" — quyết định cố ý của form thêm mới.
     */
    await expect
      .poll(() => tenDieuKhien(hop.getByRole('button')), {
        message:
          'Bộ nút của hộp THÊM MỚI: bốn ô chọn, ba ô ngày + ba nút đặt nhanh hạn bảo hành, một ô chọn file, ba nút chân hộp — và TUYỆT NHIÊN không có ô "Trạng thái"',
      })
      .toEqual([
        'Đóng hộp thoại',
        'Loại',
        'Site',
        'Tủ mạng',
        'Nhà cung cấp',
        'Ngày mua',
        'Bảo hành từ',
        'Bảo hành đến',
        '+1 năm',
        '+2 năm',
        '+3 năm',
        'Chọn file để đính kèm',
        'Hủy',
        'Ghi rồi thêm máy khác',
        'Lưu',
      ]);

    await expect
      .poll(() => tenDieuKhien(page.getByTestId('dialog-footer').getByRole('button')), {
        message: 'Chân hộp đi theo đúng nếp toàn app: Hủy trước, nút ghi chính sau cùng',
      })
      .toEqual(['Hủy', 'Ghi rồi thêm máy khác', 'Lưu']);

    /* Ô NGÀY mở ra một lịch thật, không phải một ô gõ chữ trá hình. */
    const oNgayMua = hop.getByRole('button', { name: 'Ngày mua' });
    await oNgayMua.click();
    await expect(
      page.getByRole('button', { name: 'Tháng sau' }),
      'Ô "Ngày mua" phải mở ra lịch chọn được (có nút lật tháng), không phải một ô trống',
    ).toBeVisible();
    await oNgayMua.click();
    await expect(page.getByRole('button', { name: 'Tháng sau' })).toHaveCount(0);

    /*
     * BÊN TRONG Ô CHỌN LOẠI. Khác ô lọc cùng tên ở ngoài: ở đây KHÔNG có mục "Tất cả loại" —
     * một cái máy phải là một loại cụ thể. Mục "— Chọn loại —" chỉ là chữ hiện trên nút khi
     * chưa chọn, không phải một lựa chọn bấm được.
     */
    const loaiTrongForm = await luaChonCua(
      page,
      hop.getByRole('button', { name: 'Loại', exact: true }),
    );
    expect(
      [...loaiTrongForm].sort(),
      'Ô "Loại" trong form phải bày đúng 12 loại của danh mục, KHÔNG kèm mục "Tất cả loại" của thanh lọc',
    ).toEqual([...LOAI_THIET_BI_GOC].sort());

    /*
     * ĐƯỜNG HỎNG — BẤM LƯU KHI CÒN THIẾU (DEV-025).
     *
     * Form đặt `noValidate`: bong bóng "Please fill out this field." của trình duyệt không còn
     * chặn trước. Hàng rào là `useFormErrors` — câu tiếng Việt DƯỚI TỪNG Ô, nối vào ô bằng
     * `aria-describedby`, tiêu điểm về ô lỗi đầu tiên, và hộp phải còn nguyên (đóng im lặng là
     * nuốt mất mọi thứ người dùng vừa gõ). Loại thiết bị là `Select` (nút bấm) — ô dễ rơi nhất.
     */
    await hop.getByRole('button', { name: 'Lưu' }).click();
    await expect(hop, 'Bấm Lưu khi form trống: hộp PHẢI còn đó').toBeVisible();
    await expect(
      hop.getByText('Còn 3 ô cần sửa trước khi lưu.'),
      'Ba ô bắt buộc cùng thiếu thì đầu form tóm tắt số ô phải sửa',
    ).toBeVisible();
    const oMa = hop.getByRole('textbox', { name: 'Mã thiết bị' });
    await expect(oMa, 'Câu lỗi tiếng Việt nằm dưới và nối vào đúng ô Mã').toHaveAccessibleDescription(
      'Bắt buộc — chưa nhập ô này.',
    );
    await expect(oMa, 'Tiêu điểm về ô lỗi đầu tiên').toBeFocused();

    await oMa.fill(`TB-E2E-HOP-${stamp}`);
    await hop.getByLabel('Tên thiết bị').fill('Máy chỉ để xem hộp thoại');
    await hop.getByRole('button', { name: 'Lưu' }).click();

    await expect(
      hop.getByRole('button', { name: 'Loại', exact: true }),
      'Thiếu LOẠI thiết bị thì chính ô Loại phải nói ra, bằng tiếng Việt',
    ).toHaveAccessibleDescription('Bắt buộc — chưa chọn ô này.');
    await expect(hop.getByText(/ô cần sửa trước khi lưu/), 'Còn một lỗi thì không cần tóm tắt').toHaveCount(0);
    await expect(hop, 'và hộp vẫn phải mở để người dùng sửa nốt').toBeVisible();

    /* HAI ĐƯỜNG ĐÓNG, KHÔNG LƯU GÌ. */
    /* Form đã gõ dở, nên từ 12/09 lối đóng TÌNH CỜ phải hỏi lại trước
       (`Dialog guardUnsaved`, rà UI/UX #10) — trả lời xong mới đóng. */
    await page.keyboard.press('Escape');
    await expect(
      page.getByRole('dialog', { name: 'Bỏ những gì vừa nhập?' }),
      'form 15 ô đã gõ hai ô mà Esc xoá trắng không hỏi là chỗ mất mát nặng nhất của repo',
    ).toBeVisible();
    await confirmAction(page, 'Bỏ và đóng');
    await expect(hop, 'trả lời xong thì Esc phải đóng được hộp thêm thiết bị').toHaveCount(0);

    await devicesPageButton(page, 'Thêm thiết bị').click();
    await expect(hop).toBeVisible();
    await hop.getByRole('button', { name: 'Đóng hộp thoại' }).click();
    await expect(hop, 'nút ✕ cũng phải đóng được hộp').toHaveCount(0);

    await expect(
      page.getByRole('cell', { name: `TB-E2E-HOP-${stamp}` }),
      'Đóng hộp mà không bấm Lưu thì KHÔNG được có cái máy nào ra đời',
    ).toHaveCount(0);
  });

  /*
   * ===== BÀI 4 =====
   *
   * VÌ SAO BÀI NÀY TỒN TẠI
   *
   * Hai hộp còn lại của phòng, mỗi hộp một câu hỏi chưa ai hỏi:
   *
   *   - HỘP SỬA dùng CHUNG `DeviceForm` với hộp thêm mới (AD-15). Dùng chung nghĩa là chỉ
   *     khác nhau ở hai chỗ: có thêm ô "Trạng thái", và mọi ô đã ĐIỀN SẴN giá trị cũ. Cái thứ
   *     hai mới đáng sợ: form gửi ĐỦ mọi trường lên API (ô để trống = xóa giá trị), nên một
   *     form sửa hiện ra trống là bấm Lưu một cái xóa sạch hồ sơ mà người dùng không hề biết.
   *     Chưa bài nào đọc giá trị điền sẵn.
   *
   *   - HỘP NHẬP TỪ EXCEL có ba bước và `device-import.spec.ts` luôn đi hết cả ba với file
   *     thật. Không bài nào nhìn nó lúc VỪA MỞ RA — lúc mà hai nút ghi phải đang TẮT. Nếu
   *     "Xác nhận ghi" bật sẵn khi chưa chọn file, người ta bấm được vào một lượt ghi không
   *     có bảng đối chiếu nào.
   *
   * ĐỎ KHI: hộp sửa mở ra trống hoặc thiếu ô "Trạng thái", tiêu đề hộp sửa mất mã máy, hộp
   * nhập thiếu một trong ba nút, hoặc nút ghi của hộp nhập bật lên khi chưa có file.
   */
  test('Hộp "Sửa hồ sơ" điền sẵn đúng, hộp "Nhập từ Excel" khoá đúng lúc chưa có file', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await firstLogin(page, E2E_SA);

    const stamp = uniqueStamp();
    const code = `TB-E2E-SUA-${stamp}`;
    const headers = await writeHeaders(page);
    const deviceTypeId = await idLoaiSwitch(page);

    const created = await page.request.post('/api/v1/devices', {
      headers,
      data: {
        code,
        name: 'Switch tầng 3 của bài kiểm kê',
        deviceTypeId,
        model: 'C9200-24P',
        serial: `SN-E2E-${stamp}`,
        assignedTo: 'Anh Tuấn hạ tầng',
        department: 'Phòng CNTT',
        note: 'Ghi chú mồi để đọc lại ở form sửa',
      },
    });
    expect(created.ok(), 'dựng máy để đi soi form sửa phải thành công').toBe(true);

    await page.goto('/devices');
    await page
      .getByRole('searchbox', { name: 'Tìm mã, tên, serial, IP hoặc người dùng' })
      .fill(code);
    // `exact: true`: ô "Thao tác" cùng dòng mang nút "Sửa máy <mã>", nên khớp theo chuỗi con
    // là trúng hai ô một lúc — Playwright dừng ở strict-mode violation, không phải ở điều đang kiểm.
    await expect(page.getByRole('cell', { name: code, exact: true })).toBeVisible();

    await page.getByRole('button', { name: `Sửa máy ${code}` }).click();
    const hopSua = page.getByRole('dialog', { name: `Sửa hồ sơ — ${code}` });
    await expect(
      hopSua,
      'Tiêu đề hộp sửa phải mang MÃ MÁY — mở hai tab rồi lẫn lộn hai cái máy là hỏng thật, không phải hỏng đẹp',
    ).toBeVisible();

    /*
     * ĐIỀN SẴN — đọc lại từng ô.
     *
     * `toHaveValue` chứ không phải `toBeVisible`: một ô hiện ra nhưng RỖNG mới đúng là kiểu
     * hỏng đang rình ở đây.
     */
    for (const [nhan, giaTri] of [
      ['Mã thiết bị', code],
      ['Tên thiết bị', 'Switch tầng 3 của bài kiểm kê'],
      ['Model', 'C9200-24P'],
      ['Serial', `SN-E2E-${stamp}`],
      ['Người sử dụng', 'Anh Tuấn hạ tầng'],
      ['Ghi chú', 'Ghi chú mồi để đọc lại ở form sửa'],
    ]) {
      await expect(
        hopSua.getByLabel(nhan),
        `Ô "${nhan}" của form SỬA phải mang sẵn giá trị cũ — form gửi đủ mọi trường lên API, ô trống nghĩa là XÓA`,
      ).toHaveValue(giaTri);
    }
    await expect(
      hopSua.getByRole('combobox', { name: 'Bộ phận' }),
      'Ô Bộ phận (combobox) cũng phải điền sẵn',
    ).toHaveValue('Phòng CNTT');
    await expect(
      hopSua.getByRole('button', { name: 'Loại', exact: true }),
      'Nút ô chọn Loại phải hiện đúng loại đang gắn, không phải chữ "— Chọn loại —"',
    ).toHaveText('Switch');
    await expect(
      hopSua.getByRole('button', { name: 'Trạng thái', exact: true }),
      'Nút ô chọn Trạng thái phải hiện đúng trạng thái hiện tại',
    ).toHaveText('Đang dùng');

    /*
     * BỘ NÚT CỦA CHẾ ĐỘ SỬA — đúng bằng bộ của chế độ thêm mới CỘNG hai thứ, không hơn:
     *   + "Trạng thái": máy đã tồn tại thì trạng thái mới là một quyết định thật.
     *   + "Tải lên": hồ sơ đã có id nên giấy tờ đẩy lên được NGAY, không phải chờ lưu xong.
     */
    await expect
      .poll(() => tenDieuKhien(hopSua.getByRole('button')), {
        message:
          'Chế độ SỬA = chế độ THÊM cộng ô "Trạng thái", bớt nút "Ghi rồi thêm máy khác"; khu giấy tờ ghi thẳng (chọn là tải, không có nút "Tải lên")',
      })
      .toEqual([
        'Đóng hộp thoại',
        'Loại',
        'Trạng thái',
        'Site',
        'Tủ mạng',
        'Nhà cung cấp',
        'Ngày mua',
        'Bảo hành từ',
        'Bảo hành đến',
        '+1 năm',
        '+2 năm',
        '+3 năm',
        'Chọn file để đính kèm',
        'Hủy',
        'Lưu',
      ]);

    await page.keyboard.press('Escape');
    await expect(hopSua, 'Esc đóng hộp sửa').toHaveCount(0);
    await expect(
      page.getByRole('cell', { name: 'Switch tầng 3 của bài kiểm kê' }),
      'Đóng bằng Esc thì hồ sơ phải y nguyên, không lưu gì cả',
    ).toBeVisible();

    /* ===== HỘP NHẬP TỪ EXCEL, LÚC VỪA MỞ RA ===== */
    await page.getByRole('button', { name: 'Nhập từ Excel' }).click();
    const hopNhap = page.getByRole('dialog', { name: 'Nhập thiết bị từ Excel' });
    await expect(hopNhap).toBeVisible();

    await expect
      .poll(() => tenDieuKhien(hopNhap.getByRole('button')), {
        message:
          'Hộp nhập có đúng: ✕ · ô chọn file · Tải file mẫu · Hủy · Đối chiếu · Xác nhận ghi — ba bước, đúng thứ tự đối chiếu-trước-ghi-sau',
      })
      // File mẫu là bước con của Nhập nên nằm TRONG hộp (DEV-007), không đứng ở đầu trang.
      .toEqual([
        'Đóng hộp thoại',
        'Chọn file .xlsx',
        'Tải file mẫu',
        'Hủy',
        'Đối chiếu',
        'Xác nhận ghi',
      ]);

    await expect(
      hopNhap.getByRole('button', { name: 'Đối chiếu' }),
      'Chưa chọn file thì nút Đối chiếu phải TẮT',
    ).toBeDisabled();
    await expect(
      hopNhap.getByRole('button', { name: 'Xác nhận ghi' }),
      'Chưa có bảng đối chiếu thì nút ghi phải TẮT — bật sẵn là mở đường ghi mù vào cả kho thiết bị',
    ).toBeDisabled();
    await expect(
      hopNhap.getByText(
        'Dùng file tải từ nút "Tải file mẫu" (hoặc file vừa Xuất Excel). Danh mục phải khai trước — ' +
        'hệ thống không tự tạo site, tủ mạng, loại thiết bị hay nhà cung cấp.',
      ),
      'Hộp nhập phải tự nói ra điều kiện tiên quyết, không để người dùng đoán',
    ).toBeVisible();

    await hopNhap.getByRole('button', { name: 'Đóng hộp thoại' }).click();
    await expect(hopNhap, 'nút ✕ đóng được hộp nhập').toHaveCount(0);
  });

  /*
   * ===== BÀI 5 =====
   *
   * VÌ SAO BÀI NÀY TỒN TẠI
   *
   * Bài "đi hết các tab" ở khối 1 chỉ chứng minh mỗi tab BẤM ĐƯỢC và mở ra một vùng nội dung
   * KHÔNG rỗng — nó cố ý đi theo vị trí, không theo tên, và không nhìn vào bên trong. Nghĩa
   * là: đổi nội dung tab Két sắt thành một chữ "x" thì bài đó vẫn xanh.
   *
   * Bài này bước hẳn vào từng tab và hỏi "trong đây có đúng thứ phải có không". Nó cũng chốt
   * hai điều mà đọc code mới biết:
   *   - Tab Port map CHỈ hiện với loại thiết bị bật `has_port_map`. Bài này tạo một con Switch
   *     (seed: có port map) nên phải thấy ĐỦ NĂM tab.
   *   - Tab Két sắt hiện cho MỌI vai kể từ story 6.3 — panel tự nói tầng quyền của người xem
   *     chứ tab không còn bị ẩn theo vai.
   *
   * ĐỎ KHI: một tab biến mất khỏi hồ sơ (đặc biệt là Port map trên loại có port map), một tab
   * mở ra rỗng hoặc mất khối đặc trưng của nó, hai nút "Sửa hồ sơ"/"Thanh lý" ở đầu trang
   * thừa/thiếu, hoặc lịch sử KHÔNG ghi lại lượt tạo mới.
   */
  test('Hồ sơ một cái máy: năm tab, mỗi tab bày đúng thứ của nó', async ({ page }) => {
    test.setTimeout(150_000);
    await firstLogin(page, E2E_SA);

    const stamp = uniqueStamp();
    const code = `TB-E2E-HOSO-${stamp}`;

    // Tạo qua GIAO DIỆN: lượt tạo này còn phải để lại một dòng trong tab Lịch sử ở cuối bài.
    await page.goto('/devices');
    await devicesPageButton(page, 'Thêm thiết bị').click();
    const form = page.getByRole('dialog', { name: 'Thêm thiết bị' });
    await form.getByLabel('Mã thiết bị').fill(code);
    await form.getByLabel('Tên thiết bị').fill('Switch của bài kiểm kê phòng');
    await form.getByRole('button', { name: 'Loại', exact: true }).click();
    await page.getByRole('option', { name: 'Switch', exact: true }).click();
    await form.getByRole('button', { name: 'Lưu' }).click();
    await expect(form, 'lưu xong thì hộp phải đóng').toHaveCount(0);

    await timVaChoLoc(page, code);
    await page.getByRole('main').getByRole('link', { name: code, exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: new RegExp(code) })).toBeVisible();

    /*
     * Nhãn tab có thể mang số đếm nối sau ("Giấy tờ 3"), và số đó về SAU hồ sơ một nhịp mạng
     * — nên cắt phần số đi rồi mới so tập hợp, và chờ bằng `expect.poll` thay vì đọc một lần.
     *
     * Ví dụ cũ ở đây là "Giấy tờ 0", nhưng từ 19/09 luật đã đảo: `ui/tabs.tsx` dùng phép thử
     * truthy nên số `0` KHÔNG vẽ ra nữa (`_SPEC.md:61`, `:529`). Phép `.replace(/\s+\d+$/,'')`
     * vẫn đúng cho cả hai thời kỳ — chỉ cái ví dụ là lạc hậu, và nó mâu thuẫn trực tiếp với
     * `device-detail.spec.ts` vừa sửa cùng đợt.
     */
    await expect
      .poll(
        async () =>
          (await page.getByRole('tab').allInnerTexts()).map((name) =>
            name.replace(/\s+\d+$/, '').trim(),
          ),
        {
          message:
            'Hồ sơ một con Switch phải có ĐỦ NĂM tab — Port map chỉ có mặt vì loại này bật has_port_map (FR-006)',
        },
      )
      .toEqual(['Tổng quan', 'Sơ đồ cổng', 'Giấy tờ', 'Két sắt', 'Lịch sử']);

    const main = page.getByRole('main');
    const panel = page.getByRole('tabpanel');

    /* ===== TAB HỒ SƠ ===== */
    await expect
      .poll(() => tenDieuKhien(main.getByRole('button')), {
        message:
          'Đầu hồ sơ thiết bị: chép mã, sửa, đổi trạng thái, nhân bản, thanh lý; tab Tổng quan thêm "Bổ sung n ô" và "Cấp IP" — không nút nào khác',
      })
      // "Thanh lý sẽ gỡ gì" nằm TRONG hộp Thanh lý (DEV-050), không còn là nút rời trên bản đồ.
      // Chép mã (DEV-059), Đổi trạng thái (DEV-053), Nhân bản (DEV-034) ở đầu trang; "Bổ sung n ô
      // còn thiếu" (DEV-066) và "Cấp IP" (DEV-089) ở tab Tổng quan.
      .toEqual([
        'Chép mã thiết bị',
        'Sửa hồ sơ',
        'Đổi trạng thái',
        'Nhân bản',
        'Thanh lý',
        'Bổ sung 6 ô còn thiếu',
        'Cấp IP',
      ]);

    /*
     * MỖI Ô KỂ MỘT LẦN — hoặc là một ô có giá trị, hoặc là một cái tên trong dòng "Chưa khai".
     *
     * Bản trước của bài này đòi CẢ HAI cùng lúc: phải có ô "Model" (rỗng, một dấu gạch ngang)
     * VÀ phải có dòng "Chưa khai: Model, …". Máy trong bài không khai ô nào, nên bản cũ khoá
     * lại đúng cái nhược điểm mà lượt dựng lại 17/09 đi sửa: một lưới toàn gạch ngang, rồi
     * ngay dưới là một câu nói lại y hệt danh sách ấy.
     *
     * Luật mới, và đây là thứ bài kiểm giữ từ giờ: ô KHÔNG có giá trị thì không vẽ ra ô nào.
     */
    for (const nhan of ['Model', 'Serial', 'Nhà cung cấp', 'Ngày mua', 'Ghi chú']) {
      await expect(
        panel.getByText(nhan, { exact: true }),
        `Máy này chưa khai "${nhan}" nên KHÔNG được vẽ một ô rỗng cho nó — tên của nó chỉ được xuất hiện trong dòng "Chưa khai"`,
      ).toHaveCount(0);
    }
    await expect(
      panel.getByText('Chưa khai: Model, Serial, Nhà cung cấp, Bộ phận, Ngày mua, Ghi chú.'),
      'Ô chưa khai phải gom về MỘT dòng nói rõ còn thiếu gì, thay cho một dãy hộp toàn dấu gạch ngang',
    ).toBeVisible();

    /* ===== TAB PORT MAP ===== */
    await page.getByRole('tab', { name: 'Sơ đồ cổng' }).click();
    /*
     * `expect.poll`, KHÔNG phải `expect(await …)`.
     *
     * Lượt chạy đầu đỏ ở đúng đây với mảng RỖNG, mà ảnh chụp lại cho thấy hai tiêu đề nằm sờ
     * sờ trong panel. Nguyên nhân không phải giao diện thiếu: `PortMapPanel` hỏi
     * `/devices/:id/ports` rồi mới vẽ, nên ngay sau cú bấm tab nó đang là khối "Đang tải".
     * Đọc một phát bằng `await` thì đọc trúng khoảnh khắc đó và KHÔNG có lần đọc thứ hai —
     * đây là cái bẫy của mọi khẳng định so-tập-hợp: `expect(locator)` tự thử lại, `expect(giá
     * trị đã await)` thì không.
     */
    await expect
      .poll(() => nhanCua(panel.getByRole('heading', { level: 3 })), {
        message:
          'Port map luôn kể HAI chiều: cổng của máy này, và ai đang cắm vào nó (AD-14 — một sợi dây một bản ghi)',
      })
      .toEqual(['Cổng của thiết bị này', 'Đang cắm vào thiết bị này']);
    await expect(
      panel.getByRole('button', { name: 'Thêm cổng' }),
      'Máy chưa thanh lý thì phải khai được cổng',
    ).toBeVisible();
    await expect(panel.getByText('Chưa khai cổng nào.')).toBeVisible();
    await expect(
      panel.getByText('Chưa có thiết bị nào khai là đang cắm vào đây.'),
      'Chiều ngược rỗng vẫn phải nói ra, không được im lặng biến mất',
    ).toBeVisible();

    /* ===== TAB GIẤY TỜ ===== */
    await page.getByRole('tab', { name: /^Giấy tờ/ }).click();
    await expect(
      panel.getByRole('button', { name: 'Chọn file để đính kèm' }),
      'Tab Giấy tờ phải có khu chọn file',
    ).toBeVisible();
    await expect(
      panel.getByRole('button', { name: 'Tải lên' }),
      'Chọn file là tải ngay — không còn nút "Tải lên" riêng để người dùng quên bấm',
    ).toHaveCount(0);
    await expect(panel.getByText('Chưa có giấy tờ nào.')).toBeVisible();
    await expect(
      panel.getByText(
        'File luôn được TẢI VỀ, không mở trực tiếp trong trình duyệt (chống mã độc qua file).',
      ),
      'Luật "chỉ tải về, không mở inline" phải nói ra ngay chỗ người dùng đính kèm',
    ).toBeVisible();

    /* ===== TAB KÉT SẮT ===== */
    await page.getByRole('tab', { name: /^Két sắt/ }).click();
    await expect(
      panel.getByText(
        'Nơi cất mật khẩu và license key. Giá trị được mã hóa, chỉ xem được qua bước xác thực 2 lớp — bảng dưới đây chỉ hiện tên gọi.',
      ),
      'Két sắt phải tự nói ra luật chơi của nó trước khi ai bấm gì',
    ).toBeVisible();
    await expect(
      panel.getByRole('button', { name: 'Cất mật khẩu/khóa' }),
      'SA phải có cửa ghi vào két ngay tại hồ sơ máy',
    ).toBeVisible();
    await expect(panel.getByText('Két chưa có ngăn nào')).toBeVisible();

    /* ===== TAB LỊCH SỬ ===== */
    await page.getByRole('tab', { name: 'Lịch sử' }).click();
    await expect(
      panel.getByRole('listitem'),
      'Máy vừa khai xong phải có ĐÚNG MỘT dòng lịch sử — không có dòng nào nghĩa là lượt tạo không được ghi sổ (AD-13)',
    ).toHaveCount(1);
    await expect(
      panel.getByText('Tạo hồ sơ', { exact: true }),
      'và dòng đó phải đọc được ra tiếng Việt, không phải chuỗi thô "created"',
    ).toBeVisible();
    await expect(
      panel.getByText(E2E_SA.email),
      'Lịch sử phải nói AI làm — "ai đổi gì, lúc nào" là cả lý do tab này tồn tại (FR-007)',
    ).toBeVisible();
  });
});

/*
 * ===== VÀO HẲN TRONG PHÒNG: PHẦN MỀM và SẮP HẾT HẠN =====
 *
 * Mười bốn bài phía trên đi HÀNH LANG — menu, breadcrumb, ranh giới vai. Chúng chứng minh
 * "bấm vào đây thì tới được đó", nhưng không bao giờ hỏi "tới nơi rồi thì trong phòng có
 * những gì". Sáu bài dưới đây làm đúng việc còn thiếu đó cho hai phòng:
 *
 *   /software      — danh sách, hộp Thêm/Sửa hồ sơ, hộp Gán vào máy, trang hồ sơ và các tab
 *   /expiry        — tab Danh sách, tab Luật gửi báo cáo, hộp Gia hạn, hộp Thêm/Sửa luật
 *
 * VÌ SAO KHÔNG PHẢI `toBeVisible()` TỪNG CÁI. Khẳng định "nút X có mặt" chỉ bắt được thứ MẤT
 * ĐI. Thứ THỪA RA — một nút chưa gỡ sau khi bỏ tính năng, một ô nhập của module khác lọt vào
 * form, một mục menu bày ra cho hồ sơ đã thanh lý — thì luôn xanh. Nên ở đây đếm cả tập
 * (`toHaveCount` trên tập + `toEqual` trên danh sách tên), không liệt kê từng cái rồi thôi.
 *
 * Bộ E2E đã có `software.spec.ts`, `license-assignment.spec.ts`, `expiry.spec.ts`,
 * `expiry-digest.spec.ts` — chúng kiểm NGHIỆP VỤ (seat có tăng không, email có đi không, gia
 * hạn lùi có bị chặn không). Sáu bài này KHÔNG kiểm lại nghiệp vụ: chúng kiểm ĐỒ ĐẠC trong
 * phòng và tay nắm trên đồ đạc đó.
 */
test.describe('Phòng Phần mềm và phòng Sắp hết hạn — bên trong có gì', () => {
  test.beforeEach(() => {
    resetUsers();
    resetSoftware();
    // Bài "Gán vào máy" và bài tab "Máy đang dùng" cần máy thật; bài Sắp hết hạn cần một cái
    // máy còn hạn bảo hành để chứng minh vế KHÔNG gia hạn được.
    resetDevices();
    resetDigestRules();
  });

  /** Mã hồ sơ / mã máy / tên luật đều phải mang dấu "E2E" — script dọn bám vào đúng dấu đó. */
  const stampOf = () => uniqueStamp();

  async function createSoftware(
    page: Page,
    data: Record<string, unknown>,
  ): Promise<string> {
    const res = await page.request.post('/api/v1/software', {
      headers: await writeHeaders(page),
      data,
    });
    expect(res.status(), `tạo hồ sơ ${String(data.code)} phải thành công`).toBe(201);
    return ((await res.json()) as { id: string }).id;
  }

  async function createDevice(
    page: Page,
    code: string,
    extra: Record<string, unknown> = {},
  ): Promise<string> {
    const catalog = await page.request.get('/api/v1/catalog');
    const types = ((await catalog.json()) as { deviceTypes: { id: string; name: string }[] })
      .deviceTypes;
    const type = types.find((item) => item.name === 'PC') ?? types[0];
    const res = await page.request.post('/api/v1/devices', {
      headers: await writeHeaders(page),
      data: { code, name: `Máy ${code}`, deviceTypeId: type.id, ...extra },
    });
    expect(res.status(), `tạo máy ${code} phải thành công`).toBe(201);
    return ((await res.json()) as { device: { id: string } }).device.id;
  }

  /** Bày sẵn một cái ghế đã gán để tab "Máy đang dùng" có BẢNG chứ không phải khung rỗng. */
  async function assignSeat(
    page: Page,
    softwareId: string,
    deviceId: string,
    terms: Record<string, unknown>,
  ): Promise<void> {
    const res = await page.request.post(`/api/v1/software/${softwareId}/assignments`, {
      headers: await writeHeaders(page),
      data: { deviceId, overSeatReason: '', ...terms },
    });
    expect(res.status(), 'gán ghế license phải thành công').toBe(201);
  }

  /**
   * Tên các cột, đọc từ NỘI DUNG VĂN BẢN chứ không phải chữ đã qua CSS.
   *
   * ĐÃ ĐO (lượt chạy 10/09): `allInnerTexts()` trả về chữ SAU khi trình duyệt áp
   * `text-transform: uppercase` của `th`, nên nó ra "MÃ HỒ SƠ" trong khi chuỗi thật trong
   * `vi.ts` là "Mã hồ sơ". So với `vi.ts` mà lấy `innerText` là so hai thứ khác nhau: đổi
   * một dòng CSS sẽ làm đỏ một bài kiểm nội dung, còn đổi chữ trong `vi.ts` thì… cũng đỏ,
   * nhưng vì lý do trộn lẫn. `allTextContents()` không dính CSS.
   *
   * Cũng không dùng TÊN TRỢ NĂNG: tên trợ năng của ô tiêu đề sắp-xếp-được là "Sắp xếp theo
   * …" (nút con mang `aria-label` đó), một chuỗi khác hẳn thứ người dùng nhìn thấy.
   */
  async function columnTexts(page: Page): Promise<string[]> {
    const texts = await page.getByRole('columnheader').allTextContents();
    return texts.map((text) => text.trim());
  }

  /*
   * ===================================================================================
   * BÀI 1 — PHÒNG DANH SÁCH PHẦN MỀM: đầu trang có gì, lọc được gì, bảng có cột nào,
   *          và menu ba chấm của mỗi dòng bày ra ĐÚNG những việc làm được.
   * ===================================================================================
   *
   * VÌ SAO BÀI NÀY TỒN TẠI
   *
   * `software.spec.ts` đã kiểm sắp xếp chạy ở server và tạo hồ sơ qua form. Nhưng chưa bài
   * nào chốt BỘ ĐỒ của màn này: đúng hai nút đầu trang, đúng hai ô lọc, đúng tám cột, và —
   * quan trọng nhất — đúng những mục trong menu ba chấm. Ba mục đó có hai luật ẩn nằm trong
   * `software-screen.tsx`: "Gán vào máy" CHỈ có với loại license (`supportsSeats`), và "Đưa
   * vào kho thanh lý" BIẾN MẤT khi hồ sơ đã ở trạng thái `retired`.
   *
   * ĐỎ KHI: có thêm/bớt một nút ở đầu trang, một cột bị đổi tên hoặc rơi mất, ô tìm ngừng
   * lọc thật (bảng không thu hẹp), `aria-sort` không lật khi bấm tiêu đề, hàng không đảo
   * thứ tự, hoặc một trong hai luật ẩn của menu ba chấm bị gỡ — bày "Gán vào máy" cho một
   * hợp đồng bảo trì, hoặc bày "Đưa vào kho thanh lý" cho hồ sơ đã bỏ.
   */
  test('Phòng Phần mềm: đúng bộ nút, ô tìm thu hẹp thật, đủ cột, và menu ba chấm theo loại', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await firstLogin(page, E2E_SA);

    const stamp = stampOf();
    const prefix = `PHONG-E2E-${stamp}`;
    const licenseCode = `${prefix}-A-LIC`;
    const sslCode = `${prefix}-B-SSL`;
    const maintCode = `${prefix}-C-MAINT`;

    const licenseId = await createSoftware(page, {
      code: licenseCode,
      name: 'Zulu — license xếp cuối theo tên',
      kind: 'license',
      seatTotal: 5,
      startDate: '2026-01-01',
      endDate: '2028-12-31',
    });
    await createSoftware(page, {
      code: sslCode,
      name: 'Alpha — chứng chỉ xếp đầu theo tên',
      kind: 'ssl',
      endDate: '2029-01-31',
    });
    await createSoftware(page, {
      code: maintCode,
      name: 'Mike — hợp đồng xếp giữa theo tên',
      kind: 'maintenance',
      endDate: '2029-02-28',
    });

    await page.goto('/software');
    const main = page.getByRole('main');
    const search = page.getByRole('searchbox', { name: 'Tìm theo mã, tên, ghi chú hoặc mã máy' });

    /*
     * BỘ NÚT ĐẦU TRANG — đếm khi bảng RỖNG.
     *
     * Lúc bảng có dòng thì mỗi tiêu đề sắp-xếp-được là một nút, mỗi dòng thêm một nút ba
     * chấm, và phân trang thêm ba nút nữa — không còn đếm được cái gì. Gõ một chuỗi chắc
     * chắn không khớp là dọn sạch phần đó đi, chỉ còn lại đúng bộ đồ cố định của phòng:
     * hai nút đầu trang + hai ô lọc.
     */
    await search.fill(`KHONG-CO-HO-SO-NAO-E2E-${stamp}`);
    await expect(
      page.getByText('Không có hồ sơ nào khớp bộ lọc.'),
      'Lọc không ra gì phải nói rõ là rỗng, không phải bảng trắng',
    ).toBeVisible();

    await expect(
      main.getByRole('button'),
      'Phòng Phần mềm lúc rỗng chỉ được có 6 nút: Xuất Excel · Thêm hồ sơ · ô lọc Loại · Trạng thái · Nhà cung cấp · Kỳ hạn',
    ).toHaveCount(6);
    for (const name of ['Xuất Excel', 'Thêm hồ sơ', 'Loại', 'Trạng thái', 'Nhà cung cấp', 'Kỳ hạn']) {
      await expect(
        main.getByRole('button', { name, exact: true }),
        `Đầu phòng Phần mềm phải có đúng một nút "${name}"`,
      ).toHaveCount(1);
    }

    // ===== Ô TÌM PHẢI THU HẸP BẢNG THẬT, không chỉ đổi chữ trong ô =====
    await search.fill(prefix);
    await expect(
      page.getByRole('row'),
      'Gõ tiền tố chung phải ra đúng 3 hồ sơ vừa tạo (cộng 1 dòng tiêu đề)',
    ).toHaveCount(4);

    await search.fill(sslCode);
    await expect(
      page.getByRole('row'),
      'Gõ đích danh một mã thì bảng phải còn đúng dòng đó',
    ).toHaveCount(2);
    await expect(
      page.getByRole('row', { name: new RegExp(licenseCode) }),
      'Hồ sơ không khớp ô tìm phải BIẾN MẤT — nếu còn thì ô tìm chỉ là trang trí',
    ).toHaveCount(0);

    // ===== ĐỦ BỘ CỘT =====
    await search.fill(prefix);
    await expect(page.getByRole('row')).toHaveCount(4);
    expect(
      await columnTexts(page),
      /* Loại là dòng phụ dưới tên; "Tình trạng" gộp hạn + trạng thái Q-03 — để bảng vừa
         1280px với cột Thao tác trong khung. */
      'Bảng phần mềm phải có đúng 6 cột này, đúng thứ tự này',
    ).toEqual(['Mã hồ sơ', 'Tên hồ sơ', 'Nhà cung cấp', 'Ghế', 'Tình trạng', 'Thao tác']);

    // ===== SẮP XẾP: aria-sort phải lật, VÀ thứ tự dòng phải đảo theo =====
    const sortByCode = page.getByRole('button', { name: 'Sắp xếp theo Mã hồ sơ' });
    const codeHeader = page
      .getByRole('columnheader')
      .filter({ has: page.getByRole('button', { name: 'Sắp xếp theo Mã hồ sơ' }) });

    await expect(
      codeHeader,
      'Mặc định danh sách sắp theo mã tăng dần — ô tiêu đề phải nói ra điều đó',
    ).toHaveAttribute('aria-sort', 'ascending');
    await expect(
      page.getByRole('row').nth(1),
      'Sắp tăng theo mã thì hồ sơ ...-A-LIC đứng đầu',
    ).toContainText(licenseCode);

    await sortByCode.click();
    await expect(
      codeHeader,
      'Bấm lần nữa phải lật sang giảm dần — `aria-sort` là thứ duy nhất người dùng trình đọc màn hình nghe được',
    ).toHaveAttribute('aria-sort', 'descending');
    await expect(
      page.getByRole('row').nth(1),
      'Lật `aria-sort` mà thứ tự dòng không đổi thì cái mũi tên đang nói dối',
    ).toContainText(maintCode);

    /*
     * ===== MENU BA CHẤM: ĐÚNG NHỮNG MỤC NÀO =====
     *
     * `toEqual` chứ không phải "có chứa": mục thừa ra mới là kiểu hỏng im lặng. Bày "Gán vào
     * máy" trên một hợp đồng bảo trì thì bấm vào sẽ mở hộp gán seat cho thứ không có seat.
     */
    expect(
      await rowActionNames(page, licenseCode),
      'Hồ sơ LICENSE còn dùng: Sửa · Gán vào máy · Gia hạn · Đưa vào kho thanh lý (việc nguy hiểm xếp cuối)',
    ).toEqual(['Sửa', 'Gán vào máy', 'Gia hạn', 'Đưa vào kho thanh lý']);

    expect(
      await rowActionNames(page, maintCode),
      'Hợp đồng bảo trì KHÔNG có ghế để gán — mục "Gán vào máy" không được xuất hiện',
    ).toEqual(['Sửa', 'Gia hạn', 'Đưa vào kho thanh lý']);

    /*
     * Vế còn lại của luật ẩn: hồ sơ ĐÃ BỎ thì không bày mục bỏ nữa. Đưa vào kho bằng API cho
     * gọn — bài này kiểm CÁI MENU, không kiểm luồng thanh lý (đã có `disposal.spec.ts`).
     */
    const retired = await page.request.patch(`/api/v1/software/${licenseId}`, {
      headers: await writeHeaders(page),
      data: { status: 'retired' },
    });
    expect(retired.status(), 'đưa hồ sơ vào kho thanh lý qua API phải thành công').toBeLessThan(300);

    // Mặc định danh sách giấu hồ sơ Thanh lý (SW-006) — chọn "Mọi trạng thái" qua URL.
    await page.goto('/software?status=all');
    await search.fill(prefix);
    await expect(page.getByRole('row', { name: new RegExp(licenseCode) })).toBeVisible();
    expect(
      await rowActionNames(page, licenseCode),
      'Hồ sơ đã bỏ: không Gán, không Gia hạn, không bỏ lần hai — chỉ Sửa và Khôi phục…',
    ).toEqual(['Sửa', 'Khôi phục…']);
  });

  /*
   * ===================================================================================
   * BÀI 2 — MỞ HỘP "THÊM HỒ SƠ" RA XEM BÊN TRONG, rồi mở hộp "SỬA HỒ SƠ" xem nó có
   *          mang giá trị cũ vào không.
   * ===================================================================================
   *
   * VÌ SAO BÀI NÀY TỒN TẠI
   *
   * `software.spec.ts` điền ba ô rồi bấm Lưu — đủ để chứng minh form GHI được, không đủ để
   * chứng minh form còn ĐỦ Ô. Một `<Field>` lặng lẽ rơi mất khỏi `software-form.tsx` là một
   * trường không bao giờ được nhập nữa: hồ sơ vẫn lưu thành công, cột trên bảng vẫn hiện dấu
   * gạch, và không có bài nào đỏ.
   *
   * Bài này chốt cả BA thứ: đủ ô, đúng vai của từng ô (textbox / nút chọn / ô ngày / nút chọn
   * file), và đúng danh sách lựa chọn bên trong mỗi ô chọn.
   *
   * ĐỎ KHI: thêm hoặc bớt một ô trong form; một ô đổi từ `Select` sang `<input>` (người dùng
   * bàn phím thao tác khác hẳn); ô "Trạng thái" rò rỉ sang form THÊM MỚI (mở đường cho một
   * hồ sơ vừa tạo đã ở trạng thái "đã thanh lý"); danh sách loại/kỳ hạn/nhà cung cấp lệch
   * khỏi danh mục thật; câu báo lỗi đổi mà không ai biết; hoặc form Sửa mở ra TRỐNG.
   */
  test('Bên trong hộp "Thêm hồ sơ" và hộp "Sửa hồ sơ" — đủ ô, đúng vai, đúng lựa chọn', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await firstLogin(page, E2E_SA);

    const stamp = stampOf();
    const code = `HOP-E2E-${stamp}-LIC`;
    await createSoftware(page, {
      code,
      name: 'License để mở form sửa',
      kind: 'license',
      seatTotal: 7,
      startDate: '2026-02-01',
      endDate: '2028-11-30',
      note: 'Ghi chú cũ của hồ sơ E2E',
    });

    // Danh mục nhà cung cấp là dữ liệu THẬT của hệ thống — đọc từ API rồi so với ô chọn,
    // chứ không gõ cứng vài cái tên (gõ cứng thì bài đỏ mỗi lần ai đó khai thêm một hãng).
    const catalogRes = await page.request.get('/api/v1/catalog?includeInactive=true');
    const vendorNames = ((await catalogRes.json()) as { vendors: { name: string }[] }).vendors.map(
      (vendor) => vendor.name,
    );

    await page.goto('/software');
    await page.getByRole('button', { name: 'Thêm hồ sơ' }).click();

    const add = page.getByRole('dialog', { name: 'Thêm hồ sơ' });
    await expect(add, 'Bấm "Thêm hồ sơ" phải mở đúng hộp mang tên đó').toBeVisible();

    /*
     * ===== TIÊU ĐỀ HỘP + BA KHỐI CỦA FORM =====
     *
     * Bốn chứ không phải ba: Radix vẽ TIÊU ĐỀ HỘP THOẠI cũng bằng `<h2>`, nên nó đứng cùng
     * hạng với ba tiêu đề khối bên dưới. Đọc `textContent` (không phải `innerText`) vì
     * `.form-section-title` viết hoa toàn bộ bằng CSS.
     */
    expect(
      (await add.getByRole('heading', { level: 2 }).allTextContents()).map((text) => text.trim()),
      'Hộp thêm hồ sơ (license): tiêu đề hộp, rồi các khối — hồ sơ, thời hạn, ghế, ghi chú, giấy tờ',
    ).toEqual(['Thêm hồ sơ', 'Hồ sơ', 'Thời hạn', 'Ghế', 'Ghi chú', 'Giấy tờ đính kèm']);

    // ===== Ô GÕ CHỮ =====
    await expect(
      add.getByRole('textbox'),
      'Form thêm hồ sơ có đúng 4 ô gõ chữ: Mã hồ sơ · Tên hồ sơ · Số ghế · Ghi chú',
    ).toHaveCount(4);
    for (const name of ['Mã hồ sơ', 'Tên hồ sơ', 'Số ghế', 'Ghi chú']) {
      await expect(
        add.getByRole('textbox', { name, exact: true }),
        `Ô "${name}" phải là ô gõ chữ và phải có đúng một cái`,
      ).toHaveCount(1);
    }

    /*
     * ===== NÚT: ô chọn, ô ngày, ô chọn file, và hai nút chân hộp =====
     *
     * `<input type="file">` được trình duyệt phơi ra như một NÚT mang tên của nhãn — nên nó
     * nằm trong phép đếm này chứ không nằm trong phép đếm ô gõ chữ ở trên.
     */
    await expect(
      add.getByRole('button'),
      'Hộp thêm hồ sơ có đúng 7 nút — thừa một cái là có thứ gì đó vừa lọt vào form',
    ).toHaveCount(7);
    for (const name of [
      'Đóng hộp thoại',
      'Nhà cung cấp',
      'Bắt đầu',
      'Hết hạn',
      'Chọn file để đính kèm',
      'Hủy',
      'Lưu',
    ]) {
      await expect(
        add.getByRole('button', { name, exact: true }),
        `Hộp thêm hồ sơ phải có đúng một nút "${name}"`,
      ).toHaveCount(1);
    }

    await expect(
      add.getByRole('button', { name: 'Trạng thái', exact: true }),
      'THÊM MỚI thì không được có ô Trạng thái: hồ sơ vừa tạo mà chọn được "đã thanh lý" là vô nghĩa',
    ).toHaveCount(0);

    /*
     * ===== BÊN TRONG TỪNG Ô CHỌN =====
     *
     * Danh sách lựa chọn PORTAL ra khỏi khung `<form>`, nên hỏi từ `page` chứ không từ `add`.
     * Đóng menu bằng cách bấm lại đúng lựa chọn đang chọn — không đổi dữ liệu, và không phải
     * mượn phím Esc (Esc ở đây còn có nghĩa "đóng cả hộp thoại").
     */
    // Loại là dải nút chọn ĐẦU form (SW-026): nó quyết định form có những ô nào.
    const kindGroup = add.getByRole('radiogroup', { name: 'Loại' });
    expect(
      (await kindGroup.getByRole('radio').evaluateAll((els) =>
        els.map((el) => (el.closest('label')?.textContent ?? '').trim()),
      )),
      'Ô "Loại" phải bày đủ 5 loại hồ sơ mà hệ thống biết',
    ).toEqual([
      'License phần mềm',
      'Chứng chỉ SSL',
      'Tên miền',
      'Hợp đồng bảo trì',
      'Khác',
    ]);
    await expect(kindGroup.getByRole('radio', { name: 'License phần mềm' })).toBeChecked();

    const modelGroup = add.getByRole('radiogroup', { name: 'Kỳ hạn' });
    await expect(
      modelGroup.getByRole('radio'),
      'Kỳ hạn chỉ có hai đường: thuê bao (có hạn) hoặc mua đứt',
    ).toHaveCount(2);
    await expect(modelGroup.getByRole('radio', { name: 'Thuê bao' })).toBeChecked();
    // Vĩnh viễn: ô Hết hạn thành chữ tĩnh "Không hết hạn", không biến mất (bố cục không nhảy).
    await modelGroup.getByRole('radio', { name: 'Vĩnh viễn' }).check();
    await expect(add.getByText('Không hết hạn')).toBeVisible();
    await expect(add.getByRole('button', { name: 'Hết hạn', exact: true })).toHaveCount(0);
    await modelGroup.getByRole('radio', { name: 'Thuê bao' }).check();

    const vendorSelect = add.getByRole('button', { name: 'Nhà cung cấp', exact: true });
    await vendorSelect.click();
    expect(
      (await page.getByRole('option').allInnerTexts()).map((text) => text.trim()),
      'Ô nhà cung cấp phải bày đúng danh mục hãng đang có, không nhiều không ít',
    ).toEqual(vendorNames);
    // Bấm lại chính cái nút để đóng danh sách: danh mục hãng có thể rỗng nên không chắc có
    // lựa chọn nào để bấm, và Esc ở đây còn mang nghĩa thứ hai là "đóng cả hộp thoại".
    await vendorSelect.click();
    await expect(page.getByRole('option'), 'Danh sách hãng phải đóng lại').toHaveCount(0);

    /*
     * ===== ĐƯỜNG HỎNG (SW-024) =====
     *
     * Điền hai ô bắt buộc bằng KHOẢNG TRẮNG: luật `trim()` của form phải bắt, và câu lỗi là
     * tiếng Việt dưới từng ô — không còn bong bóng tiếng Anh của trình duyệt (form `noValidate`).
     */
    await add.getByRole('textbox', { name: 'Mã hồ sơ', exact: true }).fill('   ');
    await add.getByRole('textbox', { name: 'Tên hồ sơ', exact: true }).fill('   ');
    await add.getByTestId('dialog-footer').getByRole('button', { name: 'Lưu' }).click();

    await expect(
      add.getByRole('textbox', { name: 'Mã hồ sơ', exact: true }),
      'Lưu hồ sơ trống phải nói rõ thiếu gì, ngay dưới ô Mã',
    ).toHaveAccessibleDescription('Bắt buộc — chưa nhập ô này.');
    await expect(
      add.getByRole('textbox', { name: 'Tên hồ sơ', exact: true }),
      'và dưới ô Tên',
    ).toHaveAccessibleDescription('Bắt buộc — chưa nhập ô này.');
    // Kỳ hạn đang là Thuê bao mà chưa có ngày hết hạn: báo ngay tại ô (SW-028), nên là BA ô.
    await expect(
      add.getByText('Nhập ngày hết hạn — thiếu hạn thì hệ thống không nhắc gia hạn được.'),
    ).toBeVisible();
    await expect(add.getByText('Còn 3 ô cần sửa trước khi lưu.')).toBeVisible();
    await expect(
      add,
      'Lưu hỏng thì hộp phải Ở LẠI — đóng mất là người dùng tưởng đã lưu xong',
    ).toBeVisible();

    // ===== HAI ĐƯỜNG ĐÓNG HỘP =====
    /* Form đã gõ dở, nên từ 12/09 lối đóng TÌNH CỜ phải hỏi lại trước
       (`Dialog guardUnsaved`, rà UI/UX #10) — trả lời xong mới đóng. */
    await add.getByRole('button', { name: 'Đóng hộp thoại' }).click();
    await confirmAction(page, 'Bỏ và đóng');
    await expect(add, 'Nút ✕ phải đóng được hộp').toHaveCount(0);

    await page.getByRole('button', { name: 'Thêm hồ sơ' }).click();
    await expect(add).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(add, 'Phím Esc cũng phải đóng được hộp (hộp không đang ghi)').toHaveCount(0);

    /*
     * ===== CHẾ ĐỘ SỬA: form phải mang giá trị cũ vào =====
     *
     * Form sửa mở ra trống là kiểu hỏng tệ nhất của màn nhập: bấm Lưu một phát là ghi đè sạch
     * mọi thứ, và trên màn hình không có gì báo rằng dữ liệu vừa bị xóa.
     */
    await timVaChoLoc(page, code);
    await expect(page.getByRole('row', { name: new RegExp(code) })).toBeVisible();
    await rowAction(page, code, 'Sửa');

    const edit = page.getByRole('dialog', { name: `Sửa hồ sơ — ${code}` });
    await expect(edit, 'Hộp sửa phải mang tên hồ sơ đang sửa trên tiêu đề').toBeVisible();

    await expect(
      edit.getByRole('textbox', { name: 'Mã hồ sơ', exact: true }),
      'Ô mã phải mang mã cũ',
    ).toHaveValue(code);
    await expect(
      edit.getByRole('textbox', { name: 'Tên hồ sơ', exact: true }),
      'Ô tên phải mang tên cũ',
    ).toHaveValue('License để mở form sửa');
    await expect(
      edit.getByRole('textbox', { name: 'Số ghế', exact: true }),
      'Ô số ghế phải mang số cũ',
    ).toHaveValue('7');
    await expect(
      edit.getByRole('textbox', { name: 'Ghi chú', exact: true }),
      'Ô ghi chú phải mang ghi chú cũ',
    ).toHaveValue('Ghi chú cũ của hồ sơ E2E');

    await expect(
      edit.getByRole('radio', { name: 'License phần mềm' }),
      'Ô chọn Loại phải đang đứng ở loại cũ',
    ).toBeChecked();
    await expect(
      edit.getByRole('radio', { name: 'Thuê bao' }),
      'Ô chọn Kỳ hạn phải đang đứng ở kỳ hạn cũ',
    ).toBeChecked();
    await expect(
      edit.getByRole('button', { name: 'Hết hạn', exact: true }),
      'Ô ngày hết hạn phải mang hạn cũ (2028), không phải chữ mời chọn ngày',
    ).toContainText('2028');

    // Ô Trạng thái CHỈ có ở chế độ sửa — đây là vế đối chứng của phép đếm bên form thêm mới.
    const statusSelect = edit.getByRole('button', { name: 'Trạng thái', exact: true });
    await expect(statusSelect, 'Sửa hồ sơ thì phải đổi được trạng thái').toHaveCount(1);
    await expect(statusSelect, 'Hồ sơ vừa tạo đang ở trạng thái đang dùng').toHaveText('Đang dùng');
    await statusSelect.click();
    expect(
      (await page.getByRole('option').allInnerTexts()).map((text) => text.trim()),
      'Người chỉ chọn Đang dùng / Thanh lý — "Hết hạn" do hệ thống tự đặt theo ngày (DOM-03)',
    ).toEqual(['Đang dùng', 'Đã thanh lý']);
    await statusSelect.click();
    await expect(page.getByRole('option'), 'Danh sách trạng thái phải đóng lại').toHaveCount(0);

    // Đóng mà KHÔNG lưu — bài này chỉ đi xem, không được để lại dấu vết trên dữ liệu.
    await edit.getByRole('button', { name: 'Đóng hộp thoại' }).click();
    await expect(edit).toHaveCount(0);
  });

  /*
   * ===================================================================================
   * BÀI 3 — HỘP "GÁN VÀO MÁY": một cái hộp, HAI chế độ.
   * ===================================================================================
   *
   * VÌ SAO BÀI NÀY TỒN TẠI
   *
   * `AssignDialog` phục vụ cả "gán máy mới" lẫn "sửa kỳ hạn/chi phí của một ghế đã gán" —
   * cùng một bộ ô, khác nhau đúng hai chỗ: có ô chọn máy hay không, và nút chân hộp ghi
   * "Gán vào máy" hay "Lưu". Gộp như thế là cố ý (AD-15), nhưng nó cũng có nghĩa là một thay
   * đổi cho chế độ này lặng lẽ đổi luôn chế độ kia.
   *
   * `license-assignment.spec.ts` kiểm NGHIỆP VỤ của hai chế độ (seat tăng, vượt seat, kỳ hạn
   * ngược). Bài này kiểm HÌNH DẠNG: đủ ô, đúng vai, và hai chế độ khác nhau đúng ở hai chỗ đó.
   *
   * ĐỎ KHI: một ô kỳ hạn/chi phí rơi mất ở một trong hai chế độ; ô chọn máy đổi vai (từ
   * combobox gõ-để-tìm sang một danh sách thả xuống); ô chọn máy rò sang chế độ SỬA (đổi máy
   * bằng cách sửa ghế thì lịch sử "key này từng nhập máy nào" mất một chặng); ô "Lý do vượt
   * seat" hiện ngay từ đầu; hoặc câu chặn "Chọn máy để gán." biến mất.
   */
  test('Bên trong hộp "Gán vào máy" — chế độ gán mới và chế độ sửa ghế', async ({ page }) => {
    test.setTimeout(150_000);
    await firstLogin(page, E2E_SA);

    const stamp = stampOf();
    const licenseCode = `GAN-E2E-${stamp}-LIC`;
    const deviceCode = `PC-E2E-GAN-${stamp}`;

    const licenseId = await createSoftware(page, {
      code: licenseCode,
      name: 'License để mở hộp gán',
      kind: 'license',
      seatTotal: 5,
      endDate: '2028-12-31',
    });
    const deviceId = await createDevice(page, deviceCode);

    // ===== CHẾ ĐỘ GÁN MỚI, mở thẳng từ menu ba chấm của danh sách =====
    await page.goto('/software');
    await timVaChoLoc(page, licenseCode);
    await expect(page.getByRole('row', { name: new RegExp(licenseCode) })).toBeVisible();
    await rowAction(page, licenseCode, 'Gán vào máy');

    const assign = page.getByRole('dialog', { name: `Gán license vào máy — ${licenseCode}` });
    await expect(assign, 'Hộp gán phải nói rõ đang gán license nào').toBeVisible();

    await expect(
      assign.getByRole('combobox'),
      'Chọn máy là ô GÕ ĐỂ TÌM (combobox), không phải danh sách thả xuống — kho có hàng nghìn máy',
    ).toHaveCount(1);

    await expect(
      assign.getByRole('textbox'),
      'Hộp gán có đúng 3 ô gõ chữ: Chi phí · Hợp đồng · Ghi chú',
    ).toHaveCount(3);
    for (const name of ['Chi phí', 'Hợp đồng', 'Ghi chú']) {
      await expect(
        assign.getByRole('textbox', { name, exact: true }),
        `Hộp gán phải có đúng một ô "${name}"`,
      ).toHaveCount(1);
    }

    await expect(
      assign.getByRole('button'),
      'Hộp gán có đúng 5 nút: ✕ · hai ô ngày · Hủy · Gán vào máy',
    ).toHaveCount(5);
    for (const name of ['Đóng hộp thoại', 'Bắt đầu', 'Kết thúc', 'Hủy', 'Gán vào máy']) {
      await expect(
        assign.getByRole('button', { name, exact: true }),
        `Hộp gán phải có đúng một nút "${name}"`,
      ).toHaveCount(1);
    }

    await expect(
      assign.getByRole('textbox', { name: 'Lý do vượt số ghế', exact: true }),
      'Ô lý do vượt seat chỉ mở ra KHI hết seat — bày sẵn là mời người ta khai một thứ chưa cần',
    ).toHaveCount(0);

    // ===== ĐƯỜNG HỎNG: bấm gán mà chưa chọn máy =====
    await assign.getByTestId('dialog-footer').getByRole('button', { name: 'Gán vào máy' }).click();
    await expect(
      assign.getByRole('alert'),
      'Chưa chọn máy mà bấm gán thì phải nói đúng câu trong vi.ts',
    ).toHaveText('Chọn máy để gán.');
    await expect(assign, 'Gán hỏng thì hộp phải ở lại để người dùng sửa').toBeVisible();

    // ===== Ô CHỌN MÁY CÓ GÕ RA MÁY THẬT KHÔNG =====
    await assign.getByRole('combobox').fill(deviceCode);
    await expect(
      page.getByRole('option', { name: new RegExp(deviceCode) }),
      'Gõ mã máy vào ô tìm phải bung ra đúng cái máy đó — ô tìm không tìm ra gì thì hộp này vô dụng',
    ).toBeVisible();

    await assign.getByRole('button', { name: 'Đóng hộp thoại' }).click();
    await expect(assign, 'Đóng hộp gán mà không lưu gì').toHaveCount(0);

    /*
     * ===== CHẾ ĐỘ SỬA GHẾ =====
     *
     * Bày sẵn một ghế có ĐỦ kỳ hạn và chi phí qua API, rồi mở hộp sửa của nó: đây là chỗ duy
     * nhất chứng minh hộp mang giá trị cũ vào chứ không mở ra trống.
     */
    await assignSeat(page, licenseId, deviceId, {
      cost: 1500000,
      contract: 'HD-E2E-2026-07',
      startDate: '2026-03-01',
      endDate: '2027-02-28',
      note: 'Ghế của phòng Kế toán',
    });

    /*
     * BẤM VÀO TAB, KHÔNG GÕ `?tab=devices`.
     *
     * ĐÃ ĐO (lượt chạy 10/09): mở thẳng `/software/<id>?tab=devices` rơi xuống tab "Hồ sơ".
     * `useVisibleTab` chạy ngay từ lượt render ĐẦU, lúc `software.data` chưa về nên danh sách
     * tab chưa có "devices" (tab đó chỉ mọc ra khi biết hồ sơ là license) — nó kẹp về
     * "profile" và không bao giờ quay lại. Đó là một lỗi THẬT, được ghi thành bài riêng
     * `test.fixme` ở cuối khối này. Ở đây thì đi đường của người dùng: bấm tab.
     */
    await page.goto(`/software/${licenseId}`);
    await page.getByRole('tab', { name: /^Máy đang dùng/ }).click();
    const seatRow = page.getByRole('row', { name: new RegExp(deviceCode) });
    await expect(seatRow, 'Ghế vừa gán phải hiện trong tab Máy đang dùng').toBeVisible();
    /* "Sửa" và "Gỡ" nay ở trong menu ba chấm, không còn hai nút sát nhau (rà UI/UX #21). */
    await seatRow.getByRole('button', { name: /^Thao tác với / }).click();
    await page.getByRole('menuitem', { name: 'Sửa', exact: true }).click();

    const editSeat = page.getByRole('dialog', { name: `Sửa ghế license — ${deviceCode}` });
    await expect(editSeat, 'Hộp sửa ghế phải mang mã máy trên tiêu đề').toBeVisible();

    await expect(
      editSeat.getByRole('combobox'),
      'Sửa ghế KHÔNG được đổi máy: đổi máy là gỡ ghế cũ rồi gán ghế mới, không phải sửa tại chỗ',
    ).toHaveCount(0);
    await expect(
      editSeat.getByText(deviceCode, { exact: true }),
      'Máy của ghế phải hiện ra dạng chữ tĩnh để biết đang sửa ghế nào',
    ).toBeVisible();

    await expect(
      editSeat.getByRole('textbox', { name: 'Chi phí', exact: true }),
      'Chi phí cũ phải nằm sẵn trong ô — mở ra trống là bấm Lưu một phát mất luôn con số',
    ).toHaveValue('1.500.000');
    await expect(
      editSeat.getByRole('textbox', { name: 'Hợp đồng', exact: true }),
      'Số hợp đồng cũ phải nằm sẵn trong ô',
    ).toHaveValue('HD-E2E-2026-07');
    await expect(
      editSeat.getByRole('textbox', { name: 'Ghi chú', exact: true }),
      'Ghi chú cũ phải nằm sẵn trong ô',
    ).toHaveValue('Ghế của phòng Kế toán');
    await expect(
      editSeat.getByRole('button', { name: 'Kết thúc', exact: true }),
      'Kỳ hạn riêng của ghế phải mang ngày cũ (2027)',
    ).toContainText('2027');

    const seatFooter = editSeat.getByTestId('dialog-footer');
    await expect(
      seatFooter.getByRole('button', { name: 'Lưu', exact: true }),
      'Chân hộp ở chế độ SỬA ghi "Lưu"',
    ).toHaveCount(1);
    await expect(
      seatFooter.getByRole('button', { name: 'Gán vào máy', exact: true }),
      'Chân hộp ở chế độ SỬA không được ghi "Gán vào máy" — nó không gán thêm ghế nào',
    ).toHaveCount(0);

    await page.keyboard.press('Escape');
    await expect(editSeat, 'Esc đóng được hộp sửa ghế').toHaveCount(0);
  });

  /*
   * ===================================================================================
   * BÀI 4 — TRANG HỒ SƠ PHẦN MỀM: mỗi tab bên trong có gì.
   * ===================================================================================
   *
   * VÌ SAO BÀI NÀY TỒN TẠI
   *
   * Bài "đi hết các tab" ở khối 1 chỉ khẳng định bấm tab nào thì tab đó sáng và panel không
   * rỗng — nó cố ý không biết panel chứa gì. Nhưng "panel không rỗng" vẫn xanh khi một tab
   * vẽ nhầm nội dung của tab khác, hoặc khi khu giấy tờ mất bảng chỉ còn một câu.
   *
   * Bài này đi vào từng tab và chốt thứ ĐẶC TRƯNG của tab đó, kèm luật ẩn quan trọng nhất
   * của trang: tab "Máy đang dùng" CHỈ có với loại license.
   *
   * ĐỎ KHI: thanh tab thêm/bớt một tab; tab "Máy đang dùng" mọc ra ở hồ sơ không phải license
   * (hoặc mất khỏi license); bảng ghế đổi cột; khu Két sắt hay khu Giấy tờ mất nút/mất câu
   * dẫn; hoặc lịch sử không ghi lại việc tạo hồ sơ và việc gán ghế.
   */
  test('Hồ sơ phần mềm: mỗi tab có đúng đồ của tab đó, và "Máy đang dùng" chỉ dành cho license', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await firstLogin(page, E2E_SA);

    const stamp = stampOf();
    const licenseCode = `TAB-E2E-${stamp}-LIC`;
    const domainCode = `TAB-E2E-${stamp}-DOM`;
    const deviceCode = `PC-E2E-TAB-${stamp}`;

    const licenseId = await createSoftware(page, {
      code: licenseCode,
      name: 'License có ghế để xem tab',
      kind: 'license',
      seatTotal: 4,
      startDate: '2026-01-15',
      endDate: '2028-10-31',
      note: 'Ghi chú của hồ sơ license',
    });
    const domainId = await createSoftware(page, {
      code: domainCode,
      name: 'Tên miền không có ghế',
      kind: 'domain',
      endDate: '2028-09-30',
    });
    const deviceId = await createDevice(page, deviceCode);
    await assignSeat(page, licenseId, deviceId, { contract: 'HD-E2E-TAB' });

    await page.goto(`/software/${licenseId}`);
    await expect(
      page.getByRole('heading', { level: 1, name: new RegExp(licenseCode) }),
      'Trang hồ sơ phải mở đúng license vừa tạo',
    ).toBeVisible();

    // ===== THANH THAO TÁC ĐẦU TRANG =====
    for (const name of ['Sửa hồ sơ', 'Gia hạn', `Thao tác với ${licenseCode}`]) {
      await expect(
        page.getByRole('button', { name, exact: true }),
        `Đầu trang hồ sơ phải có đúng một nút "${name}"`,
      ).toHaveCount(1);
    }
    // Thanh lý nằm trong menu "⋯" (mục nguy hiểm ở cuối), không còn là nút đỏ đứng lẻ.
    expect(
      await rowActionNames(page, licenseCode),
      'Menu "⋯" đầu trang hồ sơ có mục Đưa vào kho thanh lý',
    ).toEqual(['Đưa vào kho thanh lý']);

    /*
     * ===== THANH TAB =====
     *
     * Nhãn tab có số đếm nối sau ("Giấy tờ 0"), và con số đó đến sau khi dữ liệu về — so tên
     * nguyên văn là bài sẽ chập chờn theo tốc độ mạng. Cắt phần số đi rồi mới so cả tập.
     */
    const tabNames = async () =>
      (await page.getByRole('tab').allInnerTexts()).map((text) =>
        text.trim().replace(/\s+\d+$/, ''),
      );

    expect(
      await tabNames(),
      'Hồ sơ LICENSE có đủ năm tab, đúng thứ tự này',
    ).toEqual(['Hồ sơ', 'Máy đang dùng', 'Két sắt', 'Giấy tờ', 'Lịch sử']);

    // License mở sẵn tab "Máy đang dùng" — thứ người ta mở hồ sơ để xem.
    await expect(page.getByRole('tab', { name: /^Máy đang dùng/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    // ===== TAB HỒ SƠ =====
    await page.getByRole('tab', { name: 'Hồ sơ', exact: true }).click();
    const profile = page.getByRole('tabpanel');
    /*
     * HẠN NẰM Ở THẺ ĐỊNH DANH, KHÔNG CÒN Ở TAB HỒ SƠ (đợt dựng lại 16-17/09/2026).
     *
     * Bản trước của bài này đòi một `<h2>Hết hạn</h2>` bên trong tab. Đúng với bố cục cũ, và
     * chính bố cục cũ là thứ đem sửa: nó vẽ một thẻ "Hết hạn" chiếm trọn bề ngang ở cột chính,
     * rồi dải chỉ số vẽ LẠI y hệt cách đó hai dòng. Giờ hạn chỉ còn một chỗ — cột phải.
     *
     * Bài kiểm vì thế đổi CHỖ HỎI chứ không hạ yêu cầu: vẫn phải có thanh thời hạn đầy đủ
     * (thanh tiến trình + hai mốc ngày), và cột chính KHÔNG được vẽ lại lần nữa.
     */
    const theDinhDanh = page.getByRole('region', { name: 'Thẻ định danh' });
    await expect(
      theDinhDanh.getByRole('progressbar'),
      'Hồ sơ có hạn thì thẻ định danh phải vẽ thanh thời hạn đầy đủ',
    ).toHaveCount(1);
    await expect(
      profile.getByRole('progressbar'),
      'Cột chính KHÔNG được vẽ lại thanh thời hạn — đó đúng là chỗ trùng lặp đợt dựng lại đi bỏ',
    ).toHaveCount(0);
    for (const label of ['Kỳ hạn', 'Ghi chú']) {
      await expect(
        profile.getByText(label, { exact: true }),
        `Lưới thông tin của tab Hồ sơ phải có ô "${label}"`,
      ).toHaveCount(1);
    }

    // ===== TAB MÁY ĐANG DÙNG =====
    await page.getByRole('tab', { name: /^Máy đang dùng/ }).click();
    for (const name of [/^Gán vào máy$/, /^Đang dùng \d+$/, /^Đã gỡ \d+$/]) {
      await expect(
        page.getByRole('button', { name }),
        `Tab Máy đang dùng phải có nút "${name}"`,
      ).toHaveCount(1);
    }
    /*
     * CHỜ DÒNG GHẾ TRƯỚC, ĐỌC CỘT SAU.
     *
     * ĐÃ ĐO (lượt chạy 10/09): đọc cột ngay sau khi bấm tab thì nhận về MẢNG RỖNG — lúc đó
     * panel còn đang hỏi danh sách ghế và chưa vẽ bảng nào. `allTextContents()` là một lượt
     * đọc MỘT LẦN, không chờ lại như `expect`, nên nó chụp đúng khoảnh khắc trống ấy. Một
     * khẳng định biết chờ phải đứng trước nó.
     */
    await expect(
      page.getByRole('row', { name: new RegExp(deviceCode) }),
      'Máy đã gán phải nằm trong bảng ghế',
    ).toBeVisible();
    expect(
      await columnTexts(page),
      'Bảng ghế license phải có đủ 5 cột này — mất cột Chi phí hay Hợp đồng là mất chỗ đối chiếu lúc quyết toán',
    ).toEqual(['Máy', 'Chi phí', 'Kỳ hạn', 'Hợp đồng · Ghi chú', 'Thao tác']);

    // ===== TAB KÉT SẮT =====
    await page.getByRole('tab', { name: /^Két sắt/ }).click();
    await expect(
      page.getByText(/Nơi cất mật khẩu và license key/),
      'Tab Két sắt phải nói ngay nó là gì — key KHÔNG nằm trong hồ sơ phần mềm',
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Cất mật khẩu/khóa', exact: true }),
      'SA phải cất được secret ngay tại hồ sơ',
    ).toHaveCount(1);
    await expect(
      page.getByText('Két chưa có ngăn nào'),
      'Két rỗng phải nói là rỗng, không phải bảng trắng',
    ).toBeVisible();

    // ===== TAB GIẤY TỜ =====
    await page.getByRole('tab', { name: /^Giấy tờ/ }).click();
    await expect(
      page.getByText('Chưa có giấy tờ nào.'),
      'Khu giấy tờ chưa có gì phải nói rõ',
    ).toBeVisible();

    // ===== TAB LỊCH SỬ =====
    await page.getByRole('tab', { name: /^Lịch sử/ }).click();
    // Bám vào KHU lịch sử: chữ "Gia hạn" còn nằm trên nút đầu trang, tìm toàn trang là trúng hai chỗ.
    const history = page.getByLabel('Lịch sử');
    await expect(
      history.getByText('Tạo hồ sơ'),
      'Lịch sử phải ghi lại việc hồ sơ được tạo — không có dòng đó thì sổ bắt đầu từ hư không',
    ).toBeVisible();
    await expect(
      history.getByText('Gán license vào máy'),
      'Lịch sử phải ghi lại việc gán ghế, và ghi bằng tiếng Việt chứ không phải mã thô',
    ).toBeVisible();

    /*
     * ===== CHIỀU NGƯỢC: hồ sơ KHÔNG phải license thì không có tab "Máy đang dùng" =====
     *
     * Thiếu vế này thì một bản sửa thô bạo (luôn vẽ tab đó) vẫn xanh ở trên.
     */
    await page.goto(`/software/${domainId}`);
    await expect(
      page.getByRole('heading', { level: 1, name: new RegExp(domainCode) }),
    ).toBeVisible();
    expect(
      await tabNames(),
      'Tên miền không có ghế nào để gán — thanh tab phải thiếu đúng tab "Máy đang dùng"',
    ).toEqual(['Hồ sơ', 'Két sắt', 'Giấy tờ', 'Lịch sử']);
  });

  /*
   * ===================================================================================
   * BÀI 5 — PHÒNG SẮP HẾT HẠN, TAB "DANH SÁCH".
   * ===================================================================================
   *
   * VÌ SAO BÀI NÀY TỒN TẠI
   *
   * `expiry.spec.ts` chứng minh cỗ máy gom đúng nguồn và lọc đúng loại. Nhưng danh sách LOẠI
   * và danh sách CỬA SỔ NGÀY là hai ô người dùng nhìn thấy đầu tiên, và chưa ai chốt chúng
   * đầy đủ: một nguồn hạn quên đăng ký thì bộ lọc thiếu một mục, danh sách vẫn hiện bình
   * thường, và cả hệ thống lặng lẽ ngừng cảnh báo một loại tài sản.
   *
   * Cột "Thao tác" của màn này cũng có một luật ẩn: nguồn nào khai `renew` thì có NÚT "Gia
   * hạn", nguồn nào không thì chỉ có chữ mờ "Không gia hạn tại đây" — bảo hành do nhà cung cấp
   * quyết, không phải thứ bấm một nút là xong.
   *
   * ĐỎ KHI: một nguồn hạn biến khỏi bộ lọc; danh sách cửa sổ ngày đổi; bảng đổi cột; một dòng
   * gia hạn được lại hiện chữ mờ (hoặc ngược lại, bảo hành mọc ra nút gia hạn để bấm vào rồi
   * ăn lỗi 400); hoặc hộp Gia hạn mất ô ngày / mất câu chặn khi chưa chọn ngày.
   */
  test('Phòng Sắp hết hạn — tab Danh sách: bộ lọc, bảng, và nút Gia hạn chỉ ở nơi gia hạn được', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await firstLogin(page, E2E_SA);

    const stamp = stampOf();
    const licenseCode = `HAN-E2E-${stamp}-LIC`;
    const deviceCode = `PC-E2E-HAN-${stamp}`;

    /** Ngày cách hôm nay N ngày theo GIỜ ĐỊA PHƯƠNG — `toISOString()` lệch một ngày lúc sáng sớm. */
    const inDays = (days: number): string => {
      const date = new Date();
      date.setDate(date.getDate() + days);
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${date.getFullYear()}-${month}-${day}`;
    };

    await createSoftware(page, {
      code: licenseCode,
      name: 'License sắp hết hạn',
      kind: 'license',
      seatTotal: 3,
      endDate: inDays(12),
    });

    // Máy còn hạn bảo hành — nguồn hạn KHÔNG gia hạn được, là vế đối chứng của cột Thao tác.
    await createDevice(page, deviceCode, { warrantyEnd: inDays(12) });

    await page.goto('/expiry');
    await expect(page.getByRole('heading', { level: 1, name: /^Sắp hết hạn$/ })).toBeVisible();

    // ===== HAI TAB CỦA PHÒNG =====
    expect(
      (await page.getByRole('tab').allInnerTexts()).map((text) => text.trim()),
      'Phòng Sắp hết hạn có đúng ba tab',
    ).toEqual(['Danh sách', 'Đã gia hạn', 'Luật gửi báo cáo']);

    /*
     * ===== BA CON SỐ NGƯỜI TA NHÌN ĐẦU TIÊN MỖI SÁNG =====
     *
     * Dựng lại 17/09/2026: ba cái pill 11px "Đã quá hạn: 4" thành ba Ô SỐ — số to đứng trước,
     * nhãn nhỏ bên dưới — và mỗi ô là một NÚT LỌC. Bài kiểm đổi theo, nhưng giữ đúng câu hỏi
     * cũ ("ba con số ấy có mặt không") và siết thêm một vế: chúng phải bấm được, và phải khai
     * `aria-pressed` để trình đọc màn hình biết đây là nút bật/tắt chứ không phải nút lệnh.
     */
    for (const label of ['Đã quá hạn', 'Gấp \\(≤7 ngày\\)', 'Sắp tới \\(≤30 ngày\\)']) {
      const o = page.getByRole('button', { name: new RegExp(`\\d+\\s*${label}`) });
      await expect(o, `Dải tóm tắt phải có con số "${label}"`).toHaveCount(1);
      await expect(
        o,
        `Ô số "${label}" phải là nút lọc bật/tắt — con số mà không bấm được thì biết rồi vẫn phải tự dò trong bảng`,
      ).toHaveAttribute('aria-pressed', 'false');
    }

    await expect(
      page.getByRole('button', { name: 'Xuất Excel', exact: true }),
      'Màn cảnh báo hạn phải xuất được đúng cái đang xem (FR-028)',
    ).toHaveCount(1);

    // ===== Ô CHỌN CỬA SỔ NGÀY =====
    await page.getByRole('button', { name: 'Khoảng thời gian', exact: true }).click();
    expect(
      (await page.getByRole('option').allInnerTexts()).map((text) => text.trim()),
      'Sáu mốc cửa sổ ngày — không cho gõ số tùy ý, nhưng cũng không được thiếu mốc nào',
    ).toEqual([
      'Quá hạn + 7 ngày tới',
      'Quá hạn + 30 ngày tới',
      'Quá hạn + 60 ngày tới',
      'Quá hạn + 90 ngày tới',
      'Quá hạn + 180 ngày tới',
      'Quá hạn + 365 ngày tới',
    ]);
    await page.getByRole('option', { name: 'Quá hạn + 30 ngày tới', exact: true }).click();

    /*
     * ===== Ô CHỌN LOẠI =====
     *
     * Thứ tự do thứ tự đăng ký nguồn quyết định (AD-7) nên so TẬP chứ không so thứ tự — sắp
     * cả hai vế bằng cùng một phép sắp rồi mới so.
     */
    // Loại là nhóm nút bật/tắt chọn NHIỀU loại cùng lúc (EX-010), không còn là ô chọn một.
    const kindGroup = page.getByRole('group', { name: 'Loại', exact: true });
    const kindOptions = (await kindGroup.getByRole('button').allInnerTexts()).map((text) =>
      text.trim(),
    );
    expect(
      [...kindOptions].sort(),
      'Bộ lọc loại phải bày đủ 6 nguồn hạn đang đăng ký (cả "Khác" — Q-14), cộng mục "tất cả" — đường truyền không có hạn (Q-04)',
    ).toEqual(
      [
        'Tất cả loại',
        'License phần mềm',
        'Chứng chỉ SSL',
        'Tên miền',
        'Hợp đồng bảo trì',
        'Khác',
        'Bảo hành thiết bị',
      ].sort(),
    );
    await expect(
      kindGroup.getByRole('button', { name: 'Tất cả loại', exact: true }),
      'Chưa chọn loại nào thì nút "Tất cả loại" đang bật',
    ).toHaveAttribute('aria-pressed', 'true');

    // ===== BẢNG (chờ dòng có thật rồi mới đọc cột — đọc cột không biết chờ lại) =====
    const licenseRow = page.getByRole('row', { name: new RegExp(licenseCode) });
    await expect(licenseRow, 'License sắp hết hạn phải có mặt trong cửa sổ 30 ngày').toBeVisible();
    expect(
      await columnTexts(page),
      'Bảng sắp hết hạn có đúng 5 cột này (cộng cột ô chọn để gia hạn theo lô)',
    ).toEqual(['', 'Mục', 'Loại', 'Hết hạn', 'Tình trạng', 'Thao tác']);

    // ===== CỘT THAO TÁC: nút hay chữ mờ, tùy nguồn có gia hạn được không =====
    await expect(
      licenseRow.getByRole('button', { name: 'Gia hạn', exact: true }),
      'License gia hạn được ngay tại đây — module chủ có hàm renew',
    ).toHaveCount(1);
    await expect(
      licenseRow.getByRole('link', { name: 'Mở hồ sơ →' }),
      'Dòng gia hạn được thì KHÔNG kèm lối "Mở hồ sơ →" ở cột Thao tác',
    ).toHaveCount(0);

    const warrantyRow = page.getByRole('row', { name: new RegExp(deviceCode) });
    await expect(warrantyRow, 'Bảo hành sắp hết cũng phải có mặt').toBeVisible();
    await expect(
      warrantyRow.getByRole('link', { name: 'Mở hồ sơ →' }),
      'Bảo hành do nhà cung cấp quyết — cho lối sang hồ sơ để sửa ngày, không để nút chết',
    ).toHaveCount(1);
    await expect(
      warrantyRow.getByRole('button', { name: 'Gia hạn', exact: true }),
      'Không được bày nút gia hạn cho bảo hành: bấm vào là ăn lỗi EXPIRY_NOT_RENEWABLE',
    ).toHaveCount(0);

    // ===== BÊN TRONG HỘP "GIA HẠN" =====
    await licenseRow.getByRole('button', { name: 'Gia hạn', exact: true }).click();
    const renew = page.getByRole('dialog', { name: new RegExp(`^Gia hạn ${licenseCode}`) });
    await expect(renew, 'Hộp gia hạn phải nói rõ đang gia hạn mục nào').toBeVisible();

    await expect(
      renew.getByRole('textbox'),
      'Hộp gia hạn KHÔNG có ô gõ chữ nào — hạn mới phải chọn trên lịch để khỏi gõ sai định dạng',
    ).toHaveCount(0);
    await expect(
      renew.getByRole('button'),
      'Hộp gia hạn có đúng 9 nút: ✕ · năm nút chọn nhanh · ô ngày Hạn mới · Hủy · Gia hạn',
    ).toHaveCount(9);
    for (const name of [
      'Đóng hộp thoại',
      '+1 tháng',
      '+6 tháng',
      '+1 năm',
      '+2 năm',
      '+3 năm',
      'Hạn mới',
      'Hủy',
      'Gia hạn',
    ]) {
      await expect(
        renew.getByRole('button', { name, exact: true }),
        `Hộp gia hạn phải có đúng một nút "${name}"`,
      ).toHaveCount(1);
    }

    await renew.getByTestId('dialog-footer').getByRole('button', { name: 'Gia hạn' }).click();
    await expect(
      renew.getByRole('alert'),
      'Bấm gia hạn mà chưa chọn ngày phải nói đúng câu trong vi.ts',
    ).toHaveText('Chọn hạn mới.');
    await expect(renew, 'Gia hạn hỏng thì hộp phải ở lại').toBeVisible();

    await renew.getByRole('button', { name: 'Đóng hộp thoại' }).click();
    await expect(renew, 'Đóng hộp gia hạn mà không đổi hạn của ai').toHaveCount(0);
  });

  /*
   * ===================================================================================
   * BÀI 6 — PHÒNG SẮP HẾT HẠN, TAB "LUẬT GỬI BÁO CÁO", và bên trong hộp "Thêm luật".
   * ===================================================================================
   *
   * VÌ SAO BÀI NÀY TỒN TẠI
   *
   * `expiry-digest.spec.ts` chứng minh email đi đúng và luật lọc đúng loại — nhưng nó chỉ
   * điền hai ô rồi bấm Lưu. Form luật có SÁU ô, trong đó ba ô quyết định "gửi lúc nào" nằm
   * trong `SchedulePicker` dùng chung và tự đổi hình theo tần suất (hằng tuần thì có "Vào
   * thứ", hằng tháng thì có "Ngày trong tháng"). Ô tick loại thì dựng từ danh sách nguồn hạn
   * — thiếu một ô tick là một loại tài sản không bao giờ vào được email tổng hợp.
   *
   * ĐỎ KHI: bảng luật đổi cột; menu ba chấm của dòng luật mất mục nào (đặc biệt "Gửi thử" —
   * không có nó thì cấu hình xong phải chờ tới thứ Hai mới biết đúng sai); form mất một ô;
   * `SchedulePicker` không đổi hình theo tần suất; hai câu chặn tiếng Việt đổi; hoặc form
   * Sửa luật mở ra không mang cấu hình cũ (bấm Lưu là ghi đè sạch danh sách người nhận).
   */
  test('Phòng Sắp hết hạn — tab Luật gửi báo cáo, và bên trong hộp "Thêm luật"', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await firstLogin(page, E2E_SA);

    const stamp = stampOf();
    const ruleName = `E2E luật phòng ${stamp}`;

    const created = await page.request.post('/api/v1/expiry/rules', {
      headers: await writeHeaders(page),
      data: {
        name: ruleName,
        kinds: ['ssl'],
        withinDays: 45,
        recipients: ['sep@pmh.com.vn'],
        frequency: 'weekly',
        hour: 8,
        weekday: 1,
        active: true,
      },
    });
    expect(created.status(), 'tạo luật gửi báo cáo qua API phải thành công').toBe(201);

    await page.goto('/expiry');
    await page.getByRole('tab', { name: 'Luật gửi báo cáo' }).click();

    await expect(
      page.getByRole('button', { name: 'Thêm luật', exact: true }),
      'SA phải thêm được luật ngay tại tab này',
    ).toHaveCount(1);

    // Chờ dòng luật có thật rồi mới đọc cột — phép đọc cột không biết chờ lại.
    await expect(
      page.getByRole('row', { name: new RegExp(ruleName) }),
      'Luật vừa tạo phải hiện trong bảng',
    ).toBeVisible();
    expect(
      await columnTexts(page),
      'Bảng luật gửi báo cáo có đúng 7 cột này',
    ).toEqual([
      'Tên luật',
      'Theo dõi loại',
      'Kỳ gửi',
      // Lần gửi kế tiếp tính sẵn (EX-021): người đọc không phải tự cộng lịch trong đầu.
      'Lần gửi tới',
      'Người nhận',
      'Gửi gần nhất',
      'Thao tác',
    ]);

    expect(
      await rowActionNames(page, ruleName),
      'Menu của một dòng luật: Sửa luật · Tạm ngưng · Xem trước thư · Gửi thử cho tôi · Gửi thử · Xóa (việc nguy hiểm xếp cuối)',
    ).toEqual(['Sửa luật', 'Tạm ngưng', 'Xem trước thư', 'Gửi thử cho tôi', 'Gửi thử', 'Xóa']);

    /*
     * "GỬI THỬ" PHẢI HỎI LẠI, VÀ CÂU HỎI PHẢI NÊU ĐÍCH DANH NGƯỜI NHẬN (rà UI/UX #19).
     *
     * Chữ "thử" đọc ra như gửi vào đâu đó an toàn. Nó không: lượt này bắn email THẬT tới đúng
     * danh sách người nhận của luật — ở đây là `sep@pmh.com.vn` — và thư đã đi thì không thu
     * lại được. Đây là chỗ hiếm hoi phải hỏi lại dù thao tác không ghi gì xuống DB.
     *
     * Vế chốt là HỘP THƯ: bấm Hủy xong mà Mailpit vẫn nhận thêm thư thì câu hỏi lại chỉ là
     * trang trí — hộp hiện lên trong khi lượt gửi đã chạy ở phía sau.
     */
    const thuTruoc = (await mailpitMessages()).length;
    // Khớp nguyên văn: menu còn có "Gửi thử cho tôi" (EX-021), đây là bản gửi cả danh sách.
    await rowAction(page, ruleName, /^Gửi thử$/);
    await expect(
      page.getByRole('dialog').getByText(/sep@pmh\.com\.vn/),
      'câu hỏi phải nói THẲNG thư sẽ tới hộp nào — đó mới là thứ giúp người ta dừng đúng lúc',
    ).toBeVisible();

    await page.getByTestId('dialog-footer').getByRole('button').first().click();
    await expect(page.getByRole('dialog'), 'bấm Hủy thì hộp phải đóng').toHaveCount(0);
    expect(
      (await mailpitMessages()).length,
      'bấm Hủy mà hộp thư vẫn nhận thêm thư nghĩa là câu hỏi lại chỉ để trang trí',
    ).toBe(thuTruoc);

    // ===== BÊN TRONG HỘP "THÊM LUẬT" =====
    await page.getByRole('button', { name: 'Thêm luật', exact: true }).click();
    const add = page.getByRole('dialog', { name: 'Thêm luật' });
    await expect(add).toBeVisible();

    await expect(
      add.getByRole('textbox'),
      'Form luật có đúng 3 ô gõ chữ: Tên luật · Trong vòng (ngày) · Người nhận',
    ).toHaveCount(3);
    for (const name of ['Tên luật', 'Trong vòng (ngày)', 'Người nhận']) {
      await expect(
        add.getByRole('textbox', { name, exact: true }),
        `Form luật phải có đúng một ô "${name}"`,
      ).toHaveCount(1);
    }

    /*
     * Ô tick loại + ô tick "đang chạy". Ô "đang chạy" mang tên gọi là chính CÂU GỢI Ý bên
     * cạnh nó (`<label>` bọc cả hai), nên nó nằm cùng phép đếm này.
     */
    await expect(
      add.getByRole('checkbox'),
      'Sáu ô tick loại (đúng bằng số nguồn hạn) cộng một ô tick "đang chạy"',
    ).toHaveCount(7);
    for (const label of [
      'License phần mềm',
      'Chứng chỉ SSL',
      'Tên miền',
      'Hợp đồng bảo trì',
      'Khác',
      'Bảo hành thiết bị',
      'Bỏ tick để tạm ngưng mà không mất cấu hình.',
    ]) {
      await expect(
        add.getByRole('checkbox', { name: label, exact: true }),
        `Form luật phải có đúng một ô tick "${label}"`,
      ).toHaveCount(1);
    }

    // ===== BỘ CHỌN LỊCH DÙNG CHUNG =====
    await expect(
      add.getByRole('group', { name: 'Lịch gửi' }),
      'Kỳ gửi phải là bộ chọn lịch dùng chung (AD-15), không phải ô ngày tự dựng',
    ).toHaveCount(1);
    // Ô chọn lịch là `Select` chung (nút mở menu), không còn `<select>` gốc của trình duyệt.
    await expect(add.getByRole('combobox'), 'Không còn <select> gốc trong bộ chọn lịch').toHaveCount(0);
    for (const name of ['Tần suất', 'Vào thứ', 'Lúc']) {
      await expect(
        add.getByRole('button', { name, exact: true }),
        `Bộ chọn lịch ở chế độ hằng tuần phải có ô "${name}"`,
      ).toHaveCount(1);
    }

    // Đổi sang hằng tháng thì bộ chọn phải ĐỔI HÌNH — "Vào thứ" vô nghĩa với luật hằng tháng.
    await add.getByRole('button', { name: 'Tần suất', exact: true }).click();
    await page.getByRole('option', { name: 'Hằng tháng', exact: true }).click();
    await expect(
      add.getByRole('button', { name: 'Vào thứ', exact: true }),
      'Hằng tháng thì không hỏi thứ mấy nữa',
    ).toHaveCount(0);
    await expect(
      add.getByRole('button', { name: 'Ngày trong tháng', exact: true }),
      'Hằng tháng thì phải hỏi ngày nào trong tháng',
    ).toHaveCount(1);

    // Ba ô chọn lịch giờ là `Select` chung — cũng là nút (EX-019).
    await expect(
      add.getByRole('button'),
      'Hộp thêm luật (hằng tháng) có đúng 6 nút: ✕ · Tần suất · Ngày trong tháng · Lúc · Hủy · Lưu',
    ).toHaveCount(6);
    for (const name of ['Đóng hộp thoại', 'Tần suất', 'Ngày trong tháng', 'Lúc', 'Hủy', 'Lưu']) {
      await expect(add.getByRole('button', { name, exact: true })).toHaveCount(1);
    }

    // ===== HAI ĐƯỜNG HỎNG =====
    const save = add.getByTestId('dialog-footer').getByRole('button', { name: 'Lưu' });

    // Mỗi câu lỗi nằm DƯỚI đúng ô của nó (SW-024) — form `noValidate`, không còn bong bóng.
    await add.getByRole('textbox', { name: 'Tên luật', exact: true }).fill('   ');
    await save.click();
    await expect(
      add.getByRole('textbox', { name: 'Tên luật', exact: true }),
      'Luật không tên thì sau này không ai biết nó là luật gì — báo đúng câu trong vi.ts',
    ).toHaveAccessibleDescription('Đặt tên cho luật này (vd "SSL sắp hết hạn → sếp").');

    await add.getByRole('textbox', { name: 'Tên luật', exact: true }).fill(`E2E luật hỏng ${stamp}`);
    await add.getByRole('textbox', { name: 'Người nhận', exact: true }).fill('   ');
    await save.click();
    await expect(
      add.getByRole('alert'),
      'Luật không người nhận là một cái đồng hồ chạy mà không đổ chuông',
    ).toHaveText('Nhập ít nhất một email người nhận.');
    await expect(add, 'Lưu hỏng thì hộp phải ở lại').toBeVisible();

    /*
     * Form đã gõ hai ô, nên từ 12/09 Esc HỎI LẠI thay vì đóng thẳng (`Dialog guardUnsaved`,
     * rà UI/UX #10). Phải trả lời xong mới đóng — bỏ bước này thì hộp hỏi lại đứng chắn giữa
     * màn và mọi cú bấm sau đó trong bài đều treo.
     */
    await page.keyboard.press('Escape');
    await confirmAction(page, 'Bỏ và đóng');
    await expect(add, 'trả lời "Bỏ và đóng" rồi thì hộp thêm luật phải đóng').toHaveCount(0);

    // ===== HỘP "SỬA LUẬT" PHẢI MANG CẤU HÌNH CŨ VÀO =====
    await rowAction(page, ruleName, 'Sửa luật');
    const edit = page.getByRole('dialog', { name: 'Sửa luật' });
    await expect(edit).toBeVisible();

    await expect(
      edit.getByRole('textbox', { name: 'Tên luật', exact: true }),
      'Tên luật cũ phải nằm sẵn trong ô',
    ).toHaveValue(ruleName);
    await expect(
      edit.getByRole('textbox', { name: 'Người nhận', exact: true }),
      'Danh sách người nhận cũ phải nằm sẵn trong ô — mở ra trống là bấm Lưu một phát mất hết',
    ).toHaveValue('sep@pmh.com.vn');
    await expect(
      edit.getByRole('textbox', { name: 'Trong vòng (ngày)', exact: true }),
      'Số ngày cũ phải nằm sẵn trong ô',
    ).toHaveValue('45');
    await expect(
      edit.getByRole('checkbox', { name: 'Chứng chỉ SSL', exact: true }),
      'Loại đang theo dõi phải được tick sẵn',
    ).toBeChecked();
    await expect(
      edit.getByRole('checkbox', { name: 'License phần mềm', exact: true }),
      'Loại KHÔNG theo dõi thì không được tự tick — tick nhầm là luật đổi phạm vi mà không ai biết',
    ).not.toBeChecked();
    await expect(
      edit.getByRole('button', { name: 'Tần suất', exact: true }),
      'Tần suất cũ phải nằm sẵn trong ô chọn',
    ).toContainText('Hằng tuần');

    await edit.getByRole('button', { name: 'Đóng hộp thoại' }).click();
    await expect(edit, 'Đóng hộp sửa luật mà không đổi luật của ai').toHaveCount(0);
  });

  /*
   * ===================================================================================
   * BÀI 7 — LỖI THẬT VỪA TÌM ĐƯỢC, GHI LẠI Ở DẠNG `fixme` CHỨ KHÔNG SỬA BÀI ĐỂ NÉ.
   * ===================================================================================
   *
   * TRIỆU CHỨNG ĐÃ ĐO (lượt chạy 10/09, ảnh chụp trạng thái của bài "hộp Gán vào máy"):
   * mở thẳng `/software/<id>?tab=devices` của một license CÓ ghế thì trang dừng ở tab "Hồ
   * sơ". Thanh tab vẫn hiện đủ "Máy đang dùng 1", nhưng tab được chọn là "Hồ sơ".
   *
   * NGUYÊN NHÂN (đọc `web/src/ui/tabs.tsx` + `software-detail.tsx` sau khi thấy ảnh chụp):
   * `initialTab` đọc `?tab=devices` đúng, nhưng `useVisibleTab` chạy ngay từ lượt render ĐẦU
   * — lúc `software.data` còn `undefined`. Tab "Máy đang dùng" chỉ được ghép vào `tabItems`
   * khi đã biết hồ sơ là license, nên ở lượt đó danh sách hợp lệ chỉ có bốn khóa và
   * `useVisibleTab` kẹp về `profile`, gọi `setTab('profile')`. Dữ liệu về sau đó không kéo
   * lại được: `tab` đã bị ghi đè.
   *
   * VÌ SAO ĐÁNG VÁ CHỨ KHÔNG ĐÁNG LÀM NGƠ: đây là đường dẫn người ta DÁN CHO NHAU ("ghế
   * license nằm ở đây") và tự trang này sinh ra khi bấm tab. Nó im lặng đưa người nhận tới
   * một tab khác — không báo lỗi, không có dấu hiệu nào. Cùng một cơ chế sẽ đánh trượt
   * `?tab=ports` của hồ sơ thiết bị, vì tab đó cũng chỉ mọc theo dữ liệu.
   *
   * HƯỚNG VÁ (gợi ý, không phải phần việc của bài kiểm): `useVisibleTab` chỉ được kẹp khi
   * danh sách tab đã CHỐT — truyền thêm cờ "đã tải xong" và bỏ qua hiệu ứng lúc còn đang tải.
   *
   * ĐÃ VÁ 19/09/2026, `fixme` GỠ CÙNG NGÀY. Bản vá đi theo hướng trên nhưng gọn hơn: thay vì
   * thêm cờ, giữ luôn tab mọc-theo-dữ-liệu trong danh sách KHI TRUY VẤN CÒN ĐANG TẢI —
   * `software-detail.tsx` (`software.isPending || …`) và `device-detail.tsx`
   * (`… || ports.isPending`). Danh sách khi ấy không bao giờ thiếu khóa ở lượt render đầu, nên
   * `useVisibleTab` không có gì để kẹp.
   *
   * BÀI NÀY TỪNG LÀ BÀI DUY NHẤT BỊ BỎ QUA trong cả 440 bài của bộ E2E — và nó cũng là bài duy
   * nhất chứng minh bản vá kia chạy. Suốt năm lượt chạy đầy đủ, dòng tổng kết "439 passed,
   * 1 skipped" ĐÃ nói ra chuyện đó; chỉ là không ai hỏi "bài nào?". Một bài `fixme` mà không ai
   * đọc tên thì không khác gì một bài không tồn tại.
   */
  test(
    'Link sâu ?tab=devices phải mở đúng tab "Máy đang dùng", không rơi về tab Hồ sơ',
    async ({ page }) => {
      test.setTimeout(150_000);
      await firstLogin(page, E2E_SA);

      const stamp = stampOf();
      const licenseCode = `LINK-E2E-${stamp}-LIC`;
      const licenseId = await createSoftware(page, {
        code: licenseCode,
        name: 'License để thử link sâu',
        kind: 'license',
        seatTotal: 2,
        endDate: '2028-12-31',
      });

      await page.goto(`/software/${licenseId}?tab=devices`);
      await expect(
        page.getByRole('heading', { level: 1, name: new RegExp(licenseCode) }),
      ).toBeVisible();

      await expect(
        page.getByRole('tab', { name: /^Máy đang dùng/ }),
        'Tab "Máy đang dùng" phải là tab ĐANG CHỌN khi link chỉ đích danh nó',
      ).toHaveAttribute('aria-selected', 'true');
      await expect(
        page.getByRole('tabpanel'),
        'Và vùng nội dung phải là của chính tab đó',
      ).toHaveAccessibleName(/^Máy đang dùng/);
    },
  );
});

test.describe('Phòng Địa chỉ IP và phòng Sổ NAT — bên trong có gì', () => {
  test.beforeEach(() => {
    resetUsers();
    resetIpam();
    resetDevices();
    resetCatalog();
  });

  /*
   * ===== VÌ SAO CẢ KHỐI NÀY TỒN TẠI =====
   *
   * Bốn spec cũ (`ipam.spec.ts`, `ipam-nat-redesign.spec.ts`, `nat.spec.ts`,
   * `ip-lifecycle.spec.ts`) kiểm rất kỹ NGHIỆP VỤ của hai màn này: cấp trùng IP bị chặn, dải
   * gõ sai được giải thích tử tế, ba chip port ra ba dòng, hai rule chồng port bị chặn. Nhưng
   * chúng luôn đi vào phòng để LÀM MỘT VIỆC, nên chúng chỉ chạm đúng những tay nắm cần cho
   * việc ấy.
   *
   * Kết quả là cả một lớp hỏng không ai bắt được: một mục biến mất khỏi menu ba chấm, một ô
   * lặng lẽ rơi khỏi hộp thoại, một cột mất khỏi bảng, một nút mọc thêm ra ở đầu trang. Không
   * bài nào đỏ — bài cũ chỉ hỏi "thứ tôi cần có ở đó không", không bao giờ hỏi "trong phòng
   * này CÓ ĐÚNG những gì".
   *
   * Nên mọi khẳng định ở đây là SO TẬP HỢP. Tập hợp bắt được cả thứ THIẾU lẫn thứ THỪA;
   * `toBeVisible()` từng cái thì chỉ bắt được một nửa.
   *
   * ===== HAI CÁI BẪY ĐÃ TRẢ GIÁ (lượt chạy 1, bốn bài đỏ) =====
   *
   * 1. `allTextContents()` KHÔNG chờ. Nó chụp DOM đúng một lần, ngay lúc gọi. Gọi nó ngay sau
   *    `page.goto()` là chụp một trang chưa vẽ xong và nhận về `[]` — ba bài đỏ vì đúng chuyện
   *    đó, trong khi ảnh chụp lúc đỏ cho thấy màn hình có ĐÚNG thứ bài kiểm chờ. Nên mọi phép
   *    so tập ở đây đi qua `expect(locator).toHaveText([...])`: nó vẫn so ĐỦ BỘ (mảng, không
   *    phải `toContainText`), nhưng có thử lại cho tới khi trang lắng xuống.
   *
   * 2. MÁY CHẠY TEST KHÔNG CÓ DB TRẮNG. `resetIpam()` chỉ xóa dải có TÊN chứa "E2E"; máy này
   *    còn một dải thật `172.16.15.0/24` tên "TT2" (đã vô hiệu hóa, còn 1 hồ sơ IP mang lịch
   *    sử) nằm ngoài tầm với của nó. Nghĩa là màn Địa chỉ IP KHÔNG BAO GIỜ rỗng, và mọi câu
   *    hỏi kiểu "cả trang có đúng ngần này thứ" phải hoặc đếm phần dữ liệu lạ tại chỗ, hoặc
   *    thu hẹp về đúng thẻ/dòng của chính bài này. Bài kiểm đi mượn dữ liệu của người khác là
   *    bài kiểm sẽ im lặng bỏ đi vào một ngày nào đó.
   */

  /** Thoát ký tự regex — địa chỉ IP và CIDR đầy dấu chấm, để trần là khớp bừa. */
  function esc(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Khẳng định `scope` có ĐÚNG bộ tay nắm mang vai `role` này — không thừa, không thiếu.
   *
   * Hai vế phải đi cùng nhau: `toHaveCount` bắt thứ THỪA ra (một ô mới mọc thêm mà không ai
   * khai), vòng lặp bắt thứ THIẾU đi (một ô rơi khỏi form, và từ đó không ai nhập được nó
   * nữa mà chẳng có gì đỏ lên). Cả hai đều là `expect` nên đều có thử lại.
   */
  async function expectHandles(
    scope: Locator,
    role: 'textbox' | 'button' | 'combobox' | 'checkbox',
    names: (string | RegExp)[],
    what: string,
  ): Promise<void> {
    await expect(
      scope.getByRole(role),
      `${what}: phải có đúng ${names.length} tay nắm vai "${role}" — thừa một cái là có thứ vừa mọc thêm, thiếu một cái là có thứ vừa biến mất`,
    ).toHaveCount(names.length);
    for (const name of names) {
      await expect(
        scope.getByRole(role, { name, exact: true }),
        `${what}: phải có đúng một "${String(name)}" mang vai "${role}"`,
      ).toHaveCount(1);
    }
  }

  /**
   * Như trên, nhưng cho phép MỘT TÊN xuất hiện nhiều lần ("Cấp IP này" có mặt ở mọi ô trống).
   *
   * Dùng khi cần so đủ bộ trên một vùng rộng: tổng số bắt thứ thừa, từng con số bắt thứ thiếu.
   */
  async function expectHandleCounts(
    scope: Locator,
    role: 'button',
    expected: [string | RegExp, number][],
    what: string,
  ): Promise<void> {
    const total = expected.reduce((sum, [, times]) => sum + times, 0);
    await expect(
      scope.getByRole(role),
      `${what}: phải có đúng ${total} nút — thừa một cái là có thứ vừa mọc thêm mà không ai khai`,
    ).toHaveCount(total);
    for (const [name, times] of expected) {
      await expect(
        scope.getByRole(role, { name, exact: true }),
        `${what}: "${String(name)}" phải xuất hiện đúng ${times} lần`,
      ).toHaveCount(times);
    }
  }

  /** Dòng của một địa chỉ trong bảng IP — neo đầu để `.1` không vớ nhầm `.10`. */
  function ipRow(page: Page, address: string): Locator {
    return page.getByRole('row', { name: new RegExp(`^${esc(address)}\\b`) });
  }

  /** Thẻ dải trong cột trái — thu hẹp về ĐÚNG dải của bài này, vì rail còn dải lạ của máy. */
  function subnetCard(page: Page, cidr: string): Locator {
    return page.getByRole('link', { name: new RegExp(esc(cidr)) });
  }

  /**
   * Octet thứ ba cho dải của một bài. Giữ trong khoảng 20–249 (không đụng `.0`/`.255`) và
   * TRÁNH XA `172.16.15.0/24` — dải thật "TT2" nằm sẵn trên máy chạy test; đụng vào là API
   * từ chối vì chồng dải, và bài đỏ ở một chỗ chẳng liên quan gì tới điều nó đang kiểm.
   */
  function octetFor(stamp: string, shift: number): number {
    return (Number(stamp) % 100) + 20 + shift;
  }

  async function createSubnet(
    page: Page,
    cidr: string,
    name: string,
    extra: Record<string, unknown> = {},
  ): Promise<string> {
    const res = await page.request.post('/api/v1/ipam/subnets', {
      headers: await writeHeaders(page),
      data: { cidr, name, ...extra },
    });
    expect(res.status(), `dàn cảnh: phải khai được dải ${cidr}`).toBe(201);
    return ((await res.json()) as { id: string }).id;
  }

  async function createAddress(
    page: Page,
    subnetId: string,
    address: string,
    usedBy: string,
  ): Promise<string> {
    const res = await page.request.post('/api/v1/ipam/addresses', {
      headers: await writeHeaders(page),
      data: { subnetId, address, usedBy },
    });
    expect(res.status(), `dàn cảnh: phải cấp được hồ sơ IP ${address}`).toBe(201);
    return ((await res.json()) as { id: string }).id;
  }

  interface NatFixture {
    routerId: string;
    routerCode: string;
    internalIp: string;
    siteCode: string;
  }

  /**
   * Dàn cảnh cho phòng NAT: một site, một router, một dải kèm một hồ sơ IP.
   *
   * Site mang mã `E2E-…` vì script dọn lọc site theo `code LIKE 'E2E-%'` — đặt tên khác là
   * để lại rác vĩnh viễn trong danh mục dùng chung.
   */
  async function setUpNat(page: Page, stamp: string, octet: number): Promise<NatFixture> {
    const headers = await writeHeaders(page);
    const catalog = await page.evaluate(async () => {
      const res = await fetch('/api/v1/catalog', { credentials: 'include' });
      return (await res.json()) as { deviceTypes: { id: string; name: string }[] };
    });
    const type = catalog.deviceTypes.find((one) => one.name === 'Firewall');
    if (!type) {
      throw new Error('Danh mục thiếu loại "Firewall" — migration 0011 phải gieo sẵn loại này.');
    }

    const siteCode = `E2E-ST${stamp}`;
    const site = await page.request.post('/api/v1/catalog/site', {
      headers,
      data: { code: siteCode, name: `Site phòng NAT E2E ${stamp}` },
    });
    expect(site.status(), 'dàn cảnh: phải khai được site').toBeLessThan(300);

    const routerCode = `RT-E2E-PHONG-${stamp}`;
    const device = await page.request.post('/api/v1/devices', {
      headers,
      data: { code: routerCode, name: 'Draytek cổng chính', deviceTypeId: type.id },
    });
    expect(device.status(), 'dàn cảnh: phải khai được router').toBe(201);
    const routerId = ((await device.json()) as { device: { id: string } }).device.id;

    const subnetId = await createSubnet(page, `172.16.${octet}.0/29`, `LAN NAT E2E ${stamp}`);
    const internalIp = `172.16.${octet}.5`;
    // KHÔNG gắn thiết bị cho hồ sơ IP này: có thiết bị thì hộp Sửa rule mở ra ở nhánh
    // "đã chọn máy đích" (ô IP thành Select), và bài kiểm hộp Sửa bên dưới soi nhánh gõ tay.
    await createAddress(page, subnetId, internalIp, 'Máy chấm công');

    return { routerId, routerCode, internalIp, siteCode };
  }

  /* ===================== PHÒNG ĐỊA CHỈ IP ===================== */

  /**
   * VÌ SAO BÀI NÀY TỒN TẠI
   *
   * Cột trái của màn Địa chỉ IP là thứ DUY NHẤT trong hệ thống không phải một bảng: nó là một
   * `<nav>` chứa các thẻ dải, mỗi thẻ có menu ba chấm riêng. Và bộ mục trong menu ấy KHÔNG cố
   * định — `SubnetCard` chọn giữa **Xóa** (dải chưa từng có hồ sơ IP nào) và **Vô hiệu hóa**
   * (dải đã mang lịch sử) theo `addressCount`. Đó là một nhánh nghiệp vụ thật, dựa trên AD-13
   * (`ip_history` chỉ-thêm), nhưng nó chỉ tồn tại trong giao diện.
   *
   * ĐỎ KHI: một nút mọc thêm (hoặc rơi mất) ở bất kỳ đâu trên màn, một thẻ dải mất nút ba
   * chấm (từ đó dải ấy hết sửa được), rail mất `aria-label` (người dùng bàn phím hết đường
   * phân biệt nó với thanh điều hướng chính), hoặc hai nhánh Xóa/Vô hiệu hóa bị gộp lại thành
   * một — lúc đó một dải khai nhầm ba giây trước sẽ không xóa nổi, hoặc tệ hơn, một dải đang
   * mang lịch sử lại bày ra nút Xóa để bấm rồi ăn lỗi.
   */
  test('Phòng Địa chỉ IP: nút đầu trang, rail dải, và menu mỗi thẻ đổi theo dải trống hay dải đã dùng', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);
    const octet = octetFor(stamp, 0);
    const emptyCidr = `172.16.${octet}.0/29`;
    const usedCidr = `172.16.${octet + 1}.0/29`;

    const emptyId = await createSubnet(page, emptyCidr, `LAN trống E2E ${stamp}`);
    const usedId = await createSubnet(page, usedCidr, `LAN đã dùng E2E ${stamp}`, { vlan: 30 });
    await createAddress(page, usedId, `172.16.${octet + 1}.1`, 'Chị Lan — Kế toán');

    await page.goto(`/ip-addresses/${emptyId}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Địa chỉ IP' })).toBeVisible();

    /* ----- Rail: mỗi thẻ đúng một link + đúng một nút ba chấm ----- */
    const rail = page.getByRole('navigation', { name: 'Danh sách dải mạng' });
    await expect(
      rail,
      'rail phải là một landmark CÓ TÊN RIÊNG — không thì nó lẫn với thanh điều hướng chính',
    ).toBeVisible();
    await expect(rail.getByRole('heading', { level: 2 })).toHaveText(['Dải mạng / VLAN']);
    await expect(
      rail.getByRole('button', { name: `Thao tác với ${emptyCidr}`, exact: true }),
    ).toHaveCount(1);
    await expect(
      rail.getByRole('button', { name: `Thao tác với ${usedCidr}`, exact: true }),
    ).toHaveCount(1);

    /*
     * Số thẻ trong rail do dữ liệu SẴN CÓ của máy quyết định (dải không mang tên "E2E" thì
     * script dọn không đụng tới — máy này còn dải thật "TT2"). Nên đếm nó tại chỗ, rồi mọi
     * thứ CÒN LẠI trong `main` thì bài này biết chính xác và so đủ bộ.
     */
    const cards = await rail.getByRole('link').count();
    expect(cards, 'ít nhất phải có hai thẻ của chính bài này').toBeGreaterThanOrEqual(2);
    await expect(
      rail.getByRole('button'),
      'mỗi thẻ đúng MỘT nút ba chấm — thẻ nào mất nút là dải đó hết sửa được mà không có gì báo',
    ).toHaveCount(cards);

    /*
     * Cả `main` có ĐÚNG ngần này nút. Dải đang chọn còn trống hoàn toàn (/29 = 6 host) nên
     * phần bảng là con số biết trước: 3 nút lọc + chip "Đã ẩn" (NET-020), 6 nút "Cấp IP", 2 nút
     * lật trang, cặp "Danh sách | Bản đồ" (NET-006) — cộng nút "Tra" của ô tra IP/máy cấp trang,
     * và ở đầu cột phải "Giấy tờ (n)" (NET-016) + "Cấp IP trống kế tiếp" (NET-007).
     */
    await expectHandleCounts(
      page.getByRole('main'),
      'button',
      [
        ['Xuất Excel', 1],
        ['Khai dải mới', 1],
        ['Tra', 1],
        [/^Thao tác với /, cards],
        ['Giấy tờ (0)', 1],
        ['Cấp IP trống kế tiếp', 1],
        ['Tất cả 6', 1],
        ['Đang dùng 0', 1],
        ['Trống 6', 1],
        ['Đã ẩn', 1],
        ['Danh sách', 1],
        ['Bản đồ', 1],
        ['Cấp IP', 6],
        ['Trang trước', 1],
        ['Trang sau', 1],
      ],
      'Màn Địa chỉ IP, dải đang chọn còn trống hoàn toàn',
    );

    /*
     * ĐÂY LÀ ĐIỀU BÀI NÀY TỒN TẠI VÌ NÓ.
     *
     * Dải chưa có hồ sơ nào → **Xóa** hẳn được. Dải đã mang lịch sử → chỉ **Vô hiệu hóa**.
     * Hai bộ mục phải KHÁC NHAU; giống nhau là một trong hai nhánh vừa chết.
     */
    expect(
      await rowActionNames(page, emptyCidr),
      'dải chưa có hồ sơ IP nào thì xóa hẳn được — khai nhầm ba giây trước mà phải sống chung với nó mãi là phiền vô lý',
    ).toEqual(['Sửa', 'Xóa']);
    expect(
      await rowActionNames(page, usedCidr),
      'dải đã mang lịch sử thì KHÔNG có "Xóa" — `ip_history` là bảng chỉ-thêm (AD-13), bày nút ra là bày để bấm rồi ăn lỗi',
    ).toEqual(['Sửa', 'Ngừng dùng']);

    /* ----- Hộp "Khai dải mới": bên trong có đúng những ô nào ----- */
    await page.getByRole('button', { name: 'Khai dải mới' }).click();
    const addForm = page.getByRole('dialog', { name: 'Khai dải mới' });
    await expect(addForm).toBeVisible();
    await expect(
      addForm.getByRole('heading', { level: 2 }),
      'hộp KHAI MỚI không chia khối — chỉ có đúng tiêu đề hộp',
    ).toHaveText(['Khai dải mới']);
    await expectHandles(
      addForm,
      'textbox',
      ['Dải', 'Tên gọi', 'VLAN', 'Gateway', 'Mô tả'],
      'Hộp "Khai dải mới"',
    );
    // Site là `Select` → tay nắm của nó là NÚT, không phải ô nhập. Nhầm vai nghĩa là người
    // dùng bàn phím thao tác khác hẳn điều ta tưởng.
    await expectHandles(
      addForm,
      'button',
      ['Đóng hộp thoại', 'Site', 'Hủy', 'Lưu'],
      'Hộp "Khai dải mới"',
    );
    await expect(
      addForm.getByRole('combobox'),
      'hộp khai dải KHÔNG có ô gõ-để-lọc nào — có nghĩa là một ô vừa đổi kiểu tay nắm',
    ).toHaveCount(0);
    // Khai MỚI thì chưa có id để gắn giấy tờ, nên khu đính kèm phải chưa hiện.
    await expect(
      addForm.getByText('Thêm và xóa giấy tờ ở đây có hiệu lực NGAY', { exact: false }),
    ).toHaveCount(0);

    // Lựa chọn của `Select` PORTAL ra ngoài phần thân hộp — bắt ở cấp trang.
    await addForm.getByRole('button', { name: 'Site', exact: true }).click();
    await expect(
      page.getByRole('option', { name: 'Không gắn site', exact: true }),
      'phải có đường "không gắn site" — không thì mọi dải bị ép thuộc về một site nào đó',
    ).toBeVisible();
    // Esc trong `Select` chỉ đóng menu, KHÔNG được đóng luôn cả hộp thoại.
    await page.keyboard.press('Escape');
    await expect(page.getByRole('option', { name: 'Không gắn site', exact: true })).toHaveCount(0);
    await expect(addForm, 'Esc đóng menu chọn thì hộp thoại phải còn nguyên').toBeVisible();

    await addForm.getByRole('button', { name: 'Đóng hộp thoại' }).click();
    await expect(addForm, 'nút ✕ phải đóng được hộp').toHaveCount(0);
  });

  /**
   * VÌ SAO BÀI NÀY TỒN TẠI
   *
   * Cột phải trả lời hai câu người ta mở màn này ra để hỏi: "IP này của ai" và "còn chỗ nào
   * trống". Câu thứ hai sống trong nhóm nút lọc `role="group"` mang con số đếm của CẢ dải, và
   * trong những dòng "Trống" có nút "Cấp IP này" ngay tại chỗ.
   *
   * `ipam.spec.ts` đã kiểm rằng lọc ra ĐÚNG dòng. Bài này hỏi câu khác: nhóm lọc có ĐÚNG BA
   * lựa chọn ấy không, bảng có ĐÚNG SÁU cột ấy không, và dòng trống có đúng một nút.
   *
   * ĐỎ KHI: một trạng thái rơi khỏi `SLOT_FILTERS` (từ đó không lọc ra được nữa và cũng không
   * ai đếm), một cột biến mất khỏi bảng, ô tick "Hiện cả hồ sơ đã ẩn" không còn gọi lại API
   * kèm `includeVoided=true` (bật lên mà màn hình đứng im), hoặc dòng đã cấp lại mọc ra nút
   * "Cấp IP này" thứ hai.
   */
  test('Pane phải màn Địa chỉ IP: nhóm nút lọc, bảng địa chỉ, ô trống và ô tick hồ sơ đã ẩn', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);
    const octet = octetFor(stamp, 20);
    const cidr = `172.16.${octet}.0/29`;
    const name = `LAN pane E2E ${stamp}`;
    const taken = `172.16.${octet}.1`;
    const free = `172.16.${octet}.2`;

    const subnetId = await createSubnet(page, cidr, name);
    await createAddress(page, subnetId, taken, 'Chị Lan — Kế toán');
    await page.goto(`/ip-addresses/${subnetId}`);

    // Hai tiêu đề cấp hai của cả màn: đầu rail và đầu pane (thẻ dải là LINK, không phải tiêu
    // đề — nên dải lạ của máy không chen vào đây). Nhiều hơn nghĩa là có khối mới mọc ra.
    await expect(page.getByRole('heading', { level: 2 })).toHaveText([
      'Dải mạng / VLAN',
      `${cidr} — ${name}`,
    ]);

    /* ----- Nhóm nút lọc: đúng ba lựa chọn (Q-02), kèm con số của CẢ dải ----- */
    const filters = page.getByRole('group', { name: 'Trạng thái' });
    await expect(
      filters.getByRole('button'),
      '/29 = 6 host; một đã cấp nên còn 5 trống. Con số phải nằm NGAY trên nút, đúng thứ tự SLOT_FILTERS',
      /* "Đã ẩn" đứng thường trực nhưng KHÔNG mang số khi chưa mở: API chỉ trả hồ sơ đã ẩn khi
         được hỏi, nên một con số 0 ở đó là nói sai. */
    ).toHaveText(['Tất cả 6', 'Đang dùng 1', 'Trống 5', 'Đã ẩn']);

    /* ----- Bảng: đúng sáu cột ----- */
    const table = page.getByRole('table');
    await expect(
      table.getByRole('columnheader'),
      'mất một cột ở đây là mất một câu trả lời mà người ta mở màn này ra để tra',
    ).toHaveText([
      'Địa chỉ',
      'Trạng thái',
      'Thiết bị',
      'Người / bộ phận dùng',
      'Ngày cấp',
      'Thao tác',
    ]);
    await expect(table.getByRole('row'), 'một hàng tiêu đề + 6 địa chỉ').toHaveCount(7);

    /* ----- Bấm một lựa chọn thì bảng đổi THẬT, không chỉ đổi màu cái nút ----- */
    await filters.getByRole('button', { name: /^Trống/ }).click();
    await expect(table.getByRole('row'), 'lọc "Trống" còn 5 dòng + tiêu đề').toHaveCount(6);
    await expect(
      page.getByText('Chị Lan — Kế toán'),
      'lọc "Trống" thì hàng đã cấp phải biến khỏi bảng',
    ).toHaveCount(0);

    await filters.getByRole('button', { name: /^Đang dùng/ }).click();
    await expect(
      table.getByRole('row'),
      'lọc "Đang dùng" còn đúng một dòng + tiêu đề, chứ không phải bảng cũ đứng im',
    ).toHaveCount(2);

    await filters.getByRole('button', { name: /^Tất cả/ }).click();
    await expect(table.getByRole('row')).toHaveCount(7);

    /* ----- Ô trống có nút cấp ngay tại chỗ; ô đã cấp thì KHÔNG ----- */
    await expect(
      ipRow(page, free).getByRole('button', { name: 'Cấp IP', exact: true }),
      'ô trống phải cấp được ngay tại dòng — đó là đường ngắn nhất khi đang cắm máy',
    ).toHaveCount(1);
    await expect(
      ipRow(page, taken).getByRole('button', { name: 'Cấp IP', exact: true }),
      'hàng đã có chủ mà vẫn bày nút cấp là mời người ta ghi đè',
    ).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Cấp IP', exact: true })).toHaveCount(5);

    /* ----- Chip hồ sơ đã ẩn: phải HỎI LẠI API, không chỉ lọc trong bộ nhớ ----- */
    const showVoided = filters.getByRole('button', { name: /^Đã ẩn/ });
    await expect(
      showVoided,
      'tắt mặc định — bật sẵn là bày ra thứ người ta vừa cố tình ẩn đi',
    ).toHaveAttribute('aria-pressed', 'false');
    const refetched = page.waitForResponse(
      (res) => res.url().includes('/addresses') && res.url().includes('includeVoided=true'),
    );
    await showVoided.click();
    await refetched;
    await expect(showVoided).toHaveAttribute('aria-pressed', 'true');
    // Không hồ sơ nào đã ẩn: bảng rỗng phải NÓI vì sao rỗng. Về lại "Tất cả" cho phần dưới.
    await expect(page.getByText('Không có dòng nào để hiện.')).toBeVisible();
    await filters.getByRole('button', { name: /^Tất cả/ }).click();

    /* ----- Phân trang: 50 dòng/trang, và nó nói rõ đang xem tới đâu ----- */
    const pager = page.getByRole('navigation', { name: 'Trang' });
    await expect(pager).toBeVisible();
    await expect(
      pager.getByText(/1–6\s+trên\s+6\s+dòng/),
      'con số này tính trên TOÀN bộ lọc đang chọn, không phải trên trang đang xem',
    ).toBeVisible();
  });

  /**
   * VÌ SAO BÀI NÀY TỒN TẠI
   *
   * Hộp "Cấp IP" là cửa duy nhất đưa một địa chỉ vào sổ, và nó có bốn ô mang bốn kiểu tay nắm
   * KHÁC NHAU: một giá trị cố định (địa chỉ), hai ô gõ-để-lọc (`Combobox` / `SuggestInput`,
   * đều `role="combobox"` chứ không phải `textbox`), một nút mở lịch (`DatePicker`), và một
   * ô chữ. Nhầm vai ở đây nghĩa là người dùng bàn phím thao tác khác hẳn điều ta tưởng.
   *
   * Và hộp SỬA phải mở ra kèm GIÁ TRỊ CŨ. Form sửa hiện ra trống là kiểu hỏng tệ nhất: người
   * dùng bấm Lưu và ghi đè sạch dữ liệu mà không hề biết.
   *
   * ĐỎ KHI: một ô rơi khỏi form (từ đó không ai nhập được trường ấy nữa), một ô đổi kiểu tay
   * nắm, hộp Sửa mở ra trống, hoặc một trong hai đường đóng hộp (✕ và Esc) chết.
   */
  test('Bên trong hộp "Cấp IP" và hộp "Sửa hồ sơ IP": đủ ô, đúng vai, và mở Sửa phải có giá trị cũ', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);
    const octet = octetFor(stamp, 40);
    const cidr = `172.16.${octet}.0/29`;
    const first = `172.16.${octet}.1`;

    const subnetId = await createSubnet(page, cidr, `LAN hộp E2E ${stamp}`);
    await page.goto(`/ip-addresses/${subnetId}`);

    /* ----- Hộp CẤP ----- */
    await ipRow(page, first).getByRole('button', { name: 'Cấp IP', exact: true }).click();
    const assign = page.getByRole('dialog', { name: `Cấp IP — ${first}` });
    await expect(assign).toBeVisible();
    await expect(
      assign.getByText(first, { exact: true }),
      'địa chỉ là giá trị CỐ ĐỊNH trong hộp này — sửa được nó thì nút "Cấp IP này" của dòng mất hết ý nghĩa',
    ).toBeVisible();

    await expectHandles(assign, 'textbox', ['Ghi chú', 'Lý do'], 'Hộp "Cấp IP"');
    // HAI ô gõ-để-lọc, cả hai gọi được tên: "Thiết bị" và "Người / bộ phận dùng".
    await expectHandles(
      assign,
      'combobox',
      ['Thiết bị', 'Người / bộ phận dùng'],
      'Hộp "Cấp IP"',
    );
    // "Ngày cấp" là NÚT mở lịch, không phải ô gõ ngày; nó điền sẵn hôm nay nên có nút "Xóa ngày".
    // Nút chính mang đúng tên việc: "Cấp IP".
    // "Chép Mask": khối "Cấu hình cho máy" — thứ người cắm máy gõ vào card mạng.
    await expectHandles(
      assign,
      'button',
      [/^Ngày cấp/, 'Xóa ngày', 'Đóng hộp thoại', 'Hủy', 'Cấp IP', 'Chép Mask'],
      'Hộp "Cấp IP"',
    );

    // Đường đóng thứ nhất: phím Esc.
    await page.keyboard.press('Escape');
    await expect(assign, 'Esc phải đóng được hộp khi không có lượt ghi nào đang chạy').toHaveCount(
      0,
    );

    // Mở lại và cấp thật — để có một hồ sơ mà soi hộp SỬA.
    await ipRow(page, first).getByRole('button', { name: 'Cấp IP', exact: true }).click();
    const again = page.getByRole('dialog', { name: `Cấp IP — ${first}` });
    await again
      .getByRole('combobox', { name: 'Người / bộ phận dùng', exact: true })
      .fill('Chị Lan — Kế toán');
    await again
      .getByRole('textbox', { name: 'Ghi chú', exact: true })
      .fill(`máy bàn tầng 2 E2E ${stamp}`);
    await again.getByRole('button', { name: 'Cấp IP', exact: true }).click();
    await expect(again).toHaveCount(0);
    await expect(ipRow(page, first).getByText('Chị Lan — Kế toán')).toBeVisible();

    /* ----- Hộp SỬA: cùng bộ ô, nhưng phải mang giá trị cũ ----- */
    await rowAction(page, first, 'Sửa');
    const edit = page.getByRole('dialog', { name: `Sửa hồ sơ ${first}` });
    await expect(edit).toBeVisible();
    await expectHandles(edit, 'textbox', ['Ghi chú'], 'Hộp "Sửa hồ sơ IP"');
    await expect(edit.getByRole('combobox')).toHaveCount(2);
    await expectHandles(
      edit,
      'button',
      // Hồ sơ đã cấp luôn có ngày cấp (hộp Cấp điền sẵn hôm nay), nên có nút "Xóa ngày".
      ['Đóng hộp thoại', /^Ngày cấp/, 'Xóa ngày', 'Hủy', 'Lưu'],
      'Hộp "Sửa hồ sơ IP"',
    );
    await expect(
      edit.getByRole('combobox', { name: 'Người / bộ phận dùng', exact: true }),
      'mở Sửa mà ô trống thì bấm Lưu là xóa sạch chủ cũ, im lặng',
    ).toHaveValue('Chị Lan — Kế toán');
    await expect(edit.getByRole('textbox', { name: 'Ghi chú', exact: true })).toHaveValue(
      `máy bàn tầng 2 E2E ${stamp}`,
    );

    // Đường đóng thứ hai: nút ✕. Và đóng KHÔNG được ghi gì.
    await edit.getByRole('button', { name: 'Đóng hộp thoại' }).click();
    await expect(edit).toHaveCount(0);
    await expect(ipRow(page, first).getByText('Chị Lan — Kế toán')).toBeVisible();
  });

  /**
   * VÌ SAO BÀI NÀY TỒN TẠI
   *
   * Menu ba chấm của một hồ sơ IP là chỗ DUY NHẤT trên giao diện bày ra máy trạng thái vòng
   * đời: `NEXT_STATUSES` quyết định có những bước nào, và `RowActions` đẩy việc nguy hiểm
   * xuống cuối. Nghĩa là bộ mục ấy phải ĐỔI theo trạng thái của chính hàng đó.
   *
   * `ip-lifecycle.spec.ts` đã kiểm rằng bước sai bị API từ chối. Bài này kiểm phía trước cái
   * hàng rào ấy: nút cho một bước KHÔNG đi được thì đừng vẽ ra, và nút cho bước đi được thì
   * đừng thiếu.
   *
   * ĐỎ KHI: `NEXT_STATUSES` bên web lệch khỏi máy trạng thái bên API (menu bày ra một bước
   * bấm vào là ăn 400), thứ tự "việc nguy hiểm xuống cuối" bị phá (ngón tay rơi vào "Thu hồi"
   * lúc menu vừa bung), hoặc menu đứng im không đổi khi trạng thái đã đổi.
   */
  test('Menu của một hồ sơ IP đổi theo trạng thái, và hộp chuyển trạng thái hỏi đúng thứ cần hỏi', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);
    const octet = octetFor(stamp, 60);
    const cidr = `172.16.${octet}.0/29`;
    const address = `172.16.${octet}.3`;

    const subnetId = await createSubnet(page, cidr, `LAN vòng đời E2E ${stamp}`);
    await createAddress(page, subnetId, address, 'Chị Lan — Kế toán');
    await page.goto(`/ip-addresses/${subnetId}`);

    /* ----- Trạng thái 1: ĐANG CẤP ----- */
    await expect(ipRow(page, address).getByText('Đang dùng')).toBeVisible();
    expect(
      await rowActionNames(page, address),
      'từ "Đang dùng" chỉ đi được sang Thu hồi (Q-02); Lịch sử luôn có; Sửa/Ẩn của SA. Thu hồi (đỏ) xếp sau việc thường, Ẩn hồ sơ nhập nhầm (xám) xếp CUỐI',
    ).toEqual(['Sửa', 'Lịch sử', 'Thu hồi IP', 'Ẩn bản ghi nhập nhầm']);

    /* ----- Hộp "Thu hồi": KHÔNG hỏi chủ mới — chủ cũ đi khỏi, không ai dọn vào ----- */
    await rowAction(page, address, 'Thu hồi IP');
    const reclaim = page.getByRole('dialog', {
      name: new RegExp(`Thu hồi IP\\s*—\\s*${esc(address)}`),
    });
    await expect(reclaim).toBeVisible();
    await expectHandles(reclaim, 'textbox', ['Lý do'], 'Hộp "Thu hồi"');
    await expect(
      reclaim.getByRole('combobox'),
      'thu hồi KHÔNG cấp cho ai — hỏi "ai dùng" ở đây là một câu hỏi trá hình',
    ).toHaveCount(0);
    await expectHandles(
      reclaim,
      'button',
      ['Đóng hộp thoại', 'Hủy', 'Thu hồi IP'],
      'Hộp "Thu hồi"',
    );
    // Hộp nói IP đang của ai trước khi lấy lại.
    await expect(reclaim.getByText('Đang cấp cho Chị Lan — Kế toán')).toBeVisible();
    await reclaim.getByRole('textbox', { name: 'Lý do', exact: true }).fill('máy đã thanh lý');
    await confirmAction(page, 'Thu hồi IP');
    await expect(reclaim).toHaveCount(0);

    /* ----- Trạng thái 2: TRỐNG — menu phải ĐỔI ----- */
    await expect(ipRow(page, address).getByText('Trống', { exact: true })).toBeVisible();
    expect(
      await rowActionNames(page, address),
      'từ "Trống" KHÔNG còn "Thu hồi"; bước cấp là nút "Cấp IP" ngay trên dòng, và "Sửa" một hồ sơ trống chính là cấp nên không bày riêng',
    ).toEqual(['Lịch sử', 'Ẩn bản ghi nhập nhầm']);

    /* ----- Hồ sơ Trống mở CÙNG hộp "Cấp IP" với ô trống: có ô Thiết bị, ô người dùng mở ra trống ----- */
    await ipRow(page, address).getByRole('button', { name: 'Cấp IP', exact: true }).click();
    const assign = page.getByRole('dialog', {
      name: new RegExp(`Cấp IP\\s*—\\s*${esc(address)}`),
    });
    await expect(assign).toBeVisible();
    await expectHandles(
      assign,
      'combobox',
      ['Thiết bị', 'Người / bộ phận dùng'],
      'Hộp "Cấp IP"',
    );
    await expect(
      assign.getByRole('combobox', { name: 'Người / bộ phận dùng', exact: true }),
      'chủ cũ đã đi khỏi lúc thu hồi — điền sẵn tên họ là hồi sinh một chủ không còn',
    ).toHaveValue('');
    await expectHandles(assign, 'textbox', ['Ghi chú', 'Lý do'], 'Hộp "Cấp IP"');
    await assign.getByRole('button', { name: 'Đóng hộp thoại' }).click();
    await expect(assign).toHaveCount(0);
    await expect(ipRow(page, address).getByText('Trống', { exact: true })).toBeVisible();
  });

  /**
   * VÌ SAO BÀI NÀY TỒN TẠI
   *
   * Hai hộp còn lại của phòng Địa chỉ IP chưa ai kiểm phần RUỘT: hộp "Sửa dải" (phải mang đủ
   * sáu giá trị cũ, cộng khu giấy tờ chỉ mở ra khi đã có id) và hộp "Vô hiệu hóa dải" (một
   * hộp RIÊNG chứ không phải `useConfirm` chung, vì lý do ở đây là dữ liệu bắt buộc đi vào
   * audit).
   *
   * ĐỎ KHI: một ô của hộp Sửa mở ra trống (bấm Lưu là xóa sạch VLAN/gateway/mô tả đang có),
   * khu giấy tờ tuột mất, hoặc hộp Vô hiệu hóa mất ô Lý do và tụt về một câu hỏi có/không —
   * lúc đó sáu tháng sau không ai trả lời được "sao dải này biến mất".
   */
  test('Bên trong hộp "Sửa dải" và hộp "Vô hiệu hóa dải": giá trị cũ phải còn nguyên, lý do vẫn bắt buộc', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);
    const octet = octetFor(stamp, 80);
    const cidr = `172.16.${octet}.0/29`;
    const name = `LAN sửa E2E ${stamp}`;
    const gateway = `172.16.${octet}.1`;
    const description = `dải thử của bài E2E ${stamp}`;

    const subnetId = await createSubnet(page, cidr, name, {
      vlan: 42,
      gateway,
      description,
    });
    // Có hồ sơ IP → thẻ dải chuyển sang nhánh "Vô hiệu hóa".
    await createAddress(page, subnetId, `172.16.${octet}.2`, 'Phòng Kỹ thuật');
    await page.goto(`/ip-addresses/${subnetId}`);

    /* ----- Hộp SỬA DẢI ----- */
    await rowAction(page, cidr, 'Sửa');
    const form = page.getByRole('dialog', { name: /^Sửa dải — / });
    await expect(form).toBeVisible();
    await expect(
      form.getByRole('heading', { level: 2 }),
      'hộp sửa dải vẫn là một khối phẳng — khu giấy tờ ở đây không dựng FormSection riêng',
      /* Tiêu đề hộp LÀ một `h2`, nên nó nằm trong danh sách này. Từ 12/09 tiêu đề kèm luôn
         đối tượng (rà UI/UX #9) — một chữ "Sửa dải" không nói được đang sửa dải nào. */
    ).toHaveText([`Sửa dải — ${cidr}`]);

    await expect(form.getByRole('textbox', { name: 'Dải', exact: true })).toHaveValue(cidr);
    await expect(form.getByRole('textbox', { name: 'Tên gọi', exact: true })).toHaveValue(name);
    await expect(
      form.getByRole('textbox', { name: 'VLAN', exact: true }),
      'ô VLAN để trống nghĩa là XÓA số đang có — mở ra trống là một cái bẫy',
    ).toHaveValue('42');
    await expect(form.getByRole('textbox', { name: 'Gateway', exact: true })).toHaveValue(gateway);
    await expect(form.getByRole('textbox', { name: 'Mô tả', exact: true })).toHaveValue(description);
    // Dải đã có hồ sơ IP: CIDR chỉ đọc (API cũng từ chối đổi) — nói trước, không để ăn lỗi.
    await expect(form.getByRole('textbox', { name: 'Dải', exact: true })).toHaveAttribute(
      'readonly',
      '',
    );
    await expect(
      form.getByText('Thêm và xóa giấy tờ ở đây có hiệu lực NGAY', { exact: false }),
      'giấy tờ của dải ghi thẳng nên KHÔNG nằm trong hộp có nút Hủy — nó ở đầu cột phải',
    ).toHaveCount(0);

    await page.keyboard.press('Escape');
    await expect(form).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Giấy tờ (0)' })).toBeVisible();

    /* ----- Hộp VÔ HIỆU HÓA DẢI ----- */
    await rowAction(page, cidr, 'Ngừng dùng');
    const hide = page.getByRole('dialog', { name: `Ngừng dùng dải ${cidr}` });
    await expect(hide).toBeVisible();
    await expect(
      hide.getByText('Dải Ở LẠI danh sách', { exact: false }),
      'phải nói rõ ngừng dùng KHÔNG phải xóa — người dùng đọc "biến mất" là "đã mất"',
    ).toBeVisible();
    await expectHandles(hide, 'textbox', ['Lý do'], 'Hộp "Ngừng dùng dải"');
    await expectHandles(
      hide,
      'button',
      ['Đóng hộp thoại', 'Hủy', 'Ngừng dùng'],
      'Hộp "Ngừng dùng dải"',
    );
    await expect(
      hide.getByRole('textbox', { name: 'Lý do', exact: true }),
      'lý do là DỮ LIỆU BẮT BUỘC, không phải một ô ghi chú — nó đi vào audit',
    ).toHaveAttribute('required');

    await hide.getByRole('button', { name: 'Hủy' }).click();
    await expect(hide).toHaveCount(0);
    /*
     * Hủy là hủy. Thu hẹp về ĐÚNG thẻ của bài này: rail còn dải lạ của máy ("TT2") vốn đã
     * mang sẵn huy hiệu "Đã vô hiệu hóa", nên hỏi cả trang là hỏi nhầm người.
     */
    await expect(
      subnetCard(page, cidr).getByText('Đã ngừng dùng'),
      'bấm Hủy mà dải vẫn bị tắt nghĩa là hộp thoại ghi trước khi hỏi',
    ).toHaveCount(0);
  });

  /* ===================== PHÒNG SỔ NAT ===================== */

  /**
   * VÌ SAO BÀI NÀY TỒN TẠI
   *
   * Sổ NAT tồn tại để trả lời ba câu của auditor — **port nào mở, cho ai, vì sao** — nên cả
   * ba phải nằm NGAY TRÊN BẢNG. Một cột rơi mất là cuốn sổ mất một câu trả lời, và không có
   * bài nào đỏ vì mọi bài cũ chỉ đọc đúng ô nó vừa ghi.
   *
   * Bài này cũng chốt lại một điều dễ tưởng nhầm: màn NAT KHÔNG có phân trang (khác màn Địa
   * chỉ IP). Danh sách về trong một lượt và vẽ hết.
   *
   * ĐỎ KHI: một nút mọc thêm ở đầu trang, ô tìm mất `aria-label` (bàn phím và trình đọc màn
   * hình hết đường tới), bộ lọc site không đổi được bảng, một cột rơi khỏi sổ, hoặc menu dòng
   * bày ra việc mà vai đang đăng nhập không được làm.
   */
  test('Phòng Sổ NAT: nút đầu trang, bộ lọc, đủ cột trên bảng và menu của một dòng', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);
    const octet = octetFor(stamp, 100);

    /*
     * Sổ NAT thì RỖNG được thật: `resetIpam` gỡ mọi rule gắn với dải/thiết bị E2E, và máy
     * này không có rule nào khác. Nên đây là lúc so được TRỌN BỘ nút của cả màn.
     */
    await page.goto('/nat');
    await expect(page.getByRole('heading', { level: 1, name: 'Sổ NAT' })).toBeVisible();
    await expect(page.getByText('Chưa có luật NAT nào')).toBeVisible();
    await expect(
      page.getByRole('main').getByRole('button'),
      'đầu trang hai nút + ba ô lọc (site · router · giao thức) + ba chip trạng thái + chip port nhạy cảm + ô sắp xếp; nút nào khác mọc ra ở đây là thứ không ai khai',
    ).toHaveText([
      'Xuất Excel',
      'Thêm luật NAT',
      'Mọi site',
      'Mọi router',
      'Mọi giao thức',
      /^Đang mở \d+$/,
      /^Đã ngừng dùng \d+$/,
      /^Đã gỡ \d+$/,
      'Chỉ cổng nhạy cảm',
      'Sắp theo cổng ngoài',
    ]);
    // Sổ mặc định chỉ bày rule còn hiệu lực: rule đã gỡ phải bật chip mới thấy.
    const chips = page.getByRole('group', { name: 'Lọc theo trạng thái luật' });
    await expect(chips.getByRole('button', { name: /^Đang mở/ })).toHaveAttribute('aria-pressed', 'true');
    await expect(chips.getByRole('button', { name: /^Đã gỡ/ })).toHaveAttribute('aria-pressed', 'false');
    await expect(
      page.getByRole('searchbox', { name: 'Tìm theo cổng, IP, người dùng hoặc lý do…' }),
      'ô tìm phải mang tên trợ năng = chính dòng gợi ý của nó',
    ).toBeVisible();

    const fixture = await setUpNat(page, stamp, octet);
    const rule = await page.request.post('/api/v1/ipam/nat', {
      headers: await writeHeaders(page),
      data: {
        deviceId: fixture.routerId,
        protocol: 'tcp',
        externalPorts: '8080',
        internalIp: fixture.internalIp,
        internalPort: 80,
        usedBy: 'Phòng Nhân sự',
        reason: `chấm công truy cập từ ngoài E2E ${stamp}`,
        enabled: true,
      },
    });
    expect(rule.status(), 'dàn cảnh: phải ghi được một rule NAT').toBeLessThan(300);

    await page.goto('/nat');

    /* ----- Bảng: đủ sáu cột, và ba câu của auditor nằm trên chính bảng ----- */
    const table = page.getByRole('table');
    await expect(
      table.getByRole('columnheader'),
      'mất cột "Mở cho ai" hoặc "Lý do mở" là cuốn sổ mất đúng thứ nó sinh ra để giữ',
      /* "Chuyển tiếp" đọc ngang ngoài → trong; trạng thái là cột riêng, không dính vào số port. */
    ).toHaveText(['Router', 'Chuyển tiếp', 'Mở cho ai', 'Lý do mở', 'Trạng thái', 'Thao tác']);
    const row = page.getByRole('row', { name: new RegExp(esc(fixture.routerCode)) });
    await expect(row.getByText('TCP 8080')).toBeVisible();
    await expect(row.getByText(`${fixture.internalIp}:80`)).toBeVisible();
    await expect(row.getByText('Đang mở', { exact: true })).toBeVisible();

    await expect(
      page.getByRole('navigation', { name: 'Trang' }),
      'sổ NAT có phân trang như mọi danh sách khác — sổ vài trăm rule không đổ một lèo',
    ).toHaveCount(1);

    /* ----- Menu của một dòng ----- */
    expect(
      await rowActionNames(page, 'TCP 8080'),
      'SA gỡ được rule; "Gỡ" là việc lấy đi nên phải xếp CUỐI; Lịch sử và Tắt rule ngay từ bảng',
    ).toEqual(['Sửa', 'Lịch sử', 'Ngừng dùng', 'Gỡ']);

    /* ----- Bộ lọc site: bấm là bảng đổi THẬT ----- */
    await page.getByRole('button', { name: 'Site', exact: true }).click();
    await expect(
      page.getByRole('option').first(),
      'lựa chọn đầu luôn là đường bỏ lọc',
    ).toHaveText('Mọi site');
    await expect(
      page.getByRole('option', { name: fixture.siteCode, exact: true }),
      'site vừa khai phải có trong danh sách — không thì bộ lọc chỉ bày ra thứ không dùng được',
    ).toHaveCount(1);
    await page.getByRole('option', { name: fixture.siteCode, exact: true }).click();
    // Router của bài này KHÔNG gắn site, nên lọc theo site vừa khai phải ra RỖNG — và câu rỗng
    // nói là LỌC không ra, không phải sổ trống.
    await expect(
      page.getByText('Không có luật nào khớp bộ lọc.'),
      'lọc site mà bảng đứng im nghĩa là tham số không đi tới API',
    ).toBeVisible();
    await expect(page.getByText('Chưa có luật NAT nào')).toHaveCount(0);
  });

  /**
   * VÌ SAO BÀI NÀY TỒN TẠI
   *
   * Hộp "Thêm luật NAT" là form phức tạp nhất hệ thống: ba khối theo đúng đường đi của một gói
   * tin, một ô cổng dạng CHIP nhận nhiều khoảng, một nhóm giao thức `role="group"`, và HAI
   * đường mở tiếp hộp con ("+ Thêm router mới", "+ Thêm dịch vụ") cho thứ chưa có trong kho.
   *
   * Ba khối ấy không phải trang trí: bản cũ là một dây mười ô xếp dọc, trong đó "Loại thiết
   * bị" — một BỘ LỌC của ô ngay dưới — đứng như thể là dữ liệu của rule. Gộp lại là quay về
   * đúng chỗ đã bỏ đi.
   *
   * ĐỎ KHI: một khối biến mất, một ô rơi khỏi form, nhóm giao thức mất một lựa chọn (từ đó
   * port UDP âm thầm được ghi thành TCP), chip cổng không bỏ ra được, hộp con mở ra làm hộp
   * CHA đóng theo (mất trắng form đang khai dở), hoặc bấm Lưu với danh sách cổng rỗng mà hộp
   * vẫn đóng.
   */
  test('Bên trong hộp "Thêm rule" NAT: ba khối, chip cổng, nhóm giao thức và hai hộp con', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);
    const octet = octetFor(stamp, 120);
    const fixture = await setUpNat(page, stamp, octet);

    await page.goto('/nat');
    await page.getByRole('button', { name: 'Thêm luật NAT' }).click();
    const form = page.getByRole('dialog', { name: 'Thêm luật NAT', exact: true });
    await expect(form).toBeVisible();

    /* ----- BA KHỐI, đúng đường đi của một gói tin ----- */
    await expect(
      form.getByRole('heading', { level: 2 }),
      'vào từ đâu → chuyển tới đâu → vì sao mở. Thêm mới thì chưa có giấy tờ và lịch sử để kể',
    ).toHaveText([
      'Thêm luật NAT',
      'Cổng mở ra ngoài',
      'Chuyển tới máy bên trong',
      'Mở cho ai và vì sao',
    ]);

    /* ----- Đủ ô, đúng vai ----- */
    await expectHandles(
      form,
      'combobox',
      [
        'Router',
        'Lọc dịch vụ cho Cổng ngoài',
        'Lọc dịch vụ cho Cổng trong',
        'Máy đích (được NAT)',
        'Mở cho ai',
      ],
      'Hộp "Thêm luật NAT"',
    );
    await expectHandles(
      form,
      'textbox',
      ['Cổng ngoài', 'Cổng trong', 'IP trong', 'Lý do mở', 'Ghi chú'],
      'Hộp "Thêm luật NAT"',
    );
    await expectHandles(
      form,
      'button',
      ['Đóng hộp thoại', 'Thêm', 'TCP', 'UDP', 'TCP + UDP', 'Hủy', 'Lưu'],
      'Hộp "Thêm luật NAT"',
    );
    /*
     * Ô tick "Đang bật" mang tên trợ năng là DÒNG GỢI Ý, không phải nhãn trường: nhãn của
     * `Field` không có `htmlFor`, còn `<label>` bọc ngoài thì bọc cả dòng gợi ý. Khoá lại
     * đúng hiện trạng — đổi câu chữ ấy là đổi tên một điều khiển.
     */
    await expectHandles(
      form,
      'checkbox',
      [/^Hiện mọi thiết bị/, /^Bỏ tick nếu luật đã tắt/],
      'Hộp "Thêm luật NAT"',
    );
    await expect(form.getByRole('checkbox', { name: /^Bỏ tick nếu luật đã tắt/ }), 'rule khai mới thì mặc định là ĐANG BẬT').toBeChecked();

    /* ----- Nhóm giao thức: đúng ba lựa chọn, TCP là mặc định ----- */
    const protocols = form.getByRole('group', { name: 'Giao thức' });
    await expect(
      protocols.getByRole('button'),
      'mất "TCP + UDP" thì mọi rule VPN phải khai làm hai dòng',
    ).toHaveText(['TCP', 'UDP', 'TCP + UDP']);
    await expect(protocols.getByRole('button', { name: 'TCP', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    /* ----- Ô cổng dạng CHIP: thêm, bỏ ra, và nhận cả một DẢI ----- */
    const portInput = form.getByRole('textbox', { name: 'Cổng ngoài', exact: true });
    await portInput.fill('8080');
    await portInput.press('Enter');
    await expect(
      form.getByRole('button', { name: 'Bỏ cổng 8080' }),
      'gõ xong Enter là thành chip — Enter ở đây KHÔNG được gửi cả form đi với danh sách rỗng',
    ).toBeVisible();
    await form.getByRole('button', { name: 'Bỏ cổng 8080' }).click();
    await expect(
      form.getByRole('button', { name: 'Bỏ cổng 8080' }),
      'bấm ✕ là chip biến mất — không thì port đã bỏ vẫn vào sổ',
    ).toHaveCount(0);

    await portInput.fill('8000-8010');
    await portInput.press('Enter');
    await expect(
      form.getByRole('button', { name: 'Bỏ cổng 8000-8010' }),
      'ô này nhận cả một DẢI cổng, không chỉ một số',
    ).toBeVisible();

    /* ----- Hộp con 1: "+ Thêm router mới" — hộp CHA phải sống ----- */
    await form.getByRole('combobox', { name: 'Mở cho ai', exact: true }).fill('Phòng Nhân sự');
    await form.getByRole('combobox', { name: 'Router', exact: true }).click();
    await form.getByRole('button', { name: '+ Thêm router mới' }).click();
    const deviceForm = page.getByRole('dialog', { name: 'Thêm thiết bị' });
    await expect(
      deviceForm,
      'router chưa có trong kho thì khai NGAY tại đây, không bắt thoát ra màn Thiết bị',
    ).toBeVisible();
    await deviceForm.getByRole('button', { name: 'Đóng hộp thoại' }).click();
    await expect(deviceForm).toHaveCount(0);

    await expect(form, 'đóng hộp con KHÔNG được kéo theo hộp cha').toBeVisible();
    await expect(
      form.getByRole('button', { name: 'Bỏ cổng 8000-8010' }),
      'và form đang khai dở phải còn nguyên — mất nó là gõ lại từ đầu',
    ).toBeVisible();
    await expect(form.getByRole('combobox', { name: 'Mở cho ai', exact: true })).toHaveValue(
      'Phòng Nhân sự',
    );

    /* ----- Hộp con 2: "+ Thêm dịch vụ" ----- */
    await form.getByRole('combobox', { name: 'Lọc dịch vụ cho Cổng ngoài', exact: true }).click();
    await form.getByRole('button', { name: '+ Thêm dịch vụ' }).click();
    const serviceForm = page.getByRole('dialog', { name: 'Thêm dịch vụ' });
    await expect(serviceForm).toBeVisible();
    await serviceForm.getByRole('button', { name: 'Hủy' }).click();
    await expect(serviceForm).toHaveCount(0);
    await expect(form).toBeVisible();

    /* ----- Đường hỏng: bấm Lưu khi chưa có cổng nào ----- */
    await form.getByRole('button', { name: 'Bỏ cổng 8000-8010' }).click();
    await form.getByRole('combobox', { name: 'Router', exact: true }).fill(fixture.routerCode);
    await form.getByRole('option', { name: new RegExp(esc(fixture.routerCode)) }).click();
    await form.getByRole('textbox', { name: 'IP trong', exact: true }).fill(fixture.internalIp);
    await form.getByRole('textbox', { name: 'Cổng trong', exact: true }).fill('80');
    // "Mở cho ai" cũng bắt buộc (API từ chối rule không có người dùng) — điền để chỉ còn đúng lỗi port.
    await form.getByRole('combobox', { name: 'Mở cho ai', exact: true }).fill('P. Kỹ thuật');
    await form.getByRole('textbox', { name: 'Lý do mở', exact: true }).fill(`thử E2E ${stamp}`);
    await form.getByRole('button', { name: 'Lưu' }).click();
    await expect(
      form.getByRole('alert'),
      'một lỗi, một chỗ nói ra — không phải hai câu chồng nhau',
    ).toHaveCount(1);
    await expect(
      form.getByRole('alert'),
      'không có cổng nào thì phải nói ra bằng ĐÚNG câu của vi.ts, chứ không lặng lẽ ghi một dòng rỗng',
    ).toHaveText('Thêm ít nhất một cổng ngoài.');
    await expect(form, 'lỗi thì hộp Ở LẠI — đóng là mất trắng thứ vừa gõ').toBeVisible();

    await form.getByRole('button', { name: 'Hủy' }).click();
    await expect(form).toHaveCount(0);
    await expect(page.getByText('Chưa có luật NAT nào'), 'bấm Hủy là không ghi gì cả').toBeVisible();
  });

  /**
   * VÌ SAO BÀI NÀY TỒN TẠI
   *
   * Hộp SỬA rule là một hộp KHÁC hộp Thêm, dù dùng chung component: nó mở thêm hai khối (giấy
   * tờ và lịch sử), và nó cắt ô cổng về đúng MỘT khoảng — sửa là đổi một dòng đang có, còn
   * tách nó thành ba dòng là chuyện khác hẳn.
   *
   * Và nó phải mang GIÁ TRỊ CŨ. Một form sửa mở ra trống rồi được bấm Lưu là lệnh ghi đè sạch
   * một dòng trong cuốn sổ mà auditor sẽ đọc.
   *
   * ĐỎ KHI: một ô mở ra trống, hai khối giấy tờ/lịch sử tuột mất (từ đó "ai mở port này, ngày
   * nào" lại chỉ tra được bằng SQL), ô cổng vẫn cho thêm khoảng thứ hai ở chế độ sửa, hoặc
   * hộp "Gỡ" tụt về một câu hỏi có/không không kèm lý do.
   */
  test('Bên trong hộp "Sửa rule" và hộp "Gỡ rule": giá trị cũ còn nguyên, cổng chỉ còn một khoảng', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);
    const octet = octetFor(stamp, 130);
    const fixture = await setUpNat(page, stamp, octet);
    const reason = `chấm công truy cập từ ngoài E2E ${stamp}`;

    const rule = await page.request.post('/api/v1/ipam/nat', {
      headers: await writeHeaders(page),
      data: {
        deviceId: fixture.routerId,
        protocol: 'udp',
        externalPorts: '9000-9010',
        internalIp: fixture.internalIp,
        internalPort: 9000,
        usedBy: 'Phòng Nhân sự',
        reason,
        enabled: true,
      },
    });
    expect(rule.status(), 'dàn cảnh: phải ghi được một rule NAT').toBeLessThan(300);

    await page.goto('/nat');
    await rowAction(page, 'UDP 9000-9010', 'Sửa');
    const form = page.getByRole('dialog', { name: /^Sửa luật NAT — / });
    await expect(form).toBeVisible();

    /* ----- Sửa mở thêm HAI khối mà hộp Thêm không có ----- */
    await expect(
      form.getByRole('heading', { level: 2 }),
      'sửa một rule đang có thì mở luôn giấy tờ và lịch sử — đó là câu auditor hỏi nhiều nhất',
      /* Tiêu đề hộp LÀ một `h2` — từ 12/09 nó kèm giao thức và cổng (rà UI/UX #9). */
    ).toHaveText([
      'Sửa luật NAT — UDP 9000-9010',
      'Cổng mở ra ngoài',
      'Chuyển tới máy bên trong',
      'Mở cho ai và vì sao',
      'Giấy tờ đính kèm',
      'Lịch sử luật NAT',
    ]);

    /* ----- Giá trị cũ ----- */
    await expect(form.getByRole('combobox', { name: 'Router', exact: true })).toHaveValue(
      fixture.routerCode,
    );
    await expect(
      form.getByRole('button', { name: 'Bỏ cổng 9000-9010' }),
      'khoảng cổng đang có phải hiện ra dưới dạng chip, không phải một ô trống',
    ).toBeVisible();
    await expect(form.getByRole('textbox', { name: 'IP trong', exact: true })).toHaveValue(
      fixture.internalIp,
    );
    await expect(form.getByRole('textbox', { name: 'Cổng trong', exact: true })).toHaveValue('9000');
    await expect(form.getByRole('combobox', { name: 'Mở cho ai', exact: true })).toHaveValue(
      'Phòng Nhân sự',
    );
    await expect(form.getByRole('textbox', { name: 'Lý do mở', exact: true })).toHaveValue(reason);
    await expect(form.getByRole('checkbox', { name: /^Bỏ tick nếu luật đã tắt/ })).toBeChecked();
    await expect(
      form
        .getByRole('group', { name: 'Giao thức' })
        .getByRole('button', { name: 'UDP', exact: true }),
      'giao thức cũ phải được giữ — nhảy về TCP là âm thầm đổi nghĩa cả rule',
    ).toHaveAttribute('aria-pressed', 'true');

    /* ----- Chế độ sửa: đúng MỘT khoảng, nên ô nhập bị tháo hẳn ----- */
    await expect(
      form.getByRole('textbox', { name: 'Cổng ngoài', exact: true }),
      'đã đủ một khoảng thì ô nhập biến mất — một điều khiển bấm vào mà không xảy ra gì là thứ người dùng sẽ bấm vài lần rồi nghĩ máy hỏng',
    ).toHaveCount(0);
    await expect(
      form.getByText('Đang sửa một dòng nên chỉ giữ một khoảng cổng.', { exact: false }),
    ).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(form).toHaveCount(0);

    /* ----- Hộp GỠ: vẫn hỏi lý do, không phải một câu có/không ----- */
    await rowAction(page, 'UDP 9000-9010', 'Gỡ');
    const remove = page.getByRole('dialog', { name: 'Gỡ luật NAT UDP 9000-9010' });
    await expect(remove).toBeVisible();
    await expect(
      remove.getByText('Luật không bị xóa khỏi hệ thống', { exact: false }),
    ).toBeVisible();
    await expectHandles(remove, 'textbox', ['Lý do gỡ'], 'Hộp "Gỡ luật NAT"');
    await expectHandles(remove, 'button', ['Đóng hộp thoại', 'Hủy', 'Gỡ'], 'Hộp "Gỡ luật NAT"');
    await expect(
      remove.getByRole('textbox', { name: 'Lý do gỡ', exact: true }),
      '"port này đóng ngày nào, ai đóng, vì sao" sẽ có người hỏi',
    ).toHaveAttribute('required');

    await remove.getByRole('button', { name: 'Đóng hộp thoại' }).click();
    await expect(remove).toHaveCount(0);
    await expect(
      page.getByRole('row', { name: new RegExp(esc(fixture.routerCode)) }),
      'đóng hộp Gỡ là không gỡ gì cả',
    ).toBeVisible();
  });
});

/*
 * ===== PHẦN 5 — VÀO HẲN TRONG PHÒNG: ĐƯỜNG TRUYỀN · TÀI KHOẢN DỊCH VỤ · KHO THANH LÝ =====
 *
 * Bốn khối trước đi HÀNH LANG: bấm menu, đọc breadcrumb, kiểm ranh giới vai. Chúng chứng minh
 * được rằng CÁC CỬA còn mở đúng chỗ, nhưng không nói gì về thứ nằm SAU cửa.
 *
 * Khối này đi vào trong. Ba phòng ở đây có một điểm chung: chúng là những màn ÍT AI MỞ NHẤT
 * trong ngày thường, nên một cái nút biến mất, một cột rơi khỏi bảng, một ô rơi khỏi form sẽ
 * sống rất lâu trước khi có người nhận ra. Bộ E2E hiện có kiểm NGHIỆP VỤ của chúng khá kỹ
 * (`isp.spec.ts`, `service-accounts.spec.ts`, `disposal.spec.ts`) — nhưng luôn bằng cách bấm
 * đúng vào cái nút mình cần, nên không bài nào trả lời được câu "phòng này CÓ ĐÚNG những gì".
 *
 * Vì thế mọi khẳng định ở đây là khẳng định TẬP HỢP: danh sách nút, danh sách cột, danh sách
 * mục menu, danh sách ô trong hộp thoại. So từng cái một bằng `toBeVisible()` chỉ bắt được
 * thứ MẤT ĐI; so cả tập bắt thêm được thứ THỪA RA — và ở phòng "Kho thanh lý" thì một cái nút
 * thừa ra chính là một hồ sơ đã thanh lý bị ai đó sửa được.
 */
test.describe('Phòng Đường truyền, Tài khoản dịch vụ và Kho thanh lý — bên trong có gì', () => {
  test.beforeEach(() => {
    resetUsers();
    resetIsp();
    resetServiceAccounts();
    resetDevices();
    resetCatalog();
    resetSecrets();
  });

  /** Sáu chữ số cuối của mốc thời gian — đủ riêng cho một lượt chạy, đủ ngắn để đọc trong log. */
  const dauThoiGian = (): string => uniqueStamp();

  /**
   * Gọn một nhãn đọc được về dạng so sánh được: gộp mọi khoảng trắng, bỏ dấu `*` của ô bắt buộc.
   *
   * Dấu `*` là chỉ dấu THỊ GIÁC (`aria-hidden`), nó không thuộc về tên gọi của ô. Giữ lại thì
   * mọi mảng mong đợi phải gõ kèm một ký tự mà trình đọc màn hình không bao giờ đọc lên.
   */
  function gonNhan(raw: string): string {
    return raw.replace(/\s+/g, ' ').trim().replace(/\s*\*$/, '').trim();
  }

  /**
   * TÊN của mọi tay nắm mang vai trò `role` bên trong `scope`, đã sắp xếp.
   *
   * Vì sao phải tự đọc thay vì `allInnerTexts()`: nửa số tay nắm trong repo KHÔNG có chữ bên
   * trong. Nút sắp xếp mang `aria-label="Sắp xếp theo Mã đường"`, ô chọn `Select` là một
   * `<button>` chỉ chứa giá trị đang chọn, nút ‹ › của phân trang chỉ có một hình SVG. Đọc
   * `textContent` ở những chỗ đó ra chuỗi rỗng — và một mảng đầy chuỗi rỗng thì so tập hợp
   * kiểu gì cũng vô nghĩa.
   *
   * Thứ tự tra đúng theo thứ tự tính TÊN KHẢ TRUY CẬP của trình duyệt: `aria-label` → `<label
   * for>` → `placeholder` → chữ bên trong.
   *
   * `textContent` chứ KHÔNG phải `innerText`, và đây là bài học của lượt chạy đầu: `innerText`
   * trả về chữ SAU KHI CSS đã tô vẽ, nên `text-transform: uppercase` của `.form-section-title`
   * biến "Hồ sơ" thành "HỒ SƠ" và mọi phép so tập hợp đỏ hàng loạt vì một luật CSS. Tên một
   * tay nắm thuộc về DOM, không thuộc về bảng màu.
   *
   * Cái KHÔNG có trong mảng này cũng có nghĩa: nút mũi tên của mỗi `Combobox` mang
   * `aria-hidden="true"` (và `tabIndex={-1}`) nên nó không nằm trong cây trợ năng —
   * `getByRole` bỏ qua nó, đúng như ý người viết component. Ngày nào ai đó gỡ `aria-hidden`
   * đi thì một cái nút không tên sẽ lọt vào mảng và bài này đỏ, đúng lúc cần đỏ.
   */
  async function tenTheoVaiTro(
    scope: Locator,
    role: 'button' | 'textbox' | 'combobox',
  ): Promise<string[]> {
    const raw = await scope.getByRole(role).evaluateAll((els) =>
      els.map((el) => {
        const aria = el.getAttribute('aria-label');
        if (aria) return aria;
        const labels = (el as HTMLInputElement).labels;
        if (labels && labels.length > 0) return labels[0].textContent ?? '';
        return el.getAttribute('placeholder') ?? el.textContent ?? '';
      }),
    );
    return raw.map(gonNhan).sort();
  }

  /**
   * Tiêu đề các KHỐI trong một hộp thoại, đã sắp xếp.
   *
   * `FormSection` vẽ `<h2>`, mà `Dialog` cũng vẽ tiêu đề hộp bằng `<h2>` (Radix `Title`) — nên
   * mảng này luôn có phần tử đầu là tên hộp. Đó là chủ ý: tên hộp sai cũng phải đỏ.
   *
   * `allTextContents` chứ không `allInnerTexts`: `.form-section-title` có
   * `text-transform: uppercase`, nên `innerText` trả về "HỒ SƠ" còn DOM ghi "Hồ sơ".
   */
  async function tenKhoiTrongHop(scope: Locator): Promise<string[]> {
    const raw = await scope.getByRole('heading', { level: 2 }).allTextContents();
    return raw.map(gonNhan).sort();
  }

  /** Mảng mong đợi, sắp cùng một kiểu với `tenTheoVaiTro` để `toEqual` so được. */
  function sap(names: string[]): string[] {
    return [...names].sort();
  }

  /**
   * Chữ trong các ô tiêu đề cột — đọc CHỮ TRONG DOM, không phải tên khả truy cập.
   *
   * Không dùng tên khả truy cập vì `<th>` chứa nút sắp xếp sẽ lấy luôn tên của nút đó
   * ("Sắp xếp theo Mã đường"), còn `<th>` không sắp được thì lấy chính chữ của nó ("Site") —
   * hai kiểu tên cho cùng một hàng tiêu đề.
   *
   * Và phải là `allTextContents`: CSS của bảng đặt `text-transform: uppercase` cho `th`, nên
   * `allInnerTexts` trả về "MÃ ĐƯỜNG". Lượt chạy đầu đỏ đúng vì chuyện này ở cả ba bảng.
   */
  async function tenCotBang(scope: Locator): Promise<string[]> {
    return (await scope.getByRole('columnheader').allTextContents()).map(gonNhan);
  }

  /*
   * ===== BÀI 1 — MÀN ĐƯỜNG TRUYỀN =====
   *
   * VÌ SAO BÀI NÀY TỒN TẠI
   *
   * `isp.spec.ts` kiểm hotline/số hợp đồng có mặt trên bảng và kiểm thứ tự sắp xếp chạy ở
   * server. Cả hai đều bấm đúng vào cái nút cần bấm. Không bài nào hỏi "màn này có ĐÚNG những
   * nút nào" — mà đó lại là câu duy nhất bắt được một nút LẠ mọc thêm.
   *
   * Điểm riêng của màn này: nó KHÔNG có cột Thao tác, không có menu ba chấm. Sửa và thanh lý
   * chỉ làm được từ trang hồ sơ. Đó không phải chuyện tình cờ mà là hình dạng thật của
   * `isp-screen.tsx`, và nếu một ngày có người thêm `RowActions` vào đây thì phải có cái gì đó
   * đỏ lên để hỏi lại "đã bàn chưa".
   *
   * ĐỎ KHI: mọc thêm/mất đi một nút đầu trang, một ô lọc, một cột, một nút sắp xếp; ô tìm
   * thôi thu hẹp bảng (lọc client giả vờ chạy trên 20 dòng đang xem); `aria-sort` không lật;
   * hoặc cột Thao tác lẻn vào màn này.
   */
  test('Màn Đường truyền: đủ nút, đủ cột, ô tìm thu hẹp bảng thật, và KHÔNG có menu ba chấm', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await firstLogin(page, E2E_SA);

    const stamp = dauThoiGian();
    const maA = `ISP-E2E-PHONG-${stamp}-A`;
    const maB = `ISP-E2E-PHONG-${stamp}-B`;
    const headers = await writeHeaders(page);

    // Dàn cảnh bằng API — điều đang kiểm là HÌNH DẠNG của màn, không phải đường tạo hồ sơ.
    for (const [code, provider] of [
      [maA, 'Alpha Telecom E2E'],
      [maB, 'Zulu Telecom E2E'],
    ]) {
      const providerId = await ispProviderId(page, provider);
      const created = await page.request.post('/api/v1/isp-lines', {
        headers,
        data: { code, providerId, hotline: '18001166', contractNo: `HD-${stamp}` },
      });
      expect(created.status(), `Dàn cảnh: tạo đường truyền ${code} phải thành công`).toBe(201);
    }

    await page.goto('/isp-lines');
    await expect(page.getByRole('heading', { level: 1, name: /^Đường truyền$/ })).toBeVisible();

    const main = page.getByRole('main');
    const oTim = page.getByRole('searchbox', {
      name: 'Tìm theo mã, nhà mạng, IP WAN hoặc số hợp đồng',
    });

    /*
     * Ô TÌM PHẢI THU HẸP BẢNG THẬT.
     *
     * Gõ mã của lượt chạy này vào thì hai đường vừa tạo còn đúng hai — nghĩa là câu tìm đã đi
     * tới server, không phải lọc lại 20 dòng đang cầm trên tay.
     */
    await oTim.fill(`ISP-E2E-PHONG-${stamp}`);
    await expect(
      page.getByRole('row'),
      'Gõ mã của lượt chạy này thì bảng phải còn đúng 1 dòng tiêu đề + 2 đường truyền',
    ).toHaveCount(3);

    // ĐỦ CỘT, ĐÚNG THỨ TỰ. Cột rơi mất là một thông tin không ai còn đọc được trên danh sách.
    expect(
      await tenCotBang(main),
      'Bảng đường truyền phải có đúng 7 cột, đúng thứ tự của `isp-screen.tsx` — không có cột hạn (Q-04)',
    ).toEqual([
      'Mã đường',
      'Nhà mạng',
      'Site',
      'Thiết bị biên',
      'Hotline',
      'Số hợp đồng',
      'Trạng thái',
    ]);

    /*
     * SẮP XẾP LẬT `aria-sort`.
     *
     * `isp.spec.ts` đã kiểm THỨ TỰ DÒNG đổi đúng chiều. Thứ chưa ai kiểm là cái ô tiêu đề có
     * NÓI RA điều đó không: người dùng trình đọc màn hình không nhìn thấy mũi tên chevron, họ
     * chỉ nghe `aria-sort`. Thiếu nó thì bảng vẫn sắp đúng mà không ai biết nó đang sắp theo gì.
     */
    const cotMa = main.getByRole('columnheader').filter({ hasText: /^Mã đường$/ });
    const cotNhaMang = main.getByRole('columnheader').filter({ hasText: /^Nhà mạng$/ });
    await expect(
      cotMa,
      'Mở màn ra là đang sắp theo Mã đường tăng dần — cột đó phải tự khai `aria-sort`',
    ).toHaveAttribute('aria-sort', 'ascending');

    await main.getByRole('button', { name: 'Sắp xếp theo Nhà mạng' }).click();
    await expect(
      cotNhaMang,
      'Bấm sắp xếp theo Nhà mạng lần đầu phải thành tăng dần',
    ).toHaveAttribute('aria-sort', 'ascending');
    await expect(
      cotMa,
      'Sắp theo cột khác thì cột Mã đường phải về `aria-sort="none"` — hai cột cùng khai đang sắp là nói dối',
    ).toHaveAttribute('aria-sort', 'none');

    await main.getByRole('button', { name: 'Sắp xếp theo Nhà mạng' }).click();
    await expect(cotNhaMang, 'Bấm lần hai phải lật xuống giảm dần').toHaveAttribute(
      'aria-sort',
      'descending',
    );

    /*
     * ĐÚNG BỘ NÚT — thu hẹp còn MỘT dòng trước đã, để phần phân trang có hình dạng cố định.
     *
     * Đây là khẳng định trung tâm của bài: liệt kê HẾT nút trong vùng nội dung rồi so với bản
     * mong đợi. `toBeVisible()` từng cái chỉ bắt được nút mất đi; so cả tập bắt được cả nút
     * mọc thêm — và cột Thao tác mọc thêm ở đây là thứ bài này sinh ra để chặn.
     */
    await oTim.fill(maA);
    await expect(page.getByRole('row'), 'Lọc còn đúng một đường truyền').toHaveCount(2);

    expect(
      await tenTheoVaiTro(main, 'button'),
      'Màn Đường truyền phải có ĐÚNG bộ nút này — không thừa một cái nào',
    ).toEqual(
      sap([
        'Xuất Excel',
        'Thêm đường truyền',
        'Site',
        'Nhà mạng',
        'Trạng thái',
        'Sắp xếp theo Mã đường',
        'Sắp xếp theo Nhà mạng',
        'Sắp xếp theo Hotline',
        'Sắp xếp theo Số hợp đồng',
        'Sắp xếp theo Trạng thái',
        'Số dòng',
        'Trang trước',
        'Trang sau',
      ]),
    );

    // Nói thẳng ra điều vừa suy ra được từ tập hợp trên — để lúc đỏ đọc log là hiểu ngay.
    await expect(
      main.getByRole('button', { name: /^Thao tác với/ }),
      'Màn Đường truyền KHÔNG có cột Thao tác: sửa và thanh lý chỉ làm từ trang hồ sơ',
    ).toHaveCount(0);
  });

  /*
   * ===== BÀI 2 — BÊN TRONG HỘP "THÊM ĐƯỜNG TRUYỀN" =====
   *
   * VÌ SAO BÀI NÀY TỒN TẠI
   *
   * Một ô lặng lẽ rơi khỏi form là một trường KHÔNG BAO GIỜ được nhập nữa, và không có gì đỏ
   * lên: hồ sơ vẫn lưu được, API vẫn nhận, chỉ là từ hôm đó không ai khai số hợp đồng nữa. Bộ
   * E2E hiện có luôn `fill` đúng những ô nó cần rồi bấm Lưu, nên nó mù hoàn toàn với chuyện này.
   *
   * Bài này liệt kê HẾT ô trong hộp, theo ĐÚNG LOẠI tay nắm. Loại quan trọng ngang nội dung:
   * "Nhà mạng" và "Site" là `button` mở danh sách chọn, không phải ô gõ — nhầm vai nghĩa là
   * người dùng bàn phím thao tác khác hẳn điều ta tưởng.
   *
   * ĐỎ KHI: một ô rơi mất hoặc mọc thêm; một ô đổi loại tay nắm; ô Trạng thái (chỉ dành cho
   * lượt SỬA) lọt vào hộp thêm mới; lời báo lỗi đổi chữ; hoặc một trong hai đường đóng hộp
   * (Esc và ✕) thôi hoạt động.
   */
  test('Hộp "Thêm đường truyền": đủ ô, đúng loại tay nắm, chặn thiếu nhà mạng, đóng được cả hai đường', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await firstLogin(page, E2E_SA);

    const stamp = dauThoiGian();
    const ma = `ISP-E2E-HOP-${stamp}`;
    // Dàn cảnh TRƯỚC khi mở màn: ô chọn Nhà mạng đọc danh mục lúc nạp trang (Q-11).
    await ispProviderId(page, 'FPT E2E');

    await page.goto('/isp-lines');
    await page.getByRole('button', { name: 'Thêm đường truyền' }).click();

    const hop = page.getByRole('dialog', { name: 'Thêm đường truyền' });
    await expect(hop, 'Bấm "Thêm đường truyền" phải mở ra hộp thoại').toBeVisible();

    expect(
      await tenKhoiTrongHop(hop),
      'Hộp thêm đường truyền có đúng ba khối: Hồ sơ · Hợp đồng và liên hệ sự cố · Giấy tờ đính kèm',
    ).toEqual(sap([
      'Thêm đường truyền',
      'Hồ sơ',
      'Hợp đồng và liên hệ sự cố',
      'Giấy tờ đính kèm',
    ]));

    expect(
      await tenTheoVaiTro(hop, 'textbox'),
      'Sáu ô gõ chữ của hộp thêm đường truyền — thiếu một ô là một trường không ai khai nữa',
    ).toEqual(sap(['Mã đường', 'Băng thông', 'IP WAN', 'Hotline', 'Số hợp đồng', 'Ghi chú']));

    /*
     * Ô này là `combobox`, KHÔNG phải `textbox`: "Thiết bị biên" tra ngược vào kho thiết bị.
     * "Nhà mạng" KHÔNG còn ở đây — nó là khoá ngoại tới danh mục, chọn chứ không gõ (Q-11),
     * nên nằm trong bộ nút bên dưới.
     *
     * **ĐỔI 24/09 (F-06).** Trước đó ô tra thiết bị không có nhãn nối vào, nên tên khả truy cập
     * của nó rơi về `placeholder` — trình đọc màn hình đọc "Tìm thiết bị trong kho…" thay vì tên
     * của ô. Bản cũ của bài này khoá đúng hiện trạng ấy và ghi rõ là nó khoá một placeholder.
     * Nay `Field` tự nối `id` vào `Combobox`, nên tên là NHÃN thật: "Thiết bị biên".
     */
    expect(
      await tenTheoVaiTro(hop, 'combobox'),
      'Hộp có đúng một ô gợi ý: ô tra thiết bị biên',
    ).toEqual(sap(['Thiết bị biên']));

    /*
     * "Chọn file để đính kèm" nằm trong bộ NÚT chứ không phải bộ ô nhập, và đó là điều đúng:
     * `<input type="file">` được ánh xạ sang vai trò `button`, tên lấy từ `<label for>`. Nó
     * bị CSS thu về 1×1 px nhưng KHÔNG bị `visibility: hidden` — cố ý, để trình đọc màn hình
     * vẫn với tới được. Bỏ nó khỏi mảng này là bỏ luôn khả năng thấy khi khối giấy tờ rơi mất.
     */
    expect(
      await tenTheoVaiTro(hop, 'button'),
      'Bộ nút trong hộp thêm mới: ô chọn Nhà mạng, ô chọn Site, ô ngày Bắt đầu, ô chọn file, ' +
        '✕, Hủy, Lưu — không có ô Hết hạn vì đường truyền không có hạn (Q-04)',
    ).toEqual(
      sap([
        'Đóng hộp thoại',
        'Nhà mạng',
        // Nhà mạng mới khai ngay tại chỗ (SA/Admin) — không bắt huỷ form sang Danh mục.
        '+ Thêm vào danh mục',
        'Site',
        'Bắt đầu',
        'Chọn file để đính kèm',
        'Hủy',
        'Lưu',
      ]),
    );

    /*
     * Ô TRẠNG THÁI CHỈ CÓ Ở LƯỢT SỬA — nói thẳng ra, đừng để nó chìm trong tập hợp trên.
     * Bày một ô chọn có đúng một câu trả lời hợp lý ở lượt thêm mới là mở đường cho một hồ sơ
     * vừa tạo đã mang trạng thái "Thanh lý".
     */
    await expect(
      hop.getByRole('button', { name: 'Trạng thái', exact: true }),
      'Hộp THÊM MỚI không được có ô Trạng thái — hồ sơ mới luôn là "Đang dùng"',
    ).toHaveCount(0);

    /*
     * ĐƯỜNG HỎNG: có mã, thiếu nhà mạng (NET-023).
     *
     * Ô Nhà mạng là nút chọn — ô dễ rơi nhất. Câu lỗi tiếng Việt phải nằm dưới và nối vào
     * chính nút đó; form đặt `noValidate` nên không còn bong bóng tiếng Anh của trình duyệt.
     */
    await hop.getByRole('textbox', { name: 'Mã đường' }).fill(ma);
    await hop.getByTestId('dialog-footer').getByRole('button', { name: 'Lưu' }).click();

    await expect(
      hop.getByRole('button', { name: 'Nhà mạng', exact: true }),
      'Thiếu nhà mạng phải nói ra ngay dưới ô Nhà mạng, không phải im lặng',
    ).toHaveAccessibleDescription(/Bắt buộc — chưa chọn ô này\./);
    await expect(hop, 'Báo lỗi thì hộp phải Ở LẠI để người dùng sửa, không được đóng').toBeVisible();

    // ĐƯỜNG ĐÓNG THỨ NHẤT: phím Esc.
    /* Form đã gõ dở, nên từ 12/09 lối đóng TÌNH CỜ phải hỏi lại trước
       (`Dialog guardUnsaved`, rà UI/UX #10) — trả lời xong mới đóng. */
    await page.keyboard.press('Escape');
    await confirmAction(page, 'Bỏ và đóng');
    await expect(hop, 'Esc phải đóng được hộp khi chưa có lượt ghi nào đang chạy').toHaveCount(0);

    // ĐƯỜNG ĐÓNG THỨ HAI: nút ✕. Hai đường, hai đoạn code khác nhau — kiểm cả hai.
    await page.getByRole('button', { name: 'Thêm đường truyền' }).click();
    const hopLan2 = page.getByRole('dialog', { name: 'Thêm đường truyền' });
    await hopLan2.getByRole('button', { name: 'Đóng hộp thoại' }).click();
    await expect(hopLan2, 'Nút ✕ phải đóng được hộp').toHaveCount(0);

    // Và cuối cùng: khai đủ thì hộp đóng, dòng mới nằm ngay trên bảng.
    await page.getByRole('button', { name: 'Thêm đường truyền' }).click();
    const hopLan3 = page.getByRole('dialog', { name: 'Thêm đường truyền' });
    await hopLan3.getByRole('textbox', { name: 'Mã đường' }).fill(ma);
    await hopLan3.getByRole('button', { name: 'Nhà mạng' }).click();
    await page.getByRole('option', { name: 'FPT E2E', exact: true }).click();
    await hopLan3.getByTestId('dialog-footer').getByRole('button', { name: 'Lưu' }).click();

    await expect(page.getByText('Đã lưu hồ sơ đường truyền.')).toBeVisible();
    await expect(
      page.getByRole('row', { name: new RegExp(ma) }),
      'Khai đủ mã và nhà mạng thì đường truyền phải xuất hiện ngay trên danh sách',
    ).toBeVisible();
  });

  /*
   * ===== BÀI 3 — HỒ SƠ ĐƯỜNG TRUYỀN: MỖI TAB CÓ GÌ, VÀ HỘP SỬA CỦA NÓ =====
   *
   * VÌ SAO BÀI NÀY TỒN TẠI
   *
   * Trang hồ sơ đường truyền là trang mở ra lúc 2 giờ sáng khi đứt cáp. Bốn tab của nó là bốn
   * nguồn dữ liệu KHÁC NHAU (hồ sơ, két sắt, giấy tờ, lịch sử) và ba trong bốn chỉ được nạp
   * khi bấm vào tab — nghĩa là ba nhánh code gần như không bao giờ chạy trong bộ E2E hiện tại.
   *
   * Bài này vào bằng cách BẤM từ danh sách (không `goto`): đường `PATHS.ispLine(id)` ghép sai
   * thì không bài nào khác đỏ, vì mọi bài khác tự gõ URL đúng.
   *
   * Đường truyền không có hạn (Q-04): không nút Gia hạn, không thanh thời hạn, không ô Hết
   * hạn trong form Sửa. Bài này khoá cả ba vế vắng mặt đó.
   *
   * ĐỎ KHI: link mã trên bảng trỏ sai; một nút đầu trang hồ sơ mất/mọc thêm; một tab biến mất;
   * một tab mở ra khoảng trắng; cái gì đó về hạn quay lại; hoặc form Sửa hiện ra TRỐNG (kiểu
   * hỏng ghi đè sạch dữ liệu cũ ngay khi bấm Lưu).
   */
  test('Hồ sơ đường truyền: bấm từ danh sách, đủ nút và đủ tab, không có gì về hạn, mở hộp Sửa', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await firstLogin(page, E2E_SA);

    const stamp = dauThoiGian();
    const ma = `ISP-E2E-TAB-${stamp}`;
    const ghiChu = `Ghi chú E2E cho ${ma}`;
    const created = await page.request.post('/api/v1/isp-lines', {
      headers: await writeHeaders(page),
      data: {
        code: ma,
        providerId: await ispProviderId(page, 'VNPT E2E'),
        bandwidth: '100 Mbps',
        wanIp: '203.113.99.9',
        hotline: '18001166',
        contractNo: `HD-E2E-${stamp}`,
        startDate: '2026-01-01',
        note: ghiChu,
      },
    });
    expect(created.status(), 'Dàn cảnh: tạo đường truyền đầy đủ trường phải thành công').toBe(201);

    await page.goto('/isp-lines');
    await timVaChoLoc(page, ma);

    // BẤM vào mã — không `goto`. Đây chính là sợi dây mà mọi bài kiểm khác đi vòng qua.
    await page.getByRole('main').getByRole('link', { name: ma, exact: true }).click();

    await expect(
      page.getByRole('heading', { level: 1, name: new RegExp(ma) }),
      'Bấm mã trên danh sách phải mở đúng hồ sơ đường truyền đó',
    ).toBeVisible();
    expect(
      new URL(page.url()).pathname,
      'Đường dẫn phải là /isp-lines/<id>, không phải một đường ghép sai',
    ).toMatch(/^\/isp-lines\/[0-9a-f-]{36}$/);
    await expect(
      page.getByRole('navigation', { name: 'breadcrumb' }).getByRole('link', {
        name: 'Đường truyền',
        exact: true,
      }),
      'Trang hồ sơ phải có đúng một đường quay ra: mục đầu của breadcrumb',
    ).toBeVisible();

    const main = page.getByRole('main');

    /*
     * ĐÚNG BỘ NÚT ĐẦU TRANG. Hai cái, không hơn:
     *   - "Chép IP tĩnh" (nằm ở dòng định danh, chỉ vẽ khi hồ sơ có IP WAN),
     *   - "Sửa hồ sơ" ở góc phải. KHÔNG có "Gia hạn hợp đồng" — line không có hạn (Q-04).
     * Mã hồ sơ CỐ Ý không có nút chép — nó là tiêu đề, bôi đen chép như mọi chữ khác. Tập hợp
     * này giữ đúng quyết định đó.
     */
    expect(
      await tenTheoVaiTro(main, 'button'),
      'Đầu trang hồ sơ đường truyền: Chép IP WAN · Sửa hồ sơ · menu ⋯ (đổi trạng thái) · Chép số hợp đồng (thẻ "Khi mất mạng")',
    ).toEqual(sap(['Chép IP WAN', 'Sửa hồ sơ', `Thao tác với ${ma}`, 'Chép số hợp đồng']));
    // Thẻ "Khi mất mạng": gọi hotline là MỘT cú chạm.
    await expect(main.getByRole('link', { name: 'Gọi 18001166' })).toHaveAttribute(
      'href',
      'tel:18001166',
    );

    /*
     * BỐN TAB, ĐÚNG THỨ TỰ. Nhãn hai tab giữa có số đếm nối sau ("Két sắt 0"), nên cắt phần số
     * đi rồi mới so — thứ đang kiểm là DANH SÁCH TAB, không phải con số của lượt chạy này.
     */
    const tenTab = (await page.getByRole('tab').allTextContents()).map((raw) =>
      gonNhan(raw).replace(/\s+\d+$/, ''),
    );
    expect(
      tenTab,
      'Hồ sơ đường truyền phải có đúng bốn tab, đúng thứ tự: Hồ sơ · Két sắt · Giấy tờ · Lịch sử',
    ).toEqual(['Hồ sơ', 'Két sắt', 'Giấy tờ', 'Lịch sử']);

    /** Mỗi tab kèm MỘT dấu hiệu chỉ tab đó mới có — để "bấm sang tab khác" không thể xanh nhầm. */
    const dauHieuTab: { ten: RegExp; dauHieu: () => Promise<void> }[] = [
      {
        ten: /^Hồ sơ$/,
        dauHieu: async () => {
          /* Thẻ định danh ở cột phải hiện ngày bắt đầu, và KHÔNG còn thanh thời hạn: đường
             truyền không có hạn (Q-04). */
          const the = page.getByRole('region', { name: 'Thẻ định danh' });
          await expect(
            the.getByText('Bắt đầu', { exact: true }),
            'Thẻ định danh phải hiện ngày bắt đầu đã khai',
          ).toBeVisible();
          await expect(
            the.getByRole('progressbar'),
            'Không còn thanh thời hạn hợp đồng — line không có hạn',
          ).toHaveCount(0);
          await expect(
            main.getByText(ghiChu, { exact: true }),
            'Tab Hồ sơ phải hiện lại đúng ghi chú đã khai',
          ).toBeVisible();
        },
      },
      {
        ten: /^Két sắt/,
        dauHieu: async () => {
          await expect(
            main.getByText(/Nơi cất mật khẩu và license key/),
            'Tab Két sắt phải mở ra panel két, không phải khoảng trắng',
          ).toBeVisible();
          await expect(
            main.getByRole('button', { name: 'Cất mật khẩu/khóa' }),
            'SA cất được mật khẩu PPPoE của đường truyền — nút phải có mặt',
          ).toBeVisible();
        },
      },
      {
        ten: /^Giấy tờ/,
        dauHieu: async () => {
          await expect(
            main.getByText('Chưa có giấy tờ nào.'),
            'Đường truyền mới khai thì tab Giấy tờ phải nói rõ là trống',
          ).toBeVisible();
          await expect(
            main.getByRole('button', { name: 'Chọn file để đính kèm' }),
            'Tab Giấy tờ phải có đường đính kèm bản scan hợp đồng',
          ).toBeVisible();
        },
      },
      {
        ten: /^Lịch sử$/,
        dauHieu: async () => {
          await expect(
            main.getByRole('listitem').filter({ hasText: 'Tạo hồ sơ' }),
            'Tab Lịch sử phải có sẵn dòng "Tạo hồ sơ" — mọi hồ sơ đều sinh ra từ một lượt ghi',
          ).toBeVisible();
        },
      },
    ];

    for (const tab of dauHieuTab) {
      const nut = page.getByRole('tab', { name: tab.ten });
      await nut.click();
      await expect(nut, `Bấm tab ${tab.ten} thì chính nó phải sáng lên`).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await tab.dauHieu();
    }

    /*
     * ===== HỘP "SỬA HỒ SƠ" — GIÁ TRỊ PHẢI ĐIỀN SẴN =====
     *
     * Form sửa hiện ra trống là kiểu hỏng tệ nhất trong nhóm này: nó không báo lỗi gì cả, chỉ
     * lặng lẽ gửi chuỗi rỗng đè lên mọi trường ngay khi người dùng bấm Lưu.
     */
    await page.getByRole('button', { name: 'Sửa hồ sơ' }).click();
    const hopSua = page.getByRole('dialog', { name: new RegExp(`^Sửa hồ sơ — ${ma}$`) });
    await expect(hopSua).toBeVisible();

    for (const [nhan, giaTri] of [
      ['Mã đường', ma],
      ['Băng thông', '100 Mbps'],
      ['IP WAN', '203.113.99.9'],
      ['Hotline', '18001166'],
      ['Số hợp đồng', `HD-E2E-${stamp}`],
      ['Ghi chú', ghiChu],
    ]) {
      await expect(
        hopSua.getByRole('textbox', { name: nhan, exact: true }),
        `Ô "${nhan}" của form Sửa phải mang sẵn giá trị cũ, không được trống`,
      ).toHaveValue(giaTri);
    }
    await expect(
      hopSua.getByRole('button', { name: 'Nhà mạng' }),
      'Ô Nhà mạng cũng phải chọn sẵn — nó là ô BẮT BUỘC, trống là lưu không nổi',
    ).toContainText('VNPT E2E');
    await expect(
      hopSua.getByRole('button', { name: 'Bắt đầu' }),
      'Ô ngày bắt đầu phải hiện lại năm 2026 đã khai',
    ).toContainText('2026');
    await expect(
      hopSua.getByRole('button', { name: 'Hết hạn' }),
      'Form Sửa không còn ô Hết hạn — đường truyền không có hạn (Q-04)',
    ).toHaveCount(0);

    /*
     * Ô Trạng thái CHỈ có ở lượt sửa, và nó có đúng ba lựa chọn.
     * Các option `portal` ra khỏi locator của hộp, nên phải hỏi ở tầng `page`.
     */
    await hopSua.getByRole('button', { name: 'Trạng thái', exact: true }).click();
    expect(
      (await page.getByRole('option').allTextContents()).map(gonNhan),
      'Trạng thái đường truyền có đúng ba giá trị của `ISP_STATUSES`',
    ).toEqual(['Đang dùng', 'Tạm ngưng', 'Đã thanh lý']);

    /*
     * ĐÓNG DANH SÁCH bằng cách bấm lại chính ô chọn, rồi đóng hộp bằng nút ✕.
     *
     * CỐ Ý KHÔNG dùng Esc ở đây, và đây là một PHÁT HIỆN chứ không phải một lối tránh: Esc lúc
     * đang mở ô chọn đóng LUÔN cả hộp Sửa, ném đi cả form đang gõ dở. Bài `test.fixme` ngay
     * dưới khối này giữ nguyên khẳng định đúng và nói rõ vì sao phần mềm chưa làm được.
     */
    await hopSua.getByRole('button', { name: 'Trạng thái', exact: true }).click();
    await expect(
      page.getByRole('option'),
      'Bấm lại vào ô chọn thì danh sách phải thu lại',
    ).toHaveCount(0);
    await expect(hopSua, 'Đóng danh sách chọn thì hộp Sửa vẫn phải còn đó').toBeVisible();

    await hopSua.getByRole('button', { name: 'Đóng hộp thoại' }).click();
    await expect(hopSua, 'Nút ✕ phải đóng được hộp Sửa').toHaveCount(0);
  });

  /*
   * ===== BÀI 3b — Esc TRONG Ô CHỌN CHỈ ĐƯỢC ĐÓNG Ô CHỌN =====
   *
   * VÌ SAO BÀI NÀY TỒN TẠI: lượt chạy đầu của khối này bắt được đúng một lỗi phần mềm, và
   * bài này là hàng rào giữ cho nó không quay lại.
   *
   * ĐO ĐƯỢC (10/09): mở hồ sơ đường truyền → "Sửa hồ sơ" → bấm ô chọn Trạng thái → gõ Esc.
   * Danh sách chọn không đóng một mình: CẢ HỘP Sửa biến mất, mang theo mọi ô vừa gõ. Người
   * dùng bàn phím gõ Esc để bỏ một menu vừa lỡ bung ra thì mất trắng lần nhập.
   *
   * NGUYÊN NHÂN, đã truy tới tận nơi:
   *   - `ui/select.tsx` và `ui/combobox.tsx` bắt Esc bằng `onKeyDown` của React rồi gọi
   *     `e.stopPropagation()` — chú thích ở `combobox.tsx` nói thẳng ý định: "đóng menu tại
   *     chỗ — KHÔNG để Escape lan lên đóng cả modal".
   *   - Nhưng Radix (`@radix-ui/react-dismissable-layer`) nghe `keydown` ở `document` với
   *     `capture: true`. Pha BẮT chạy xong trước khi sự kiện kịp bò tới handler của React,
   *     nên tới lượt ô chọn thì hộp đã đóng rồi. Một dòng `stopPropagation` trông rất hợp lý
   *     mà hoàn toàn vô hiệu.
   *   - Bản vá nằm ở `ui/dialog.tsx`: chặn tại `onEscapeKeyDown` — chỗ DUY NHẤT Radix hỏi ý
   *     trước khi đóng — và nhận ra "đang có popover mở" bằng việc điểm neo portal có con.
   *
   * ĐỎ KHI: bản vá đó bị gỡ, hoặc một hộp thoại nào đó thôi đi qua `ui/dialog.tsx`.
   */
  test('Esc khi đang mở ô chọn chỉ đóng ô chọn, KHÔNG đóng cả hộp Sửa', async ({ page }) => {
    test.setTimeout(150_000);
    await firstLogin(page, E2E_SA);

    const stamp = dauThoiGian();
    const ma = `ISP-E2E-ESC-${stamp}`;
    const created = await page.request.post('/api/v1/isp-lines', {
      headers: await writeHeaders(page),
      data: { code: ma, providerId: await ispProviderId(page, 'VNPT E2E') },
    });
    expect(created.status(), 'Dàn cảnh: tạo một đường truyền để mở form Sửa').toBe(201);
    const id = ((await created.json()) as { id: string }).id;

    await page.goto(`/isp-lines/${id}`);
    await page.getByRole('button', { name: 'Sửa hồ sơ' }).click();
    const hopSua = page.getByRole('dialog', { name: new RegExp(`^Sửa hồ sơ — ${ma}$`) });
    await expect(hopSua).toBeVisible();

    // Gõ dở một ô, để chỗ mất mát nhìn thấy được chứ không chỉ là "hộp biến mất".
    await hopSua.getByRole('textbox', { name: 'Ghi chú', exact: true }).fill('đang gõ dở E2E');

    await hopSua.getByRole('button', { name: 'Trạng thái', exact: true }).click();
    await expect(page.getByRole('option'), 'Ô chọn phải bung ra danh sách').toHaveCount(3);

    await page.keyboard.press('Escape');

    await expect(page.getByRole('option'), 'Esc phải đóng danh sách chọn').toHaveCount(0);
    await expect(
      hopSua,
      'Esc chỉ được đóng DANH SÁCH CHỌN — đóng luôn cả hộp là ném đi cả form đang gõ dở',
    ).toBeVisible();
    await expect(
      hopSua.getByRole('textbox', { name: 'Ghi chú', exact: true }),
      'Chữ đang gõ dở phải còn nguyên sau khi bỏ danh sách chọn',
    ).toHaveValue('đang gõ dở E2E');

    /*
     * ===== VÀ CÚ ESC THỨ HAI: KHÔNG CÒN MENU NÀO, NHƯNG VẪN CÒN CHỮ ĐANG GÕ (12/09, #10) =====
     *
     * Tới 12/09 cú Esc này đóng thẳng hộp và ném đi cả form — `dismissible={!save.isPending}`
     * chỉ chặn lúc lượt ghi ĐANG BAY, còn trước khi bấm Lưu thì không có hàng rào nào. Mười
     * form trong repo như vậy, nặng nhất là form Thiết bị với 15 ô.
     *
     * Nay `Dialog guardUnsaved` so chữ ký các ô nhập với ảnh chụp lúc mở hộp. Hai vế phải đi
     * đôi, và vế thứ hai (ở dưới) mới là vế giữ cho cửa này có nghĩa: hỏi lại ở MỌI lần đóng
     * cũng làm vế thứ nhất xanh, mà đó là bản tệ hơn — người dùng sẽ học cách bấm "Bỏ và đóng"
     * theo phản xạ, rồi bấm nó cả vào hôm có dữ liệu thật.
     */
    await page.keyboard.press('Escape');
    await expect(
      page.getByRole('dialog', { name: 'Bỏ những gì vừa nhập?' }),
      'còn chữ đang gõ mà Esc đóng thẳng là ném đi công sức người dùng, không hỏi một câu',
    ).toBeVisible();

    /*
     * KHÔNG khẳng định `hopSua` còn nhìn thấy Ở ĐÂY, dù nó vẫn nằm nguyên trong DOM.
     *
     * Radix đánh `aria-hidden` lên mọi thứ phía sau một modal đang mở — đúng chuẩn, để trình
     * đọc màn hình không lạc ra ngoài lớp trên cùng. Mà `aria-hidden` thì biến mất khỏi CÂY
     * TRỢ NĂNG, nên `getByRole('dialog')` không còn tìm ra nó. Một khẳng định ở đây sẽ đỏ vì
     * lý do chẳng liên quan gì tới thứ bài này muốn bảo vệ.
     *
     * Vế "hộp gốc sống sót" được chốt ngay bên dưới, SAU khi lớp trên đóng lại — lúc đó nó
     * trở lại cây trợ năng, và câu trả lời mới có nghĩa.
     */

    // Chọn "Ở lại nhập tiếp" → hộp gốc còn, và chữ vẫn y nguyên.
    await page.getByTestId('dialog-footer').last().getByRole('button').first().click();
    await expect(hopSua).toBeVisible();
    await expect(
      hopSua.getByRole('textbox', { name: 'Ghi chú', exact: true }),
    ).toHaveValue('đang gõ dở E2E');

    /*
     * VẾ ĐỐI CHỨNG: xoá về đúng như lúc mở hộp thì KHÔNG còn gì để mất, và Esc phải đóng
     * thẳng như mọi hộp khác. Thiếu vế này thì một bản vá chặn Esc vô điều kiện vẫn xanh.
     */
    await hopSua.getByRole('textbox', { name: 'Ghi chú', exact: true }).fill('');
    await page.keyboard.press('Escape');
    await expect(
      page.getByRole('dialog', { name: 'Bỏ những gì vừa nhập?' }),
      'không còn gì khác lúc mở hộp thì hỏi lại là báo động giả',
    ).toHaveCount(0);
    await expect(hopSua, 'và lúc đó Esc phải đóng hộp như cũ').toBeHidden();
  });

  /*
   * ===== BÀI 4 — MÀN VÀ HỒ SƠ TÀI KHOẢN DỊCH VỤ =====
   *
   * VÌ SAO BÀI NÀY TỒN TẠI
   *
   * Menu ba chấm của màn này ĐỔI THEO TRẠNG THÁI: tài khoản đang dùng có "Vô hiệu hóa", tài
   * khoản đã đóng có "Bật lại". `service-accounts.spec.ts` mới chỉ kiểm rằng sau khi đóng thì
   * mục "Vô hiệu hóa" biến đi (`not.toContain`) — nó KHÔNG nói gì về việc mục "Bật lại" có
   * thật sự mọc ra hay không. Một menu rỗng đi ở nhánh đó thì hồ sơ đã đóng là đóng vĩnh viễn
   * với người dùng giao diện, và không bài nào đỏ.
   *
   * Phần cuối bài đổi vai sang Thành viên: `RowActions` cố ý KHÔNG vẽ nút khi không có việc
   * nào làm được, và cả cột Thao tác cũng biến mất. Bài cũ chỉ kiểm nút "Thêm tài khoản" vắng
   * mặt — ở đây kiểm cả bộ nút, tức là kiểm luôn rằng không còn ba chấm nào sót lại.
   *
   * ĐỎ KHI: menu dòng thiếu/thừa mục ở một trong hai trạng thái; cột Thao tác lọt vào màn của
   * Thành viên; trang hồ sơ thiếu/thừa nút (chép, "Sửa hồ sơ", ba chấm đổi theo trạng thái); hoặc
   * nút "Chép tên đăng nhập" rơi mất.
   */
  test('Tài khoản dịch vụ: menu dòng đúng ở cả hai trạng thái, hồ sơ có Chép · Sửa hồ sơ · ba chấm, Thành viên không thấy ba chấm', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await firstLogin(page, E2E_SA);

    const stamp = dauThoiGian();
    const maDangDung = `TK-E2E-PHONG-${stamp}-A`;
    const maDaDong = `TK-E2E-PHONG-${stamp}-B`;
    const headers = await writeHeaders(page);

    const tao = async (code: string, login: string): Promise<string> => {
      const res = await page.request.post('/api/v1/service-accounts', {
        headers,
        data: { code, kind: 'shared', name: `Tài khoản ${code}`, login },
      });
      expect(res.status(), `Dàn cảnh: tạo tài khoản ${code}`).toBe(201);
      return ((await res.json()) as { id: string }).id;
    };

    await tao(maDangDung, 'e2e-dang-dung@pmh.com.vn');
    const idDaDong = await tao(maDaDong, 'e2e-da-dong@pmh.com.vn');
    expect(
      (
        await page.request.patch(`/api/v1/service-accounts/${idDaDong}/disable`, {
          headers,
          data: { reason: 'dàn cảnh cho bài đi khắp giao diện' },
        })
      ).status(),
      'Dàn cảnh: đóng sẵn một tài khoản để có đủ HAI trạng thái trên cùng một màn',
    ).toBe(200);

    await page.goto('/service-accounts');
    const oTim = page.getByRole('searchbox', { name: 'Tìm theo mã, tên, đăng nhập, bộ phận…' });
    await oTim.fill(`TK-E2E-PHONG-${stamp}`);
    await expect(page.getByRole('row'), 'Lọc còn đúng hai tài khoản của lượt chạy này').toHaveCount(
      3,
    );

    /*
     * MENU DÒNG Ở HAI TRẠNG THÁI — khẳng định trung tâm của bài.
     * "Vô hiệu hóa" mang cờ `danger` nên `RowActions` luôn xếp nó XUỐNG CUỐI; "Bật lại" thì
     * không, nên thứ tự hai mục giữ nguyên như lúc khai. Cả thứ tự cũng được chốt ở đây, vì
     * nó là lời hứa về trí nhớ cơ bắp: mục cuối cùng luôn là mục phải nghĩ trước khi bấm.
     */
    expect(
      (await rowActionNames(page, maDangDung)).map(gonNhan),
      'Tài khoản ĐANG DÙNG có đúng hai việc: Sửa, rồi Vô hiệu hóa (việc nguy hiểm xếp cuối)',
    ).toEqual(['Sửa', 'Ngừng dùng']);
    expect(
      (await rowActionNames(page, maDaDong)).map(gonNhan),
      'Tài khoản ĐÃ ĐÓNG phải có đường mở lại — thiếu nó là hồ sơ đóng vĩnh viễn với giao diện',
    ).toEqual(['Sửa', 'Dùng lại']);

    // Bộ nút và bộ cột đầy đủ của vai SA — thu hẹp còn một dòng cho phần phân trang cố định.
    await oTim.fill(maDangDung);
    await expect(page.getByRole('row')).toHaveCount(2);
    const main = page.getByRole('main');

    expect(
      await tenCotBang(main),
      'Bảng tài khoản dịch vụ của SA có đúng 6 cột, cột cuối là Thao tác',
    ).toEqual(['Mã tài khoản', 'Loại', 'Tên đăng nhập', 'Thuộc về', 'Trạng thái', 'Thao tác']);
    expect(
      await tenTheoVaiTro(main, 'button'),
      'Bộ nút của màn Tài khoản dịch vụ khi đăng nhập bằng SA',
    ).toEqual(
      sap([
        'Xuất Excel',
        'Thêm tài khoản',
        'Loại',
        'Trạng thái',
        'Sắp theo',
        'Sắp xếp theo Mã tài khoản',
        'Sắp xếp theo Loại',
        'Sắp xếp theo Trạng thái',
        `Thao tác với ${maDangDung}`,
        'Số dòng',
        'Trang trước',
        'Trang sau',
      ]),
    );

    /*
     * ===== TRANG HỒ SƠ =====
     * Vào bằng cách BẤM mã. SA/Admin sửa và đóng được NGAY tại đây ("Sửa hồ sơ" + ba chấm),
     * không phải quay ra danh sách tìm lại dòng. Nút chép tên đăng nhập vẫn phải có — thứ
     * người ta dán thẳng vào ô đăng nhập và gõ tay thì sai.
     */
    await main.getByRole('link', { name: maDangDung, exact: true }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: new RegExp(maDangDung) }),
    ).toBeVisible();
    expect(new URL(page.url()).pathname).toMatch(/^\/service-accounts\/[0-9a-f-]{36}$/);

    expect(
      await tenTheoVaiTro(page.getByRole('main'), 'button'),
      'Hồ sơ tài khoản dịch vụ của SA: Chép tên đăng nhập, Sửa hồ sơ và ba chấm',
    ).toEqual(sap(['Chép tên đăng nhập', 'Sửa hồ sơ', `Thao tác với ${maDangDung}`]));
    await page.getByRole('button', { name: `Thao tác với ${maDangDung}` }).click();
    await expect(
      page.getByRole('menuitem'),
      'ba chấm của hồ sơ đang dùng chỉ có việc đóng nó',
    ).toHaveText(['Ngừng dùng…']);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);

    const tenTab = (await page.getByRole('tab').allTextContents()).map((raw) =>
      gonNhan(raw).replace(/\s+\d+$/, ''),
    );
    expect(
      tenTab,
      'Hồ sơ tài khoản dịch vụ có đúng bốn tab như hồ sơ đường truyền',
    ).toEqual(['Hồ sơ', 'Két sắt', 'Giấy tờ', 'Lịch sử']);

    for (const [ten, dauHieu] of [
      [/^Hồ sơ$/, page.getByText('Chưa khai:')],
      [/^Két sắt/, page.getByText(/Nơi cất mật khẩu và license key/)],
      [/^Giấy tờ/, page.getByText('Chưa có giấy tờ nào.')],
      [/^Lịch sử$/, page.getByRole('listitem').filter({ hasText: 'Tạo hồ sơ' })],
    ] as [RegExp, Locator][]) {
      const nut = page.getByRole('tab', { name: ten });
      await nut.click();
      await expect(nut, `Bấm tab ${ten} thì chính nó phải sáng lên`).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await expect(dauHieu, `Tab ${ten} phải mở ra nội dung riêng của nó`).toBeVisible();
    }

    /*
     * ===== ĐỔI VAI: THÀNH VIÊN =====
     * Ghi chỉ SA/Admin. Giao diện không được bày nút ra để bấm rồi mới 403 — kể cả cái nút ba
     * chấm chỉ dẫn tới hai việc đều bị chặn.
     */
    await logout(page);
    await firstLogin(page, E2E_MEMBER);
    await page.goto('/service-accounts');
    await page
      .getByRole('searchbox', { name: 'Tìm theo mã, tên, đăng nhập, bộ phận…' })
      .fill(maDangDung);
    await expect(page.getByRole('row')).toHaveCount(2);

    const mainMember = page.getByRole('main');
    expect(
      await tenCotBang(mainMember),
      'Thành viên KHÔNG thấy cột Thao tác — cột đó chỉ dựng khi có quyền ghi',
    ).toEqual(['Mã tài khoản', 'Loại', 'Tên đăng nhập', 'Thuộc về', 'Trạng thái']);
    expect(
      await tenTheoVaiTro(mainMember, 'button'),
      'Bộ nút của Thành viên: không có "Thêm tài khoản", không có một nút ba chấm nào (Xuất Excel thì có — file không chứa mật khẩu)',
    ).toEqual(
      sap([
        'Xuất Excel',
        'Loại',
        'Trạng thái',
        'Sắp theo',
        'Sắp xếp theo Mã tài khoản',
        'Sắp xếp theo Loại',
        'Sắp xếp theo Trạng thái',
        'Số dòng',
        'Trang trước',
        'Trang sau',
      ]),
    );
  });

  /*
   * ===== BÀI 5 — BÊN TRONG HAI CÁI HỘP CỦA TÀI KHOẢN DỊCH VỤ =====
   *
   * VÌ SAO BÀI NÀY TỒN TẠI
   *
   * Form tài khoản dịch vụ là form DUY NHẤT trong phòng này ĐỔI HÌNH giữa chừng: chọn loại
   * "Tài khoản VPN" thì mọc thêm cả một khối gồm Nhóm VPN và Dải IP được phép; chọn lại "dùng
   * chung" thì khối đó biến đi VÀ hai ô vừa gõ bị xóa. `service-accounts.spec.ts` có bấm qua
   * nhánh VPN, nhưng chỉ để điền hai ô rồi lưu — nó không hỏi "trước khi đổi loại thì form có
   * những ô nào", nên nếu hai ô VPN lỡ hiện ra với CẢ tài khoản dùng chung thì không gì đỏ.
   *
   * Hộp "Vô hiệu hóa" soi ở đây vì đường hỏng của nó chưa từng đi qua giao diện: bài cũ gọi
   * thẳng API với lý do rỗng. Trên màn hình, thứ chặn lại là `required` của HTML — không có
   * `role="alert"` nào cả, và đó là điều phải ghi ra đúng như thật.
   *
   * ĐỎ KHI: một ô rơi khỏi form ở một trong hai loại; hai ô VPN rò sang loại dùng chung; ô Mật
   * khẩu đổi thành ô chữ thường (giá trị hiện nguyên trên màn hình); ô Trạng thái thành ô chọn
   * được (cửa sau lách qua đường bắt-ghi-lý-do); hoặc hộp Vô hiệu hóa cho đóng tài khoản mà
   * không cần lý do.
   */
  test('Hộp "Thêm tài khoản" đổi hình theo loại, và hộp "Vô hiệu hóa" không cho bỏ trống lý do', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await firstLogin(page, E2E_SA);

    const stamp = dauThoiGian();
    const ma = `TK-E2E-HOP-${stamp}`;

    await page.goto('/service-accounts');
    await page.getByRole('button', { name: 'Thêm tài khoản' }).click();
    const hop = page.getByRole('dialog', { name: 'Thêm tài khoản' });
    await expect(hop).toBeVisible();

    /**
     * Ô gõ chữ của loại "dùng chung" — chưa có Nhóm VPN và Dải IP.
     *
     * "Mật khẩu" NẰM TRONG mảng này: `input[type=password]` được ánh xạ sang vai trò `textbox`
     * y như một ô chữ thường (cây trợ năng không có vai trò riêng cho ô mật khẩu). Nghĩa là
     * thứ DUY NHẤT ngăn mật khẩu hiện nguyên hình trên màn hình một phòng làm việc chung là
     * thuộc tính `type` — nên nó được kiểm riêng ngay dưới đây.
     */
    const O_CHUNG = [
      'Tên đăng nhập',
      'Mã tài khoản',
      'Tên tài khoản',
      'Người phụ trách',
      'Mật khẩu',
      'Ghi chú',
    ];

    expect(
      await tenKhoiTrongHop(hop),
      'Hộp thêm tài khoản dùng chung có năm khối — CHƯA có khối Cấu hình VPN',
    ).toEqual(
      sap([
        'Thêm tài khoản',
        'Hồ sơ',
        'Thuộc về ai',
        'Mật khẩu (cất vào két luôn)',
        /* Khu Ghi chú KHÔNG còn tiêu đề riêng: nó chỉ có một ô, mà nhãn ô cũng là
           "Ghi chú" — hai dòng y hệt chồng nhau (rà UI/UX 12/09, mục #35). */
        'Giấy tờ đính kèm',
      ]),
    );
    expect(
      await tenTheoVaiTro(hop, 'textbox'),
      'Loại "dùng chung" có đúng sáu ô gõ chữ — hai ô VPN không được rò sang đây',
    ).toEqual(sap(O_CHUNG));
    expect(
      await tenTheoVaiTro(hop, 'combobox'),
      'Bộ phận là ô GỢI Ý (gõ tự do được), không phải ô chọn cứng',
    ).toEqual(['Bộ phận']);
    expect(
      await tenTheoVaiTro(hop, 'button'),
      'Hộp thêm tài khoản có đúng năm nút: ô chọn Loại, ô chọn file, ✕, Hủy, Lưu',
    ).toEqual(sap(['Đóng hộp thoại', 'Loại', 'Chọn file để đính kèm', 'Hủy', 'Lưu']));

    /*
     * Ô MẬT KHẨU: cây trợ năng KHÔNG phân biệt nó với một ô chữ thường.
     *
     * Nó nằm chung trong tập `textbox` ở trên, nên tập hợp đó một mình không đủ để nói "mật
     * khẩu vẫn được che". Thứ duy nhất che ký tự là thuộc tính `type`, và đổi một chữ ở đó là
     * mật khẩu hiện nguyên hình trên màn hình của một phòng làm việc chung — nên nó phải có
     * một khẳng định riêng.
     */
    const oMatKhau = hop.getByLabel('Mật khẩu', { exact: true });
    await expect(oMatKhau, 'Hộp thêm mới phải có ô cất mật khẩu thẳng vào két').toHaveCount(1);
    await expect(oMatKhau, 'Ô mật khẩu phải là ô che ký tự').toHaveAttribute('type', 'password');

    /*
     * KHÔNG có ô Trạng thái trong form — đổi trạng thái bắt buộc đi qua hộp riêng có ghi lý do.
     * (Tập hợp nút ở trên đã nói điều này; câu dưới nói ra thành lời.)
     */
    await expect(
      hop.getByRole('button', { name: 'Trạng thái', exact: true }),
      'Có ô chọn trạng thái ở đây là mở cửa sau cho lượt đóng không lý do',
    ).toHaveCount(0);
    await expect(hop.getByText('Trạng thái', { exact: true })).toHaveCount(0);

    /*
     * ===== ĐỔI LOẠI: HÌNH DẠNG PHẢI ĐỔI THEO =====
     */
    await hop.getByRole('button', { name: 'Loại', exact: true }).click();
    expect(
      (await page.getByRole('option').allTextContents()).map(gonNhan),
      'Tài khoản dịch vụ có đúng hai loại của `SERVICE_ACCOUNT_KINDS`',
    ).toEqual(['Tài khoản dùng chung', 'Tài khoản VPN']);
    await page.getByRole('option', { name: 'Tài khoản VPN', exact: true }).click();

    expect(
      await tenKhoiTrongHop(hop),
      'Chọn loại VPN thì khối "Cấu hình VPN" phải mọc ra',
    ).toEqual(
      sap([
        'Thêm tài khoản',
        'Hồ sơ',
        'Thuộc về ai',
        'Cấu hình VPN',
        'Mật khẩu (cất vào két luôn)',
        /* Khu Ghi chú KHÔNG còn tiêu đề riêng: nó chỉ có một ô, mà nhãn ô cũng là
           "Ghi chú" — hai dòng y hệt chồng nhau (rà UI/UX 12/09, mục #35). */
        'Giấy tờ đính kèm',
      ]),
    );
    expect(
      await tenTheoVaiTro(hop, 'textbox'),
      'Loại VPN có thêm đúng hai ô: Nhóm VPN và Dải IP được phép',
    ).toEqual(sap([...O_CHUNG, 'Nhóm VPN', 'Dải IP được phép']));

    // Đổi NGƯỢC lại: hai ô kia phải biến đi, không được nằm ẩn rồi vẫn gửi lên.
    await hop.getByRole('textbox', { name: 'Nhóm VPN' }).fill('vpn-e2e-ketoan');
    await hop.getByRole('button', { name: 'Loại', exact: true }).click();
    await page.getByRole('option', { name: 'Tài khoản dùng chung', exact: true }).click();
    expect(
      await tenTheoVaiTro(hop, 'textbox'),
      'Quay về loại dùng chung thì hai ô VPN phải biến mất — giữ lại là ghi ra dữ liệu vô nghĩa',
    ).toEqual(sap(O_CHUNG));

    /*
     * Ô BẮT BUỘC: bỏ trống hết rồi bấm Lưu.
     * Ô Tên đăng nhập bắt buộc khi ô Mã còn trống. Form đặt `noValidate` nên không còn bong bóng
     * tiếng Anh: câu tiếng Việt nằm dưới và nối vào chính ô đó, hộp KHÔNG đóng.
     */
    await hop.getByTestId('dialog-footer').getByRole('button', { name: 'Lưu' }).click();
    await expect(hop, 'Form trống mà bấm Lưu thì hộp phải ở lại').toBeVisible();
    expect(
      await hop
        .getByRole('textbox', { name: 'Tên đăng nhập' })
        .evaluate((el) => (el as HTMLInputElement).validity.valueMissing),
      'Chưa khai mã thì Tên đăng nhập là ô BẮT BUỘC — không có nó thì hồ sơ không có gì để gọi tên',
    ).toBe(true);
    await expect(
      hop.getByRole('textbox', { name: 'Tên đăng nhập' }),
      'và nói ra bằng tiếng Việt, ngay dưới ô',
    ).toHaveAccessibleDescription(/Nhập tên đăng nhập, hoặc tự đặt Mã bên dưới\./);

    await hop.getByRole('button', { name: 'Đóng hộp thoại' }).click();
    await expect(hop, 'Nút ✕ phải đóng được hộp thêm tài khoản').toHaveCount(0);

    /*
     * ===== HỘP "VÔ HIỆU HÓA" =====
     */
    const created = await page.request.post('/api/v1/service-accounts', {
      headers: await writeHeaders(page),
      data: { code: ma, kind: 'shared', name: 'Tài khoản kiểm hộp đóng', login: 'e2e-hop@pmh.com.vn' },
    });
    expect(created.status(), 'Dàn cảnh: tạo tài khoản để mở hộp Vô hiệu hóa').toBe(201);

    await page.goto('/service-accounts');
    await page.getByRole('searchbox', { name: 'Tìm theo mã, tên, đăng nhập, bộ phận…' }).fill(ma);
    await expect(page.getByRole('row')).toHaveCount(2);
    await rowAction(page, ma, 'Ngừng dùng');

    const hopDong = page.getByRole('dialog', { name: new RegExp(`^Ngừng dùng — ${ma}$`) });
    await expect(hopDong, 'Menu dòng phải mở ra hộp mang đúng mã tài khoản').toBeVisible();

    expect(
      await tenKhoiTrongHop(hopDong),
      'Hộp ngừng dùng không chia khối — chỉ có tiêu đề',
    ).toEqual([`Ngừng dùng — ${ma}`]);
    expect(
      await tenTheoVaiTro(hopDong, 'textbox'),
      'Hộp ngừng dùng có đúng MỘT ô: lý do. Không có ô nào khác để lách.',
    ).toEqual(['Lý do ngừng dùng']);
    expect(
      await tenTheoVaiTro(hopDong, 'button'),
      'Hộp ngừng dùng có đúng ba nút: ✕, Hủy, Ngừng dùng',
    ).toEqual(sap(['Đóng hộp thoại', 'Hủy', 'Ngừng dùng']));
    await expect(
      hopDong.getByText(/Tài khoản không bị xóa/),
      'Hộp phải nói rõ đóng ≠ xóa — người bấm đang quyết định một việc, không phải bấm cho xong',
    ).toBeVisible();

    // BỎ TRỐNG LÝ DO: không đi được. Sáu tháng sau sẽ có người hỏi "vì sao đóng".
    await hopDong.getByTestId('dialog-footer').getByRole('button', { name: 'Ngừng dùng' }).click();
    await expect(hopDong, 'Bỏ trống lý do thì hộp phải ở lại, không được đóng tài khoản').toBeVisible();
    expect(
      await hopDong
        .getByRole('textbox', { name: 'Lý do ngừng dùng' })
        .evaluate((el) => (el as HTMLInputElement).validity.valueMissing),
      'Ô lý do phải là ô BẮT BUỘC — đó là toàn bộ lý do hộp này tồn tại',
    ).toBe(true);
    await expect(
      hopDong.getByRole('textbox', { name: 'Lý do ngừng dùng' }),
      'Câu lỗi tiếng Việt dưới ô lý do, không phải bong bóng trình duyệt',
    ).toHaveAccessibleDescription('Bắt buộc — chưa nhập ô này.');
    // Gõ quá ngắn: `minLength` của trình duyệt không còn chặn (form `noValidate`) — hook phải nói.
    await hopDong.getByRole('textbox', { name: 'Lý do ngừng dùng' }).fill('ab');
    await expect(
      hopDong.getByRole('textbox', { name: 'Lý do ngừng dùng' }),
    ).toHaveAccessibleDescription('Cần ít nhất 3 ký tự.');

    // Ô lý do đã có chữ ('ab') nên Esc hỏi lại trước khi bỏ — đúng luật hộp có dữ liệu chưa lưu.
    await page.keyboard.press('Escape');
    await page.getByRole('dialog', { name: 'Bỏ những gì vừa nhập?' }).getByRole('button', { name: 'Bỏ và đóng' }).click();
    await expect(hopDong, 'Esc (rồi xác nhận bỏ) phải đóng được hộp vô hiệu hóa').toHaveCount(0);
    await expect(
      page.getByRole('row', { name: new RegExp(ma) }).getByText('Đang dùng'),
      'Hủy giữa chừng thì tài khoản phải còn nguyên trạng thái đang dùng',
    ).toBeVisible();
  });

  /*
   * ===== BÀI 6 — KHO THANH LÝ LÀ PHÒNG CHỈ ĐỌC =====
   *
   * VÌ SAO BÀI NÀY TỒN TẠI — và vì sao nó là bài quan trọng nhất của khối này
   *
   * `disposal-screen.tsx` viết rõ trong chú thích: "Màn này KHÔNG ghi gì. Đưa một hồ sơ vào kho
   * là việc của chính module chủ." Đó là một lời hứa kiến trúc, và cho tới nay nó chỉ được giữ
   * bằng kỷ luật của người viết — không có gì cưỡng chế.
   *
   * Một cái nút lọt vào đây không hỏng ngay: nó chạy, nó gọi API, và nó tạo ra ĐƯỜNG GHI THỨ
   * HAI cho cùng một trạng thái. Từ đó "thiết bị đã thanh lý" có hai nguồn sự thật, và câu
   * "công ty đã bỏ những gì trong quý này" lại thành câu không ai trả lời được — đúng cái mà
   * màn này sinh ra để giải quyết.
   *
   * Vì thế khẳng định ở đây là khẳng định TẬP HỢP RỖNG-TRỪ-BỘ-LỌC: toàn bộ nút trong vùng nội
   * dung phải đúng bằng năm nút lọc theo loại. Không nút thêm, không nút sửa, không nút xóa,
   * không một cái ba chấm nào.
   *
   * ĐỎ KHI: bất kỳ nút nào khác năm nút lọc xuất hiện; nhóm lọc thiếu/thừa một loại; con số
   * đếm rời khỏi nút lọc; bảng đổi số cột; hoặc dòng ghi chú giải thích biến mất.
   */
  test('Kho thanh lý: năm nút lọc kèm số đếm, bốn cột, một dòng ghi chú — và KHÔNG một nút ghi nào', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await firstLogin(page, E2E_SA);

    const stamp = dauThoiGian();
    const headers = await writeHeaders(page);

    /*
     * Dàn cảnh: đưa HAI loại hồ sơ vào kho qua đúng đường của module chủ.
     * Bảng phải có ít nhất một dòng, không thì màn rơi vào nhánh `EmptyState` và bài kiểm này
     * xanh vì chẳng có gì để kiểm — đúng kiểu khẳng định luôn-xanh phải tránh.
     */
    const catalog = await page.evaluate(async () => {
      const res = await fetch('/api/v1/catalog', { credentials: 'include' });
      return (await res.json()) as { deviceTypes: { id: string; name: string }[] };
    });
    const loaiPC = catalog.deviceTypes.find((type) => type.name === 'PC');
    expect(loaiPC, 'Dàn cảnh: danh mục phải có sẵn loại thiết bị "PC"').toBeTruthy();

    const maMay = `PC-E2E-KHO-${stamp}`;
    const device = await page.request.post('/api/v1/devices', {
      headers,
      data: { code: maMay, name: 'Máy cũ của bài đi khắp giao diện', deviceTypeId: loaiPC!.id },
    });
    expect(device.status(), 'Dàn cảnh: tạo thiết bị').toBe(201);
    const idMay = ((await device.json()) as { device: { id: string } }).device.id;
    expect(
      (
        await page.request.patch(`/api/v1/devices/${idMay}/status`, {
          headers,
          data: { status: 'retired' },
        })
      ).status(),
      'Dàn cảnh: thanh lý thiết bị qua đúng module chủ',
    ).toBe(200);

    const maTaiKhoan = `TK-E2E-KHO-${stamp}`;
    const account = await page.request.post('/api/v1/service-accounts', {
      headers,
      data: { code: maTaiKhoan, kind: 'shared', name: 'Tài khoản cũ' },
    });
    expect(account.status(), 'Dàn cảnh: tạo tài khoản dịch vụ').toBe(201);
    const idTaiKhoan = ((await account.json()) as { id: string }).id;
    expect(
      (
        await page.request.patch(`/api/v1/service-accounts/${idTaiKhoan}/disable`, {
          headers,
          data: { reason: 'dàn cảnh cho bài kho thanh lý' },
        })
      ).status(),
      'Dàn cảnh: vô hiệu hóa tài khoản qua đúng đường bắt-ghi-lý-do',
    ).toBe(200);

    await page.goto('/disposal');
    await expect(page.getByRole('heading', { level: 1, name: /^Kho thanh lý$/ })).toBeVisible();
    const main = page.getByRole('main');

    await expect(
      main.getByRole('row', { name: new RegExp(maMay) }),
      'Thiết bị đã thanh lý phải nằm trong kho',
    ).toBeVisible();
    await expect(
      main.getByRole('row', { name: new RegExp(maTaiKhoan) }),
      'Tài khoản đã vô hiệu hóa cũng vào chung một kho — đó là toàn bộ lý do màn này tồn tại',
    ).toBeVisible();

    /*
     * ===== KHẲNG ĐỊNH QUAN TRỌNG NHẤT =====
     * Toàn bộ nút trong vùng nội dung = năm nút lọc theo loại + bộ nút CHỈ ĐỌC (khoảng ngày,
     * sắp xếp, lật trang, Xuất Excel — DP-004). Không một nút nào ghi. Con số đếm cắt ra so
     * riêng, vì nó thay đổi theo dữ liệu; phần CHỮ thì cố định.
     */
    // Nút ⋯ của từng dòng (chỉ dẫn đường, không ghi gì) không tính vào bộ nút.
    const nhomLoai = main.getByRole('group', { name: 'Lọc theo loại hồ sơ' });
    const tenNut = (await tenTheoVaiTro(nhomLoai, 'button')).filter(
      (ten) => !ten.startsWith('Thao tác với'),
    );
    expect(
      tenNut.map((ten) => ten.replace(/\s+\d+$/, '')),
      'Nhóm lọc theo loại có đúng năm nút',
    ).toEqual(sap(['Tất cả', 'Thiết bị', 'Phần mềm', 'Tài khoản dịch vụ', 'Đường truyền']));
    expect(
      sap(
        (await tenTheoVaiTro(main, 'button'))
          .filter((ten) => !ten.startsWith('Thao tác với'))
          .map((ten) => ten.replace(/\s+\d+$/, '')),
      ),
      'Kho thanh lý CHỈ được có nút lọc/đọc — một nút ghi ở đây là một hồ sơ đã thanh lý bị sửa',
    ).toEqual(
      sap([
        'Tất cả',
        'Thiết bị',
        'Phần mềm',
        'Tài khoản dịch vụ',
        'Đường truyền',
        // DP-004: khoảng thanh lý, từ–đến ngày, sắp xếp, lật trang, xuất đúng cái đang xem.
        'Tháng này',
        'Quý này',
        'Năm nay',
        'Thanh lý từ ngày',
        'Thanh lý đến ngày',
        'Sắp xếp',
        'Số dòng',
        'Trang trước',
        'Trang sau',
        'Xuất Excel',
      ]),
    );
    for (const ten of tenNut) {
      expect(ten, `Nút lọc "${ten}" phải mang số đếm — nút lọc không có số thì hết là bộ đếm`).toMatch(
        /\s\d+$/,
      );
    }

    // Nói thẳng ra ba thứ tuyệt đối không được có, để log lúc đỏ đọc là hiểu ngay.
    /*
     * Menu ⋯ của kho CHỈ dẫn đường (DP-006): "Mở hồ sơ", và "Khôi phục…" cho phần mềm — không
     * mục nào ghi dữ liệu ngay tại đây, sửa vẫn về đúng module chủ.
     */
    expect(
      await rowActionNames(page, maMay),
      'Thiết bị trong kho: chỉ có lối mở hồ sơ gốc',
    ).toEqual(['Mở hồ sơ']);
    // "Xuất Excel" ĐƯỢC có (DP-004): nó chỉ đọc, và lượt xuất vẫn ghi sổ `disposal.exported`.
    for (const cam of [/Thêm/, /^Sửa/, /^Xóa/, /Khôi phục/]) {
      await expect(
        main.getByRole('button', { name: cam }),
        `Kho thanh lý không được có nút khớp ${cam} — sửa thì về đúng module chủ`,
      ).toHaveCount(0);
    }

    /*
     * SỐ ĐẾM PHẢI LÀ SỐ ĐẾM: "Tất cả" bằng tổng bốn loại. Đếm trên tập ĐÃ LỌC thì bấm vào đâu
     * cũng thấy "đúng", và con số hết mang thông tin nào.
     */
    const soCua = (ten: string): number => {
      const khop = tenNut.find((raw) => raw.startsWith(`${ten} `));
      expect(khop, `Phải tìm được nút lọc "${ten}"`).toBeTruthy();
      return Number(khop!.replace(/^.*\s(\d+)$/, '$1'));
    };
    expect(
      soCua('Tất cả'),
      'Số của "Tất cả" phải bằng tổng bốn loại — nếu không thì nó đang đếm trên tập đã lọc',
    ).toBe(
      soCua('Thiết bị') + soCua('Phần mềm') + soCua('Tài khoản dịch vụ') + soCua('Đường truyền'),
    );

    await expect(
      main.getByRole('group', { name: 'Lọc theo loại hồ sơ' }),
      'Năm nút lọc phải nằm trong một nhóm có tên — rời rạc thì trình đọc màn hình không biết chúng là một bộ',
    ).toBeVisible();

    // ĐỦ CỘT, không hơn: ai thanh lý và khi nào lấy từ lịch sử module chủ (DP-002).
    expect(
      await tenCotBang(main),
      'Bảng kho thanh lý: Mã · Loại · Chi tiết · Ngày thanh lý · Người thanh lý · Thao tác (chỉ dẫn đường)',
    ).toEqual(['Mã', 'Loại', 'Chi tiết', 'Ngày thanh lý', 'Người thanh lý', 'Thao tác']);

    await expect(
      main.getByText(/KHÔNG còn được tính hạn và không vào email nhắc gia hạn/),
      'Phải còn dòng giải thích: vì sao hồ sơ ở đây thôi làm phiền, và muốn dùng lại thì đi đâu',
    ).toBeVisible();

    // Bộ lọc CHẠY THẬT: bấm "Thiết bị" thì tài khoản dịch vụ biến đi.
    await main.getByRole('button', { name: /^Thiết bị \d+$/ }).click();
    await expect(
      main.getByRole('row', { name: new RegExp(maMay) }),
      'Lọc theo Thiết bị thì thiết bị phải còn',
    ).toBeVisible();
    await expect(
      main.getByRole('row', { name: new RegExp(maTaiKhoan) }),
      'Lọc theo Thiết bị thì tài khoản dịch vụ phải biến đi — không thì nút lọc chỉ để trang trí',
    ).toHaveCount(0);
    expect(new URL(page.url()).searchParams.get('kind'), 'Bộ lọc loại nằm trên URL (DP-005)').toBe(
      'device',
    );

    /*
     * Và vẫn mở được hồ sơ GỐC: "đã thanh lý" không phải "đã xoá". Người ta mở nó ra chính để
     * đọc lịch sử vì sao bỏ — đó là đường ĐỌC duy nhất mà màn này cung cấp.
     */
    await main.getByRole('link', { name: maMay, exact: true }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: new RegExp(maMay) }),
      'Bấm mã trong kho phải mở đúng hồ sơ gốc ở module chủ',
    ).toBeVisible();
    expect(new URL(page.url()).pathname).toMatch(/^\/devices\/[0-9a-f-]{36}$/);
  });
});

/*
 * ===== VÀO HẲN TRONG PHÒNG: DANH MỤC · TÀI KHOẢN · BỘ GIAO DIỆN =====
 *
 * Mười bốn bài phía trên đi HÀNH LANG: bấm menu, đọc breadcrumb, thử ranh giới vai. Chúng
 * chứng minh được cửa nào mở ra phòng nào, nhưng KHÔNG bước vào trong. Khối này bước vào:
 * phòng có mấy ngăn, mỗi ngăn bảng có cột nào, nút mở hộp thoại tên gì, và mở từng hộp ra
 * xem bên trong có đúng bộ ô nhập không.
 *
 * Vì sao ba phòng này đáng soi kỹ hơn cả:
 *
 *   - `/admin/catalog` là MỘT màn dùng cho BẢY danh mục, và `catalog-form.tsx` là MỘT form
 *     dùng cho bảy loại. Cả bảy chỉ khác nhau ở dữ liệu và ở vài nhánh `if` — nghĩa là một
 *     tab trỏ nhầm entity, hay một nhánh `if` viết thiếu, sẽ bày ô của danh mục này sang
 *     danh mục kia mà màn hình vẫn trông hoàn toàn bình thường. Người dùng sửa "nhà mạng"
 *     và ghi đè lên "nhà cung cấp"; không có gì đỏ lên.
 *   - `/admin/accounts` là nơi SA cầm chìa khóa của mọi người khác. Một mục lặng lẽ biến
 *     khỏi menu ba chấm là một việc SA không làm được nữa vào đúng lúc cần nhất.
 *   - `/dev/components` là nơi DUY NHẤT mọi component dùng chung được vẽ ra một lượt. Một
 *     component vỡ lộ ra ở đây trước khi lộ ra ở màn nghiệp vụ.
 */
test.describe('Phòng Danh mục, Tài khoản và Bộ giao diện — bên trong có gì', () => {
  test.beforeEach(() => {
    resetUsers();
    resetCatalog();
  });

  /**
   * Tên nhãn của một loạt tay nắm, đọc ĐÚNG cách trình đọc màn hình đọc chúng:
   * `aria-label` trước, rồi `<label for=…>`, cuối cùng mới tới chữ in trên nút.
   *
   * Vì sao cần: bài này khẳng định TẬP HỢP ô nhập chứ không phải vài ô tiêu biểu — chỉ so
   * tập hợp mới bắt được ô THỪA ra (nhánh `if` của danh mục khác lọt vào) lẫn ô MẤT ĐI (một
   * trường không bao giờ được nhập nữa). Playwright không có API đọc tên khả truy cập của
   * cả một danh sách, nên đọc bằng đúng thứ tự ưu tiên ấy tại đây.
   *
   * Dấu `*` của `Field` bị bỏ đi: nó mang `aria-hidden`, là chỉ dấu thị giác cho "bắt buộc"
   * chứ không thuộc tên gọi của ô. Cái bắt buộc THẬT nằm ở thuộc tính `required` của input.
   */
  async function tenTayNam(controls: Locator): Promise<string[]> {
    const names = await controls.evaluateAll((nodes) =>
      nodes.map((node) => {
        const el = node as HTMLElement;
        const aria = el.getAttribute('aria-label');
        if (aria) return aria.trim();
        const label = (el as HTMLInputElement).labels?.[0];
        if (label) return (label.textContent ?? '').replace('*', '').replace(/\s+/g, ' ').trim();
        return (el.textContent ?? '').replace(/\s+/g, ' ').trim();
      }),
    );
    return names.sort();
  }

  /** So tập hợp thì hai vế phải sắp cùng một kiểu — dùng chung đúng bộ so sánh mặc định. */
  const sapXep = (names: readonly string[]): string[] => [...names].sort();

  /**
   * Nhãn của một ô nhập dựng bởi `Field`, viết dưới dạng regex neo hai đầu.
   *
   * ===== HAI THỨ ĐÃ ĐO ĐƯỢC, KHÔNG PHẢI SUY =====
   *
   * 1. `getByLabel` KHÔNG đọc tên khả truy cập. Nó lấy toàn bộ chữ trong thẻ `<label>`
   *    (`elementText`), và `shouldSkipForTextMatching` chỉ bỏ qua SCRIPT/STYLE/NOSCRIPT/head
   *    — KHÔNG bỏ qua `aria-hidden`. Mà `Field` vẽ dấu sao của ô bắt buộc trong một
   *    `<span aria-hidden="true">`. Nên nhãn đọc ra là "Tên *", và `{ exact: true }` trượt.
   *
   * 2. Khi khớp bằng REGEX, Playwright thử trên chữ THÔ (`elementText.full`), không phải bản
   *    đã chuẩn hóa — chỉ chuỗi mới đi qua `normalizeWhiteSpace`. Mà `Field` luôn vẽ
   *    `{label}{' '}` rồi mới tới dấu sao (hoặc `null`), nên ô KHÔNG bắt buộc có nhãn thô
   *    là "Số U " — thừa một dấu cách ở cuối. `/^Số U( \*)?$/` trượt vì đúng dấu cách đó.
   *
   * Hai điều trên hợp lại giải thích trọn vẹn lượt đỏ đầu tiên: ba ô trượt (Số U · Địa chỉ /
   * ghi chú · Số điện thoại) đều là ô KHÔNG bắt buộc, còn Mã · Tên · Họ tên · Email thì qua.
   *
   * Vì vậy: neo hai đầu, nuốt khoảng trắng ở cả hai phía, dấu sao là tùy chọn. Vẫn chốt đúng
   * MỘT ô — "Mã" không vớ nhầm "Mã nhân viên" — mà không phải nhớ ô nào bắt buộc.
   */
  const nhan = (label: string): RegExp =>
    new RegExp(`^\\s*${label.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}\\s*\\*?\\s*$`);

  /** Bảy ngăn của phòng Danh mục, đúng thứ tự `TAB_KEYS` trong `catalog-screen.tsx`. */
  const TEN_TAB = [
    'Site',
    'Tủ mạng',
    'Loại thiết bị',
    'Nhà cung cấp',
    'Bộ phận',
    'Nhà mạng',
    'Dịch vụ / Port',
  ] as const;

  /** Một ngăn: nhãn nút "Thêm …" và bộ cột của bảng bên trong. */
  interface NganDanhMuc {
    tab: string;
    /** Nhãn nút mở hộp thêm mới — `catalog.add*` trong `vi.ts`, ĐỔI theo tab. */
    nutThem: string;
    /** Toàn bộ `columnheader` của bảng tab đó, đúng thứ tự trái→phải. */
    cot: string[];
    /** Bốn danh mục gốc có sheet trong file mẫu mới được nhập từ Excel. */
    nhapDuocExcel: boolean;
  }

  const BAY_NGAN: NganDanhMuc[] = [
    {
      tab: 'Site',
      nutThem: 'Thêm site',
      cot: ['Mã', 'Tên', 'Địa chỉ / ghi chú', 'Trạng thái', 'Thao tác'],
      nhapDuocExcel: true,
    },
    {
      tab: 'Tủ mạng',
      nutThem: 'Thêm tủ mạng',
      cot: ['Mã', 'Thuộc site', 'Mô tả', 'Số U', 'Trạng thái', 'Thao tác'],
      nhapDuocExcel: true,
    },
    {
      tab: 'Loại thiết bị',
      nutThem: 'Thêm loại thiết bị',
      cot: ['Tên', 'Có port map', 'Router/Firewall', 'Mô tả', 'Trạng thái', 'Thao tác'],
      nhapDuocExcel: true,
    },
    {
      tab: 'Nhà cung cấp',
      nutThem: 'Thêm nhà cung cấp',
      cot: ['Tên', 'Cung cấp gì', 'Điện thoại', 'Email / người liên hệ', 'Trạng thái', 'Thao tác'],
      nhapDuocExcel: true,
    },
    {
      tab: 'Bộ phận',
      nutThem: 'Thêm bộ phận',
      cot: ['Tên', 'Mô tả', 'Trạng thái', 'Thao tác'],
      nhapDuocExcel: false,
    },
    {
      tab: 'Nhà mạng',
      nutThem: 'Thêm nhà mạng',
      cot: ['Tên', 'Hotline', 'Email / người liên hệ', 'Trạng thái', 'Thao tác'],
      nhapDuocExcel: false,
    },
    {
      tab: 'Dịch vụ / Port',
      nutThem: 'Thêm dịch vụ',
      cot: ['Tên', 'Giao thức', 'Port', 'Mô tả', 'Trạng thái', 'Thao tác'],
      nhapDuocExcel: false,
    },
  ];

  /** Đi từ màn nào cũng được về phòng Danh mục bằng đúng cái link người dùng bấm. */
  async function moPhongDanhMuc(page: Page): Promise<void> {
    await page.getByRole('link', { name: 'Danh mục' }).click();
    await expect(page.getByRole('heading', { name: 'Danh mục', exact: true })).toBeVisible();
  }

  /*
   * ===== BÀI 1 — BẢY NGĂN, BẢY BỘ CỘT, BẢY CÁI NÚT KHÁC NHAU =====
   *
   * VÌ SAO BÀI NÀY TỒN TẠI
   *
   * `catalog-screen.tsx` giữ BA bảng tra song song cho cùng bảy danh mục: `TAB_KEYS` (nhãn
   * tab), `TAB_SUFFIX` (khóa i18n của nút "Thêm …") và `ENTITY_COLUMNS` (cột của bảng). Ba
   * danh sách rời nhau, chỉ khớp nhau bằng lời hứa. Đổi thứ tự một danh sách, hoặc chép một
   * dòng rồi quên sửa hậu tố, là tab này bày dữ liệu của danh mục kia — và vì cả bảy đều là
   * "một bảng mã–tên–trạng thái" nên nhìn bằng mắt KHÔNG phân biệt được.
   *
   * Hậu quả không dừng ở chỗ nhìn nhầm: mọi nút Sửa / Vô hiệu / Xóa trên tab đó gửi lên
   * `/api/v1/catalog/${entity}` theo `entity` đang chọn. Tab lệch = sửa nhầm sang danh mục
   * khác, và bản ghi bị sửa thì không có nút hoàn tác.
   *
   * ĐỎ KHI: mất một tab, thêm một tab, đổi tên tab, nút "Thêm …" không đổi theo tab (hoặc
   * đổi sai chữ), hay bảng của một tab thừa/thiếu/đổi tên một cột.
   *
   * Khẳng định bằng TẬP HỢP ĐẦY ĐỦ (`toHaveText` dạng mảng) chứ không phải `toBeVisible()`
   * từng cái: chỉ so cả mảng mới bắt được cột THỪA ra.
   */
  test('Bảy ngăn của phòng Danh mục: nhãn nút "Thêm …" và bộ cột đổi theo từng tab', async ({
    page,
  }) => {
    // Một luồng đăng nhập lần đầu + bảy lượt đổi tab, mỗi lượt một lượt gọi API.
    test.setTimeout(150_000);
    await firstLogin(page, E2E_SA);
    await moPhongDanhMuc(page);

    /*
     * `aria-label` của thanh tab là TIÊU ĐỀ MÀN ("Danh mục") — người dùng trình đọc màn hình
     * nghe "Danh mục, thanh tab" chứ không phải "thanh tab" trống không.
     */
    const thanhTab = page.getByRole('tablist', { name: 'Danh mục' });
    await expect(
      thanhTab.getByRole('tab'),
      'phòng Danh mục phải có ĐÚNG bảy ngăn, đúng tên, đúng thứ tự — thừa hay thiếu một ngăn đều là một danh mục không ai quản',
    ).toHaveText([...TEN_TAB]);

    for (const ngan of BAY_NGAN) {
      await thanhTab.getByRole('tab', { name: ngan.tab, exact: true }).click();
      await expect(
        page.getByRole('tabpanel'),
        `bấm ngăn ${ngan.tab} phải mở ra một vùng nội dung`,
      ).toBeVisible();

      /*
       * Lọc theo /^Thêm/ rồi so CẢ MẢNG: khẳng định vừa đúng MỘT nút thêm, vừa đúng chữ trên
       * nó. `toBeVisible()` trên một nhãn cố định sẽ xanh cả khi màn còn sót nút "Thêm site"
       * của tab trước.
       */
      await expect(
        page.getByRole('button', { name: /^Thêm/ }),
        `ngăn ${ngan.tab} phải có đúng một nút thêm và nó phải ghi "${ngan.nutThem}" — nút không đổi theo tab nghĩa là hộp thoại mở ra sẽ ghi vào nhầm danh mục`,
      ).toHaveText([ngan.nutThem]);

      const cot = page.getByRole('table').getByRole('columnheader');
      await expect(
        cot,
        `bảng của ngăn ${ngan.tab} phải có đúng ${ngan.cot.length} cột`,
      ).toHaveCount(ngan.cot.length);
      await expect(
        cot,
        `bộ cột của ngăn ${ngan.tab} sai — tab đang bày dữ liệu của một danh mục khác`,
      ).toHaveText(ngan.cot);
    }
  });

  /*
   * ===== BÀI 2 — MỞ CẢ BẢY HỘP "THÊM …" RA XEM BÊN TRONG =====
   *
   * VÌ SAO BÀI NÀY TỒN TẠI
   *
   * `catalog-form.tsx` là MỘT form phục vụ BẢY danh mục: mỗi ô nhập nằm sau một nhánh
   * `entity === '…'`. Đó là chỗ dễ hỏng nhất trong cả màn, vì hỏng của nó IM LẶNG:
   *
   *   - thiếu một nhánh → ô biến mất, và trường đó không bao giờ được nhập nữa. Không có
   *     lỗi, không có cảnh báo; chỉ có một cột luôn luôn "—" mà vài tháng sau mới có người
   *     hỏi vì sao;
   *   - thừa một nhánh → ô của danh mục khác lọt vào. `buildBody` không gửi nó lên, nên
   *     người dùng gõ vào một ô rồi bấm Lưu và tin là đã lưu.
   *
   * Cả hai đều không làm đỏ bài kiểm nào hiện có: `catalog.spec.ts` chỉ điền những ô nó cần.
   *
   * ĐỎ KHI: một danh mục thừa hoặc thiếu một ô, một ô đổi nhãn, một ô đổi LOẠI TAY NẮM (ô
   * gõ thành ô chọn — người dùng bàn phím thao tác khác hẳn), hoặc một hộp không đóng được
   * bằng ✕ / Esc.
   *
   * Cả hai đường đóng đều được chạy: ngăn chẵn đóng bằng ✕, ngăn lẻ đóng bằng Esc.
   */
  test('Bên trong bảy hộp "Thêm …" của Danh mục: đủ ô, đúng loại tay nắm, đóng được cả ✕ lẫn Esc', async ({
    page,
  }) => {
    test.setTimeout(150_000);

    /** Bộ tay nắm của một hộp, đọc thẳng từ các nhánh `entity === …` của `catalog-form.tsx`. */
    interface HopThem {
      tab: string;
      tieuDe: string;
      /** `<input class="inp">` — vai `textbox`. */
      oGo: string[];
      /** `Select` dùng chung: tay nắm là BUTTON, không phải `<select>` gốc. */
      oChon: string[];
      /** Công tắc bật/tắt — vai `checkbox`. */
      congTac: string[];
    }

    const HOP: HopThem[] = [
      {
        tab: 'Site',
        tieuDe: 'Thêm site',
        oGo: ['Mã', 'Tên', 'Địa chỉ / ghi chú'],
        oChon: [],
        congTac: [],
      },
      {
        tab: 'Tủ mạng',
        tieuDe: 'Thêm tủ mạng',
        // "Số U" là ô SỐ (1–60) — vai `spinbutton`, không nằm trong bộ ô gõ chữ.
        oGo: ['Mã', 'Mô tả'],
        oChon: ['Thuộc site'],
        congTac: [],
      },
      {
        tab: 'Loại thiết bị',
        tieuDe: 'Thêm loại thiết bị',
        oGo: ['Tên', 'Mô tả'],
        oChon: [],
        congTac: ['Có port map', 'Router/Firewall'],
      },
      {
        tab: 'Nhà cung cấp',
        tieuDe: 'Thêm nhà cung cấp',
        oGo: ['Tên', 'Cung cấp gì', 'Điện thoại', 'Email / người liên hệ'],
        oChon: [],
        congTac: [],
      },
      {
        tab: 'Bộ phận',
        tieuDe: 'Thêm bộ phận',
        oGo: ['Tên', 'Mô tả'],
        oChon: [],
        congTac: [],
      },
      {
        tab: 'Nhà mạng',
        tieuDe: 'Thêm nhà mạng',
        oGo: ['Tên', 'Hotline', 'Email / người liên hệ'],
        oChon: [],
        congTac: [],
      },
      {
        tab: 'Dịch vụ / Port',
        tieuDe: 'Thêm dịch vụ',
        // `catalog.portFrom` = "Từ port", `catalog.portTo` = "Đến port (tuỳ chọn)" — hai ô, một dải.
        oGo: ['Tên', 'Từ port', 'Đến port (tùy chọn)', 'Mô tả'],
        oChon: ['Giao thức'],
        congTac: [],
      },
    ];

    await firstLogin(page, E2E_SA);
    await moPhongDanhMuc(page);

    for (const [index, hop] of HOP.entries()) {
      await page.getByRole('tab', { name: hop.tab, exact: true }).click();
      await page.getByRole('button', { name: hop.tieuDe, exact: true }).click();

      const hopThoai = page.getByRole('dialog', { name: hop.tieuDe, exact: true });
      await expect(
        hopThoai,
        `hộp thêm của ${hop.tab} phải mang đúng tiêu đề "${hop.tieuDe}" — tiêu đề là thứ duy nhất nói cho người dùng biết họ đang khai vào danh mục nào`,
      ).toBeVisible();

      expect(
        await tenTayNam(hopThoai.getByRole('textbox')),
        `bộ ô GÕ của hộp ${hop.tieuDe} sai — một nhánh "entity === …" trong catalog-form.tsx thừa hoặc thiếu`,
      ).toEqual(sapXep(hop.oGo));

      /*
       * Nút trong hộp = chân hộp (Hủy · Lưu) + ✕ + tay nắm của mỗi ô chọn. So cả mảng để bắt
       * được nút THỪA — vd một nút "Xóa" lọt vào hộp THÊM MỚI.
       */
      expect(
        await tenTayNam(hopThoai.getByRole('button')),
        `bộ NÚT của hộp ${hop.tieuDe} sai — ô chọn phải là button (Select dùng chung), và chân hộp chỉ được có Hủy + Lưu`,
      ).toEqual(sapXep(['Đóng hộp thoại', 'Hủy', 'Lưu', ...hop.oChon]));

      expect(
        await tenTayNam(hopThoai.getByRole('checkbox')),
        `bộ CÔNG TẮC của hộp ${hop.tieuDe} sai — chỉ Loại thiết bị mới có công tắc "có port map"`,
      ).toEqual(sapXep(hop.congTac));

      // Hai đường đóng đều phải chạy thật: một cái hỏng là người dùng kẹt trong hộp.
      if (index % 2 === 0) {
        await hopThoai.getByRole('button', { name: 'Đóng hộp thoại' }).click();
      } else {
        await page.keyboard.press('Escape');
      }
      await expect(
        page.getByRole('dialog'),
        `hộp ${hop.tieuDe} phải đóng được bằng ${index % 2 === 0 ? 'nút ✕' : 'phím Esc'}`,
      ).toHaveCount(0);
    }
  });

  /*
   * ===== BÀI 3 — HỘP DANH MỤC PHẢI BIẾT NÓI KHÔNG, VÀ NÓI Ở ĐÚNG CHỖ =====
   *
   * VÌ SAO BÀI NÀY TỒN TẠI
   *
   * Hai lời từ chối dưới đây do CHÍNH form tự phán (`buildBody` trả về một chuỗi), chưa hề
   * chạm tới API. Chúng không nằm trong `vi.ts` mà viết thẳng trong `catalog-form.tsx`, nên
   * không có bài kiểm i18n nào che được chúng, và cũng không có bài kiểm API nào đi qua
   * chúng.
   *
   * Kiểu hỏng cần chặn: `save.mutate` được gọi TRƯỚC khi kiểm, hoặc lỗi được báo bằng toast
   * rồi hộp tự đóng. Cả hai đều làm người dùng mất trắng những gì vừa gõ, và với trường hợp
   * "quên chọn site" thì bản ghi còn có thể đã kịp bay lên server.
   *
   * ĐỎ KHI: bấm Lưu lúc thiếu site mà hộp vẫn đóng, lời từ chối không nằm trong
   * `role="alert"` (trình đọc màn hình không đọc lên), hoặc số U ngoài khoảng 1–60 lọt qua.
   *
   * `catalog.spec.ts` đã kiểm đường hỏng của DẢI PORT — bài này cố ý đi hai lời từ chối khác
   * để không kiểm lại cùng một thứ.
   */
  test('Hộp Tủ mạng từ chối lưu khi thiếu site hoặc số U sai, và hộp KHÔNG đóng', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    // Ô "Thuộc site" cần ít nhất một site; máy chủ mới dựng thì danh mục còn trắng.
    await catalogItem(page, 'site', { code: `S-E2E-TU-${uniqueStamp()}`, name: 'Site E2E hộp tủ' });
    await moPhongDanhMuc(page);

    await page.getByRole('tab', { name: 'Tủ mạng', exact: true }).click();
    await page.getByRole('button', { name: 'Thêm tủ mạng', exact: true }).click();

    const hop = page.getByRole('dialog', { name: 'Thêm tủ mạng', exact: true });
    await expect(hop).toBeVisible();

    /*
     * Mã phải có thật: không điền thì form báo thiếu Mã cùng lúc, và bài này thành ra kiểm hai
     * lỗi thay vì một. KHÔNG bao giờ bấm Lưu thành công nên bản ghi này không rơi vào DB.
     */
    await hop.getByLabel(nhan('Mã')).fill('E2E-KHONG-LUU');
    await hop.getByRole('button', { name: 'Lưu' }).click();

    await expect(
      hop.getByRole('alert'),
      'quên chọn site mà hộp im lặng thì người dùng bấm Lưu mãi không hiểu vì sao không xong',
    ).toHaveText('Chọn site cho tủ này.');
    await expect(
      hop,
      'hộp phải Ở LẠI cùng những gì vừa gõ — đóng đi là bắt gõ lại từ đầu',
    ).toBeVisible();

    // Chọn site thật rồi mới tới lời từ chối thứ hai. Option của `Select` được vẽ ra NGOÀI
    // locator của hộp thoại nên phải tìm từ `page`.
    await hop.getByRole('button', { name: 'Thuộc site' }).click();
    const luaChonSite = page.getByRole('option');
    await expect(
      luaChonSite.first(),
      'ô "Thuộc site" phải có ít nhất một lựa chọn — rỗng thì không ai khai được tủ mạng nào',
    ).toBeVisible();
    await luaChonSite.first().click();

    await hop.getByLabel(nhan('Số U')).fill('99');
    await hop.getByRole('button', { name: 'Lưu' }).click();
    await expect(
      hop.getByRole('alert'),
      'số U ngoài khoảng phải bị chặn TẠI FORM — để nó bay lên API là đổi một câu tiếng Việt rõ ràng lấy một lỗi 400',
    ).toHaveText('Số U phải là số nguyên từ 1 đến 60.');
    await expect(hop).toBeVisible();

    /* Form đã gõ dở, nên từ 12/09 lối đóng TÌNH CỜ phải hỏi lại trước
       (`Dialog guardUnsaved`, rà UI/UX #10) — trả lời xong mới đóng. */
    await page.keyboard.press('Escape');
    await confirmAction(page, 'Bỏ và đóng');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  /*
   * ===== BÀI 4 — MỘT SITE ĐI TỪ LÚC SINH RA TỚI LÚC BỊ XÓA =====
   *
   * VÌ SAO BÀI NÀY TỒN TẠI
   *
   * Menu ba chấm của Danh mục ĐỔI theo trạng thái hồ sơ: đang dùng thì mục giữa là "Vô
   * hiệu", đã vô hiệu thì là "Bật lại". Kiểm đúng MỘT trạng thái là để lọt nguyên một nửa:
   * một hồ sơ đã vô hiệu mà menu vẫn ghi "Vô hiệu" thì không ai bật lại được nó nữa, và
   * không có đường nào khác trong giao diện để làm việc đó.
   *
   * Bài này cũng chốt hai thứ mà `catalog.spec.ts` chưa chốt:
   *   - hộp SỬA phải MANG THEO giá trị cũ. Form sửa hiện ra trống là kiểu hỏng tệ nhất của
   *     màn nhập liệu: người dùng sửa một ô rồi bấm Lưu, và ba ô kia bị ghi đè thành rỗng;
   *   - site vừa khai phải xuất hiện NGAY trong ô "Thuộc site" của hộp Tủ mạng — hai màn ăn
   *     chung một `queryKey`, quên `invalidateQueries` là người dùng phải tải lại trang mới
   *     thấy thứ mình vừa tạo.
   *
   * ĐỎ KHI: menu không đổi theo trạng thái, menu thừa/thiếu một mục, hộp Sửa mở ra trống,
   * hoặc danh mục vừa tạo không tới được ô chọn của màn khác.
   */
  test('Menu dòng của Danh mục đổi theo trạng thái, hộp Sửa nhớ giá trị cũ, và site mới tới ngay ô "Thuộc site"', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await firstLogin(page, E2E_SA);
    await moPhongDanhMuc(page);

    /*
     * Mã sinh theo thời gian và BẮT ĐẦU BẰNG `E2E-`: đó là mẫu `resetCatalog()` dùng để dọn.
     * Mã cố định sẽ đụng bản ghi của lần chạy trước; mã sai mẫu thì ở lại DB vĩnh viễn.
     */
    const stamp = uniqueStamp();
    const maSite = `E2E-${stamp}`;
    const tenSite = `Site soi phòng ${stamp}`;
    const diaChi = `Tầng ${stamp}, tòa E2E`;

    await page.getByRole('button', { name: 'Thêm site', exact: true }).click();
    const hopThem = page.getByRole('dialog', { name: 'Thêm site', exact: true });
    await hopThem.getByLabel(nhan('Mã')).fill(maSite);
    await hopThem.getByLabel(nhan('Tên')).fill(tenSite);
    await hopThem.getByLabel(nhan('Địa chỉ / ghi chú')).fill(diaChi);
    await hopThem.getByRole('button', { name: 'Lưu' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // Lọc trước rồi mới tìm dòng: bảng phân trang 20 dòng, site mới không chắc nằm ở trang 1.
    await page.getByRole('searchbox').fill(maSite);
    const dongSite = page.getByRole('row', { name: new RegExp(maSite) });
    await expect(dongSite, 'site vừa khai phải hiện ra trong bảng').toBeVisible();
    await expect(dongSite.getByText('Đang dùng')).toBeVisible();

    /*
     * `RowActions` xếp việc NGUY HIỂM xuống cuối, luôn luôn — đó là một lời hứa có ghi trong
     * `row-actions.tsx`, nên khẳng định cả THỨ TỰ chứ không chỉ tập hợp.
     */
    expect(
      await rowActionNames(page, maSite),
      'menu của một hồ sơ ĐANG DÙNG: việc thường trước, Vô hiệu (cảnh báo) rồi Xóa xếp cuối',
    ).toEqual(['Sửa', 'Lịch sử', 'Xem thiết bị dùng mục này', 'Nhật ký thao tác', 'Vô hiệu hóa', 'Xóa']);

    // --- Hộp SỬA phải mang theo cả ba giá trị cũ.
    await rowAction(page, maSite, 'Sửa');
    const hopSua = page.getByRole('dialog', { name: /^Sửa — / });
    await expect(hopSua).toBeVisible();
    // Mã là khoá tra cứu: ở hộp Sửa nó khoá sẵn, phải bấm "Đổi mã…" mới gõ được.
    await expect(hopSua.getByText(maSite, { exact: true })).toBeVisible();
    await hopSua.getByRole('button', { name: 'Đổi mã…' }).click();
    await expect(
      hopSua.getByLabel(nhan('Mã')),
      'ô Mã trong hộp Sửa mở ra trống là ghi đè sạch dữ liệu ngay khi bấm Lưu',
    ).toHaveValue(maSite);
    await expect(hopSua.getByLabel(nhan('Tên'))).toHaveValue(tenSite);
    await expect(hopSua.getByLabel(nhan('Địa chỉ / ghi chú'))).toHaveValue(diaChi);
    await hopSua.getByRole('button', { name: 'Đóng hộp thoại' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // --- Site vừa khai phải có mặt trong ô chọn của hộp Tủ mạng, không cần tải lại trang.
    await page.getByRole('tab', { name: 'Tủ mạng', exact: true }).click();
    await page.getByRole('button', { name: 'Thêm tủ mạng', exact: true }).click();
    const hopTu = page.getByRole('dialog', { name: 'Thêm tủ mạng', exact: true });
    await hopTu.getByRole('button', { name: 'Thuộc site' }).click();
    await expect(
      page.getByRole('option', { name: new RegExp(maSite) }),
      'site vừa khai chưa tới được ô chọn — hai màn ăn chung queryKey mà thiếu một lượt làm mới',
    ).toBeVisible();
    await page.keyboard.press('Escape'); // đóng danh sách lựa chọn
    await hopTu.getByRole('button', { name: 'Đóng hộp thoại' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // --- Vô hiệu rồi mở lại menu: mục giữa phải ĐỔI CHỮ.
    await page.getByRole('tab', { name: 'Site', exact: true }).click();
    await page.getByRole('searchbox').fill(maSite);
    await expect(dongSite).toBeVisible();

    await rowAction(page, maSite, 'Vô hiệu hóa');
    await confirmAction(page, 'Vô hiệu hóa');
    await expect(
      dongSite.getByText('Đã vô hiệu hóa'),
      'vô hiệu xong bảng phải nói ra điều đó — không thì SA bấm lại lần nữa',
    ).toBeVisible();

    expect(
      await rowActionNames(page, maSite),
      'hồ sơ ĐÃ VÔ HIỆU mà menu vẫn ghi "Vô hiệu" thì không còn đường nào bật nó lại',
    ).toEqual(['Sửa', 'Lịch sử', 'Xem thiết bị dùng mục này', 'Nhật ký thao tác', 'Bật lại', 'Xóa']);

    // Dọn ngay trong bài, không đợi `resetCatalog()` của lần chạy sau.
    await rowAction(page, maSite, 'Xóa');
    await confirmAction(page, 'Xóa');
    await expect(dongSite, 'site kiểm thử phải biến khỏi bảng sau khi xóa').toHaveCount(0);
  });

  /*
   * ===== BÀI 5 — ĐƯỜNG NHẬP EXCEL: NÓ CHỈ ĐƯỢC CÓ MẶT Ở NƠI NÓ CHẠY ĐƯỢC =====
   *
   * VÌ SAO BÀI NÀY TỒN TẠI
   *
   * File mẫu chỉ có sheet cho BỐN danh mục gốc. Nếu "Tải file mẫu" / "Nhập từ Excel" hiện ra
   * ở ba danh mục sinh sau (Bộ phận · Nhà mạng · Dịch vụ) thì đó là một lời hứa hão: người
   * dùng tải mẫu về, không tìm thấy sheet của mình, và đi hỏi. Ngược lại, nút biến mất khỏi
   * bốn danh mục gốc thì đường nhập hàng loạt coi như không còn.
   *
   * Bên trong hộp, ba bước là một dây chuyền có KHÓA: chưa chọn file thì không đối chiếu
   * được, chưa đối chiếu thì không ghi được. Khóa ấy chính là thứ giữ cho không ai bấm "Xác
   * nhận ghi" khi chưa hề nhìn bảng đối chiếu — mà `ImportDialog` dùng chung cho cả import
   * thiết bị, nên gỡ nhầm một `disabled` là hỏng cả hai màn.
   *
   * ĐỎ KHI: nút import mọc ở danh mục không có sheet, biến mất ở danh mục có sheet, chân hộp
   * đổi bộ nút, hoặc một trong hai khóa bị gỡ.
   *
   * `catalog.spec.ts` đã đi TRỌN đường nhập (tải mẫu → nhập lại → đối chiếu "không đổi"), nên
   * bài này chỉ soi hình dạng của hộp, không nhập lại lần nữa.
   */
  test('Nút "Tải file mẫu" · "Nhập từ Excel" chỉ có ở danh mục có sheet, và hộp nhập có ba bước khóa nhau', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    await moPhongDanhMuc(page);

    for (const ngan of BAY_NGAN) {
      await page.getByRole('tab', { name: ngan.tab, exact: true }).click();
      const soNut = ngan.nhapDuocExcel ? 1 : 0;
      // File mẫu nằm TRONG hộp nhập, không bao giờ ở đầu trang.
      await expect(
        page.getByRole('button', { name: /Tải file mẫu/ }),
        `ngăn ${ngan.tab}: đầu trang KHÔNG có nút tải file mẫu — nó nằm trong hộp nhập`,
      ).toHaveCount(0);
      await expect(
        page.getByRole('button', { name: 'Nhập từ Excel' }),
        `ngăn ${ngan.tab} ${ngan.nhapDuocExcel ? 'phải có' : 'KHÔNG được có'} nút nhập từ Excel`,
      ).toHaveCount(soNut);
    }

    // --- Bên trong hộp nhập, ở bước MỘT (chưa chọn file).
    await page.getByRole('tab', { name: 'Site', exact: true }).click();
    await page.getByRole('button', { name: 'Nhập từ Excel' }).click();

    const hop = page.getByRole('dialog', {
      name: 'Nhập Site, Tủ mạng, Loại thiết bị, Nhà cung cấp từ Excel',
      exact: true,
    });
    await expect(hop).toBeVisible();
    await expect(
      hop.getByRole('button', { name: /Tải file mẫu/ }),
      'file mẫu phải nằm ngay trong hộp nhập — bước con của việc nhập',
    ).toBeVisible();
    await expect(
      hop.getByText('Chọn file .xlsx', { exact: true }),
      'hộp nhập phải có chỗ chọn file — không thì ba cái nút ở chân chẳng để làm gì',
    ).toBeVisible();
    await expect(
      hop.getByText(/Hệ thống đọc cả 4 sheet: Site, Tủ mạng, Loại thiết bị, Nhà cung cấp/),
      'lời dặn dùng đúng file mẫu phải đứng ngay cạnh ô chọn file, chỗ người ta đang nhìn',
    ).toBeVisible();

    const chanHop = page.getByTestId('dialog-footer');
    await expect(
      chanHop.getByRole('button'),
      'chân hộp nhập phải đúng ba nút theo đúng thứ tự Hủy → Đối chiếu → Xác nhận ghi',
    ).toHaveText(['Hủy', 'Đối chiếu', 'Xác nhận ghi']);

    await expect(
      chanHop.getByRole('button', { name: 'Đối chiếu' }),
      'chưa chọn file mà đối chiếu được là gửi một request rỗng lên server',
    ).toBeDisabled();
    await expect(
      chanHop.getByRole('button', { name: 'Xác nhận ghi' }),
      'chưa đối chiếu mà ghi được là bỏ qua đúng bước sinh ra để người dùng nhìn trước khi ghi',
    ).toBeDisabled();
    await expect(
      chanHop.getByRole('button', { name: 'Hủy' }),
      'nút Hủy phải luôn bấm được — đó là đường thoát',
    ).toBeEnabled();

    await hop.getByRole('button', { name: 'Đóng hộp thoại' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  /*
   * ===== BÀI 6 — PHÒNG TÀI KHOẢN: NÚT, CỘT, MENU NĂM VIỆC, VÀ HỘP PHIÊN =====
   *
   * VÌ SAO BÀI NÀY TỒN TẠI
   *
   * Menu ba chấm của màn Tài khoản gánh NĂM việc — nhiều nhất hệ thống. Bốn trong năm việc
   * là thứ vài tháng mới dùng một lần (đá phiên, đặt lại mật khẩu, đặt lại 2 lớp, khóa), tức
   * là nếu một mục lặng lẽ rơi khỏi `items` thì phải mất vài tháng mới có người phát hiện —
   * và người phát hiện là một SA đang cần dùng nó gấp.
   *
   * Hộp "Phiên đang mở" thì có một cái bẫy riêng, đã ghi trong `accounts-screen.tsx`: nhánh
   * hỏng của nó từng nói "Chưa có dữ liệu" khi API 500. Bài này chốt rằng bên trong hộp có
   * BẢNG THẬT với đủ bốn cột và có nút đá phiên — tức là nó đã hỏi được và đã trả lời.
   *
   * ĐỎ KHI: mất nút "Thêm tài khoản", bảng thừa/thiếu/đổi tên một cột (nhất là cột Vai trò —
   * không thấy vai trò thì không ai biết mình đang khóa nhầm ai), menu rụng một mục, hoặc
   * hộp Phiên mở ra mà bên trong không có bảng.
   *
   * Họ tên của SA đọc từ DB chứ không gõ cứng: nó là dữ liệu hạt giống, đổi lúc nào không
   * biết, và một bài kiểm đỏ vì hạt giống đổi tên là một bài kiểm nói dối.
   */
  test('Phòng Tài khoản: nút, bộ cột, menu năm việc và bên trong hộp "Phiên đang mở"', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await firstLogin(page, E2E_SA);

    // `exact`: menu có cả "Tài khoản" lẫn "Tài khoản dịch vụ".
    await page.getByRole('link', { name: 'Người dùng IMS', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Người dùng IMS', exact: true })).toBeVisible();

    await expect(
      page.getByRole('button', { name: /^Thêm/ }),
      'màn Tài khoản phải có đúng một nút thêm và nó ghi "Thêm tài khoản"',
    ).toHaveText(['Thêm tài khoản']);

    const cot = page.getByRole('table').getByRole('columnheader');
    await expect(
      cot,
      'bộ cột của bảng Tài khoản sai — mất cột Vai trò là SA thao tác trong khi không biết mình đang đụng vào ai',
    ).toHaveText([
      'Họ tên',
      'Vai trò',
      'Trạng thái',
      '2 lớp',
      'Đăng nhập gần nhất',
      'Thao tác',
    ]);

    const hoTenSa = sql(`SELECT full_name FROM users WHERE email = '${E2E_SA.email}'`);
    expect(hoTenSa.length, 'tài khoản SA hạt giống phải có họ tên để bám vào').toBeGreaterThan(0);

    /*
     * Lọc trước: bảng phân trang 20 dòng, SA không chắc nằm ở trang đang xem.
     *
     * PHẢI CHỜ BỘ LỌC ÁP XONG, KHÔNG CHỈ CHỜ HÀNG HIỆN RA (25/09/2026).
     *
     * Bản trước gọi thẳng `fill()` rồi khẳng định nút ba chấm của SA đã hiện — nhưng hàng SA
     * VỐN ĐÃ nằm ở trang 1 của danh sách CHƯA lọc, nên câu khẳng định ấy xanh ngay lập tức,
     * trước khi nhịp lắng 300ms của ô tìm kịp bắn. Bài đi tiếp, mở menu ba chấm, rồi lượt nạp
     * lại đổ xuống giữa chừng: bảng từ 7 dòng còn 1 dòng, hàng được dựng lại, và mục menu đang
     * mở bị giật khỏi DOM. Playwright báo "element is not stable" rồi "detached", đợi đủ 150
     * giây mới chịu thua — một thông báo chẳng liên quan gì tới thứ bài này đang kiểm.
     *
     * Cuộc đua ấy nằm sẵn ở đây từ lâu và trước nay vẫn thắng nhờ MAY: quãng `rowActionNames`
     * (mở menu · đọc chữ · Esc) tình cờ dài hơn 300ms. Đo được ngày 25/09 khi một thay đổi
     * khác làm lệch nhịp vài chục mili-giây và mặt sấp luôn ngửa lên.
     *
     * `timVaChoLoc` chờ đúng GIÁ TRỊ `q=` trên thanh địa chỉ — tức nhịp lắng đã bắn thật.
     * Kèm thêm câu chốt "bảng còn đúng một dòng" để chắc rằng dữ liệu ĐÃ LỌC cũng đã về, chứ
     * không chỉ cái URL đổi.
     */
    await timVaChoLoc(page, E2E_SA.email);
    await expect(page.getByRole('table').getByRole('row')).toHaveCount(2);
    await expect(page.getByRole('button', { name: `Thao tác với ${hoTenSa}` })).toBeVisible();

    /*
     * So TẬP HỢP (đã sắp) chứ không so thứ tự: thứ tự trong menu do `RowActions` tự xếp lại
     * theo cờ `danger`, còn điều bài này bảo vệ là "còn đủ năm việc hay không".
     */
    expect(
      sapXep(await rowActionNames(page, hoTenSa)),
      'menu dòng CỦA CHÍNH SA đang đăng nhập: không có Khóa / Vô hiệu / Đặt lại 2 lớp / Đổi vai (API chặn tự làm với mình)',
    ).toEqual(
      sapXep([
        'Sửa',
        'Phiên đang mở',
        'Nhật ký thao tác',
        'Đặt lại mật khẩu',
        // Hạt giống SA luôn bị bắt 2 lớp (`reset-e2e.mjs`), nên mục bật/tắt đang ở vế "Bỏ".
        'Bỏ bắt buộc 2 lớp khi đăng nhập',
      ]),
    );

    // --- Bên trong hộp "Phiên đang mở". SA đang ngồi đây, nên chắc chắn có ít nhất một phiên.
    await rowAction(page, hoTenSa, 'Phiên đang mở');
    const hopPhien = page.getByRole('dialog', { name: `Phiên đang mở: ${hoTenSa}` });
    await expect(
      hopPhien,
      'tiêu đề hộp phải kèm TÊN người — mở nhầm hộp của người khác rồi đá phiên là một tai nạn không hoàn tác được',
    ).toBeVisible();

    await expect(
      hopPhien.getByRole('columnheader'),
      'bảng phiên phải đủ ba cột có chữ + một cột chứa nút; thiếu IP hay "hoạt động gần nhất" thì SA không phân biệt nổi phiên của mình với phiên của kẻ khác',
    ).toHaveText(['IP', 'Trình duyệt', 'Đăng nhập lúc', 'Hoạt động gần nhất', '']);
    await expect(
      hopPhien.getByText('Phiên này'),
      'phiên của chính SA đang xem phải được đánh dấu — nhìn là biết dòng nào là máy mình',
    ).toBeVisible();

    await expect(
      hopPhien.getByRole('button', { name: 'Đóng phiên' }).first(),
      'phiên của chính SA đang mở phải hiện ra kèm nút đá — bảng rỗng ở đây nghĩa là hộp không hỏi được server',
    ).toBeVisible();

    await hopPhien.getByRole('button', { name: 'Đóng hộp thoại' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  /*
   * ===== BÀI 7 — HỘP TÀI KHOẢN: TẠO KHÁC SỬA, VÀ KHÁC ĐÚNG BA CHỖ =====
   *
   * VÌ SAO BÀI NÀY TỒN TẠI
   *
   * `account-form.tsx` là MỘT hộp cho cả TẠO lẫn SỬA, khác nhau đúng ba chỗ: chế độ tạo có ô
   * Email nhập được, ô chọn Vai trò và công tắc "bắt 2 lớp"; chế độ sửa thì email là CHỮ
   * TĨNH, không phải ô nhập bị khóa.
   *
   * Ba kiểu hỏng đi qua mọi cổng hiện có:
   *   - ô Email hiện ra nhập được ở chế độ SỬA. Email là danh tính đăng nhập và là thứ mọi
   *     dòng nhật ký đang trỏ tới; cho sửa nó là đổi người mà vết cũ vẫn chỉ vào tên mới;
   *   - ô Vai trò rụng mất một lựa chọn — SA không tạo nổi một Quản trị viên nào nữa;
   *   - hộp SỬA mở ra trống. `PATCH /profile` gửi cả ba ô, nên trống nghĩa là bấm Lưu một
   *     phát xóa sạch số điện thoại và mã nhân viên của người ta.
   *
   * ĐỎ KHI: bất kỳ điều nào ở trên, hoặc bộ ô của một trong hai chế độ thừa/thiếu.
   */
  test('Hộp tài khoản: chế độ TẠO có Email và ba vai trò, chế độ SỬA thì email là chữ tĩnh và các ô còn nguyên giá trị cũ', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await firstLogin(page, E2E_SA);
    await page.getByRole('link', { name: 'Người dùng IMS', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Người dùng IMS', exact: true })).toBeVisible();

    /*
     * Tiền tố `e2e-tao-moi-` là mẫu `resetUsers()` dùng để dọn. Sai mẫu thì tài khoản này ở
     * lại DB vĩnh viễn và ràng buộc email duy nhất sẽ làm đỏ mọi lượt chạy sau.
     */
    const stamp = uniqueStamp();
    const email = `e2e-tao-moi-${stamp}@pmh.com.vn`;
    const hoTen = `E2E Tạo Mới ${stamp}`;
    const soDienThoai = '0912 345 678';
    const maNhanVien = `NV-${stamp}`;

    // ===== CHẾ ĐỘ TẠO =====
    await page.getByRole('button', { name: 'Thêm tài khoản' }).click();
    const hopTao = page.getByRole('dialog', { name: 'Thêm tài khoản', exact: true });
    await expect(hopTao).toBeVisible();

    expect(
      await tenTayNam(hopTao.getByRole('textbox')),
      'bộ ô GÕ của chế độ tạo sai — thiếu Email thì không tạo được ai, thừa một ô thì có một trường gõ vào mà không được gửi lên',
    ).toEqual(sapXep(['Họ tên', 'Email', 'Số điện thoại', 'Mã nhân viên']));

    /*
     * Ngày sinh KHÔNG phải ô gõ: `DatePicker` dùng chung có tay nắm là một BUTTON mở lịch.
     * Nhầm vai ở đây nghĩa là người dùng bàn phím thao tác khác hẳn điều ta tưởng.
     */
    await expect(
      hopTao.getByRole('button', { name: 'Ngày sinh' }),
      'ô Ngày sinh phải là nút mở lịch (DatePicker dùng chung), không phải một ô gõ tự do',
    ).toBeVisible();

    const oVaiTro = hopTao.getByRole('group', { name: 'Vai trò' });
    await expect(
      oVaiTro,
      'nhóm Vai trò chỉ có ở chế độ TẠO — vai trò của người đang có thì đổi bằng "Đổi vai trò…"',
    ).toBeVisible();
    await expect(
      oVaiTro.getByRole('radio'),
      'Vai trò phải đủ BA lựa chọn — rụng "Quản trị" là SA không tạo nổi một Quản trị viên nào nữa',
    ).toHaveCount(3);
    for (const vai of ['Thành viên', 'Quản trị', 'Super Admin']) {
      await expect(oVaiTro.getByRole('radio', { name: new RegExp(`^${vai}`) })).toBeVisible();
    }
    await expect(
      oVaiTro.getByRole('radio', { name: /^Thành viên/ }),
      'mặc định là vai thấp nhất',
    ).toBeChecked();

    const congTac = hopTao.getByRole('checkbox');
    await expect(congTac, 'chế độ tạo có đúng một công tắc: bắt buộc 2 lớp').toHaveCount(1);
    await expect(
      congTac,
      'công tắc "bắt buộc 2 lớp" phải BẬT sẵn — mặc định an toàn, ai muốn tắt thì phải chủ động tắt',
    ).toBeChecked();

    await hopTao.getByLabel(nhan('Họ tên')).fill(hoTen);
    await hopTao.getByLabel(nhan('Email')).fill(email);
    await hopTao.getByLabel(nhan('Số điện thoại')).fill(soDienThoai);
    await hopTao.getByLabel(nhan('Mã nhân viên')).fill(maNhanVien);
    await hopTao.getByRole('button', { name: 'Lưu' }).click();

    // Mật khẩu tạm chỉ hiện MỘT LẦN — nó là dấu hiệu tài khoản đã thật sự vào sổ.
    await expect(page.getByRole('dialog', { name: 'Mật khẩu tạm' })).toBeVisible();
    expect(
      (await page.getByTestId('temp-password').innerText()).trim().length,
      'tạo xong mà không có mật khẩu tạm thì SA không có gì để đọc cho người dùng',
    ).toBeGreaterThanOrEqual(12);
    // Nhãn nút là LỜI XÁC NHẬN, không phải "Đóng": hộp chặn Esc và click-nền nên đây là
    // đường ra duy nhất, và người bấm phải tự khẳng định đã ghi lại (rà UI/UX 12/09).
    await page
      .getByRole('button', { name: 'Tôi đã ghi lại mật khẩu này', exact: true })
      .click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // ===== CHẾ ĐỘ SỬA =====
    // Chờ bộ lọc ÁP XONG chứ không chỉ chờ hàng hiện ra: hàng cần tìm vốn đã nằm ở trang 1
    // của danh sách CHƯA lọc, nên câu chờ xanh ngay, rồi lượt nạp lại đổ xuống giữa lúc menu
    // ba chấm đang mở và giật nó khỏi DOM. Lý do đầy đủ: `di-khap-giao-dien.spec.ts`, bài
    // "Phòng Tài khoản" (25/09/2026).
    await timVaChoLoc(page, email);
    await expect(page.getByRole('table').getByRole('row')).toHaveCount(2);
    await expect(page.getByRole('button', { name: `Thao tác với ${hoTen}` })).toBeVisible();
    await rowAction(page, hoTen, 'Sửa');

    const hopSua = page.getByRole('dialog', { name: `Sửa hồ sơ: ${hoTen}` });
    await expect(hopSua).toBeVisible();

    expect(
      await tenTayNam(hopSua.getByRole('textbox')),
      'chế độ SỬA còn ô Email nhập được nghĩa là email — danh tính đăng nhập, thứ mọi dòng nhật ký trỏ tới — sửa được',
    ).toEqual(sapXep(['Họ tên', 'Số điện thoại', 'Mã nhân viên']));

    await expect(
      hopSua.getByTestId('account-email'),
      'ở chế độ sửa email phải hiện thành CHỮ; ô khóa thì người dùng còn ngồi bấm thử và tự hỏi vì sao không gõ được',
    ).toHaveText(email);

    await expect(
      hopSua.getByRole('radio'),
      'chế độ sửa KHÔNG được có ô Vai trò (đổi vai là việc riêng, có step-up)',
    ).toHaveCount(0);
    await expect(
      hopSua.getByRole('checkbox'),
      'chế độ sửa KHÔNG được có công tắc "bắt buộc 2 lớp"',
    ).toHaveCount(0);

    await expect(
      hopSua.getByLabel(nhan('Họ tên')),
      'hộp Sửa mở ra trống là bấm Lưu một phát xóa sạch hồ sơ của người ta',
    ).toHaveValue(hoTen);
    await expect(hopSua.getByLabel(nhan('Số điện thoại'))).toHaveValue(soDienThoai);
    await expect(hopSua.getByLabel(nhan('Mã nhân viên'))).toHaveValue(maNhanVien);

    // Đóng bằng Esc — không lưu gì cả.
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  /*
   * ===== BÀI 8 — PHÒNG BỘ GIAO DIỆN: NƠI MỌI COMPONENT ĐƯỢC VẼ MỘT LƯỢT =====
   *
   * VÌ SAO BÀI NÀY TỒN TẠI
   *
   * `/dev/components` là bản kê SỐNG của tài sản dùng chung (AD-15, story 1.5). Nó có hai
   * công dụng, và bài kiểm này giữ cả hai:
   *
   *   1. Nó là nơi người viết story sau mở ra xem "đã có sẵn chưa" trước khi viết component
   *      mới. Một khu biến mất khỏi trang này = một component dùng chung vô hình, và người
   *      tiếp theo sẽ viết lại bản riêng của nó — đúng điều AD-15 cấm.
   *   2. Nó là nơi DUY NHẤT mọi component được dựng ra cùng lúc với dữ liệu mẫu. Một
   *      component ném lỗi lúc render sẽ làm sập cả cây React và cuốn theo mọi khu phía sau
   *      — nên so CẢ MẢNG tiêu đề bắt được ngay, trong khi `toBeVisible()` từng cái thì chỉ
   *      bắt được cái đầu tiên.
   *
   * ĐỎ KHI: thêm/bớt/đổi tên một khu, hoặc một component vỡ khiến các khu sau nó không được
   * vẽ ra nữa.
   *
   * HAI dòng trong mảng KHÔNG phải tên khu, và cố ý giữ lại: "Thông tin chung" (nằm trong
   * khu "Form") và "Giấy tờ đính kèm" (nằm trong khu AttachmentDraftSection) đều là tiêu đề
   * do `FormSection` dựng — mà `FormSection` cũng vẽ `<h2>`. Có mặt trong mảng chính là bằng
   * chứng hai khối ấy còn dựng được phần thân, không chỉ cái vỏ ngoài. Bỏ chúng đi để mảng
   * "gọn" là làm yếu phép so tập hợp.
   */
  test('Phòng Bộ giao diện liệt kê đủ mọi khu, đúng thứ tự', async ({ page }) => {
    await firstLogin(page, E2E_SA);

    await page.getByRole('link', { name: 'Bộ giao diện' }).click();
    await expect(page.getByRole('heading', { name: 'Bộ giao diện', exact: true })).toBeVisible();

    await expect(
      page.getByRole('heading', { level: 2 }),
      'bản kê tài sản dùng chung thiếu hoặc thừa một khu — hoặc một component vỡ lúc render và cuốn theo mọi khu sau nó',
    ).toHaveText([
      'Màu nền tảng — nguồn duy nhất là tokens.css',
      'Nút',
      'Nhãn trạng thái hạn — ExpiryBadge (một luật duy nhất)',
      'Thông báo & xác nhận — useToast / useConfirm',
      'Thanh lọc & phân trang',
      'Lưới ghế — .seat-list (khu bung dòng)',
      'Form',
      'Thông tin chung',
      'Lịch định kỳ — SchedulePicker',
      'Lịch sử nghiệp vụ — HistoryPanel (AD-13)',
      'Tabs — Tabs (bàn phím ←/→, Home/End)',
      'Chọn file — FilePicker (kéo-thả được)',
      'Giấy tờ chọn trước khi lưu — AttachmentDraftSection',
      // Cũng KHÔNG phải một khu: `AttachmentDraftSection` tự dựng một `FormSection` bên
      // trong, và `FormSection` nào cũng vẽ `<h2>`. Có mặt ở đây là bằng chứng khối chọn
      // giấy tờ trước khi lưu còn dựng được phần thân của nó, không chỉ cái tiêu đề ngoài.
      'Giấy tờ đính kèm',
      'Đối chiếu trước khi ghi — ImportPreview',
      'Trạng thái rỗng',
    ]);
  });
});

/*
 * ===== VÀO HẲN TRONG PHÒNG: KÉT SẮT · QUYỀN · DUYỆT · BẢNG ĐIỀU KHIỂN =====
 *
 * Bốn khối trên đi HÀNH LANG: bấm menu, bấm link, đổi vai, xem cửa nào mở cửa nào đóng. Chúng
 * chứng minh được là mỗi phòng CÓ CỬA và cửa dẫn đúng chỗ. Nhưng không bài nào trong đó bước
 * hẳn vào giữa phòng mà đếm: phòng này có mấy cái nút, bảng mấy cột, mấy ngăn, và mở từng cái
 * hộp ra thì bên trong có ô nào.
 *
 * Đó là khoảng trống thật, vì hỏng kiểu "thiếu một thứ trong phòng" KHÔNG làm hỏng đường đi:
 *   - `dashboard.available` của một khối lật sang false vì API rút gọn nhầm theo vai → khối
 *     "Két lâu chưa đổi" biến mất với SA. Mọi link còn sống, mọi bài link còn xanh.
 *   - Ngược chiều, nguy hơn nhiều: khối "Break-glass tuần qua" LỌT sang Member. Đó là danh
 *     sách ai đang xin quyền khẩn cấp vào mật khẩu nào — rò rỉ an ninh, mà giao diện vẫn đẹp.
 *   - Một `<li>` trong "Luật của két" bị xoá, một cột của bảng secret bị bỏ, một nút trong
 *     chân hộp thoại đổi tên: người dùng mất một thứ họ vẫn dùng, không bài nào đỏ.
 *
 * NÊN CÁCH KHẲNG ĐỊNH Ở ĐÂY LÀ SO TẬP HỢP, KHÔNG PHẢI `toBeVisible()` TỪNG CÁI. `toBeVisible`
 * chỉ bắt được thứ MẤT ĐI; `toEqual` trên cả danh sách còn bắt được thứ THỪA RA — và thứ thừa
 * ra ở đúng bốn phòng này (một khối lạ trên bảng điều khiển, một nút lạ trên phiếu chờ duyệt,
 * một ô lạ trong hộp gán quyền) mới là thứ đáng sợ.
 */

test.describe('Phòng Két sắt, Quyền, Duyệt và Bảng điều khiển — bên trong có gì', () => {
  test.beforeEach(() => {
    resetUsers();
    resetSecrets();
    resetDevices();
    resetSoftware();
    resetAccessList();
    resetApprovals();
    resetCatalog();
  });

  /* ------------------------------------------------------------------ *
   * Dàn cảnh — gọi API cho nhanh. ĐIỀU ĐANG KIỂM luôn đi qua giao diện.
   * ------------------------------------------------------------------ */

  /** Id loại thiết bị theo tên, lấy từ danh mục thật (không gõ cứng UUID). */
  async function deviceTypeId(page: Page, name: string): Promise<string> {
    const catalog = await page.evaluate(async () => {
      const res = await fetch('/api/v1/catalog', { credentials: 'include' });
      return (await res.json()) as { deviceTypes: { id: string; name: string }[] };
    });
    const found = catalog.deviceTypes.find((type) => type.name === name);
    expect(found, `danh mục phải có loại thiết bị "${name}" — hạt giống hỏng thì cả bài vô nghĩa`)
      .toBeTruthy();
    return found!.id;
  }

  /** Dựng một thiết bị. Mã luôn chứa `E2E` để `resetDevices()` dọn được. */
  async function seedDevice(page: Page, code: string, typeName = 'PC'): Promise<string> {
    const created = await page.request.post('/api/v1/devices', {
      headers: await writeHeaders(page),
      data: { code, name: `Máy ${code}`, deviceTypeId: await deviceTypeId(page, typeName) },
    });
    expect(created.status(), `không dựng được thiết bị ${code}`).toBe(201);
    return ((await created.json()) as { device: { id: string } }).device.id;
  }

  /**
   * Cất một ngăn vào két của một chủ thể.
   *
   * NHÃN BẮT BUỘC CHỨA `E2E`: bảng `secret` không có FK sang thiết bị (tham chiếu lỏng, AD-4),
   * nên `resetDevices()` KHÔNG kéo theo secret. Nhãn không chứa `E2E` là nó ở lại DB vĩnh viễn
   * và lượt chạy sau đâm vào ràng buộc "một chủ thể một nhãn".
   */
  async function stash(
    page: Page,
    ownerType: 'device' | 'software',
    ownerId: string,
    label: string,
  ): Promise<string> {
    expect(label, 'nhãn secret PHẢI chứa E2E, không thì reset không dọn được').toContain('E2E');
    const created = await page.request.post('/api/v1/vault/secrets', {
      headers: await writeHeaders(page),
      data: { ownerType, ownerId, kind: 'password', label, value: 'Mat-Khau#2026' },
    });
    expect(created.status(), `không cất được secret "${label}"`).toBe(201);
    return ((await created.json()) as { id: string }).id;
  }

  /* ------------------------------------------------------------------ *
   * Đọc TÊN của cả một họ tay nắm — để so TẬP HỢP, không so từng cái.
   * ------------------------------------------------------------------ */

  /**
   * Nhãn của MỌI ô nhập chữ trong một vùng, theo đúng thứ tự DOM.
   *
   * Đọc qua `el.labels` (thuộc tính DOM chuẩn) chứ không qua selector CSS. Cắt dấu `*` vì
   * `Field` vẽ nó như một `<span aria-hidden>` NẰM TRONG `<label>`: mắt thấy "Tên gọi *",
   * trình đọc màn hình nghe "Tên gọi".
   *
   * Vì sao cần: `getByLabel('X')` chỉ trả lời "X có mặt không". Nó không bao giờ bắt được ô
   * THỨ SÁU vừa mọc thêm trong một hộp thoại lẽ ra có năm ô — mà thêm một ô vào hộp đứng ngay
   * cửa két thì đáng phải có người duyệt.
   */
  async function textboxLabels(scope: Locator): Promise<string[]> {
    return scope.getByRole('textbox').evaluateAll((nodes) =>
      nodes.map((node) => {
        const el = node as HTMLInputElement | HTMLTextAreaElement;
        const aria = el.getAttribute('aria-label');
        if (aria) return aria.trim();
        const label = el.labels?.[0];
        return (label?.textContent ?? '').replace('*', '').replace(/\s+/g, ' ').trim();
      }),
    );
  }

  /**
   * Nhãn của mọi ô CHỌN (`ui/select.tsx`) trong một vùng.
   *
   * Trigger của `Select` là một `<button aria-haspopup="listbox">`, KHÔNG phải `<select>` và
   * cũng không phải `combobox`. Lọc theo đúng thuộc tính đó để tách nó khỏi nút thường —
   * nhầm vai ở đây nghĩa là người dùng bàn phím thao tác khác hẳn điều ta tưởng.
   */
  async function selectLabels(scope: Locator): Promise<string[]> {
    return scope
      .getByRole('button')
      .evaluateAll((nodes) =>
        nodes
          .filter((node) => node.getAttribute('aria-haspopup') === 'listbox')
          .map((node) => (node.getAttribute('aria-label') ?? '').trim()),
      );
  }

  /**
   * Tên + trạng thái của mọi nút BẬT/TẮT (`aria-pressed`) trong một vùng, theo thứ tự DOM.
   *
   * KHÔNG dùng `getByRole('button', { pressed: false })` — ĐÃ ĐO và nó sai ở đây: Playwright
   * coi một nút KHÔNG có thuộc tính `aria-pressed` là "đang không được nhấn", nên bộ lọc đó
   * vớ luôn cả nút "Mở két" của từng dòng bảng. Lượt chạy đầu đỏ đúng vì thế:
   * `["Thiết bị","Phần mềm","Tài khoản dịch vụ","Mở két","Mở két"]`.
   *
   * Đọc thẳng thuộc tính thì lưới khoanh đúng họ nút bật/tắt và KHÔNG nở ra theo số dòng dữ
   * liệu — nghĩa là nó vẫn bắt được nút lọc thứ tư mọc thêm, đúng điều nó sinh ra để làm.
   */
  async function toggleButtons(scope: Locator): Promise<{ ten: string; bat: boolean }[]> {
    return scope.getByRole('button').evaluateAll((nodes) =>
      nodes
        .filter((node) => node.hasAttribute('aria-pressed'))
        .map((node) => ({
          /* Cắt SỐ ĐẾM ở đuôi nhãn ("Thiết bị 3" → "Thiết bị"), thêm 17/09/2026 khi trang tổng
             Két sắt gắn số vào nút lọc như Kho thanh lý và Dải mạng. Bài này hỏi "có đúng bốn
             loại không", không hỏi "mỗi loại có mấy cái" — con số đổi theo dữ liệu gieo nên
             chốt cứng nó vào đây là tự tạo một bài kiểm đỏ ngẫu nhiên. */
          ten: (node.textContent ?? '')
            .replace(/\s+/g, ' ')
            .trim()
            .replace(/\s+\d+$/, ''),
          bat: node.getAttribute('aria-pressed') === 'true',
        })),
    );
  }

  /** Sắp xếp một danh sách tên để so tập hợp mà không phụ thuộc thứ tự vẽ trên màn. */
  function asSet(names: string[]): string[] {
    return [...names].sort();
  }

  /* ================================================================== *
   * BÀI 1 — Trang tổng Két sắt: nút lọc, popup của một dòng, luật của két
   * ================================================================== */

  /*
   * VÌ SAO BÀI NÀY TỒN TẠI
   *
   * `vault-home-scope.spec.ts` đã chứng minh trang tổng KHÔNG lộ tên ngăn và lọc được. Nó
   * không đếm cái gì cả: nó hỏi "dòng này còn thấy không", nên một nút lọc thứ tư mọc thêm,
   * một cột của bảng secret trong popup bị bỏ, hay khối "Luật của két" rụng mất một gạch đều
   * lọt qua.
   *
   * Bài này đứng giữa phòng và ĐẾM: ba nút lọc (không hai, không bốn), số dòng trước và sau
   * khi bật lọc, sáu cột của bảng secret trong popup, hai nút ở chân popup, bốn gạch luật.
   *
   * ĐỎ KHI: thêm/bớt một loại chủ thể mà quên nút lọc; nút lọc bấm vào mà bảng không đổi
   * (`aria-pressed` lật nhưng bộ lọc không nối vào danh sách); popup mất nút "Mở hồ sơ đầy
   * đủ" (xem xong két là cụt đường sang hồ sơ); hoặc một gạch trong "Luật của két" biến mất —
   * đó là chỗ DUY NHẤT trong sản phẩm nói cho người dùng biết luật mở két.
   */
  test('Trang tổng Két sắt: bốn nút lọc đổi bảng thật, popup mở đúng két, luật đủ bốn gạch', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await firstLogin(page, E2E_SA);

    const stamp = uniqueStamp();
    const deviceCode = `PC-E2E-KS-${stamp}`;
    const deviceId = await seedDevice(page, deviceCode);
    const secretLabel = `admin web E2E ${stamp}`;
    await stash(page, 'device', deviceId, secretLabel);

    const swCode = `LIC-E2E-KS-${stamp}`;
    const sw = await page.request.post('/api/v1/software', {
      headers: await writeHeaders(page),
      data: { code: swCode, name: 'License có key', kind: 'license', endDate: '2028-12-31' },
    });
    expect(sw.status(), 'không dựng được hồ sơ phần mềm').toBe(201);
    await stash(page, 'software', ((await sw.json()) as { id: string }).id, `key E2E ${stamp}`);

    await page.goto('/vault');
    const main = page.getByRole('main');
    await expect(page.getByRole('heading', { level: 1, name: 'Két sắt' })).toBeVisible();

    /*
     * BỐN nút lọc, khoanh bằng THUỘC TÍNH `aria-pressed` chứ không bằng tên.
     *
     * Chỉ nút lọc mang thuộc tính đó (`vault-home-screen.tsx`), nên lưới này khoanh trúng cả
     * họ mà không phải liệt kê tên trước — nút lọc mọc thêm cũng rơi vào và làm đỏ.
     *
     * VÀ NÓ ĐÃ LÀM ĐÚNG VIỆC ĐÓ, 12/09: bản vá mục #2 thêm nút "Đường truyền" và bài này đỏ
     * ngay. Trước bản vá, dãy nút gõ tay ba loại trong khi API có bốn — nên bật bất kỳ nút
     * nào cũng làm mọi dòng đường truyền biến mất im lặng. Danh sách dưới đây nay sinh ra từ
     * `SECRET_OWNER_TYPES`, tức thứ tự này là thứ tự khai bên API.
     */
    const table = main.getByRole('table');
    await expect(table, 'phải có bảng chủ thể trước khi đếm nút lọc').toBeVisible();
    expect(
      await toggleButtons(main),
      'trang tổng phải có ĐÚNG bốn nút lọc loại — một cho mỗi loại chủ thể cất được secret — ' +
        'và lúc mới vào cả bốn đều đang TẮT',
    ).toEqual([
      { ten: 'Thiết bị', bat: false },
      { ten: 'Phần mềm', bat: false },
      { ten: 'Tài khoản dịch vụ', bat: false },
      { ten: 'Đường truyền', bat: false },
    ]);

    const deviceRow = table.getByRole('row', { name: new RegExp(deviceCode) });
    const swRow = table.getByRole('row', { name: new RegExp(swCode) });
    await expect(deviceRow).toBeVisible();
    await expect(swRow).toBeVisible();

    // ĐẾM trước, để lát nữa còn có cái mà so. `+1` là dòng tiêu đề của `<thead>`.
    const rowsBefore = await table.getByRole('row').count();
    expect(rowsBefore, 'đã gieo hai chủ thể nên bảng phải có ít nhất hai dòng dữ liệu')
      .toBeGreaterThanOrEqual(3);

    await main.getByRole('button', { name: /^Thiết bị \d+$/ }).click();

    /*
     * Bật lọc "Thiết bị" phải làm BẢNG đổi, không chỉ làm cái nút sáng lên.
     *
     * Đây là cặp khẳng định cố ý đi đôi: `aria-pressed` chứng minh nút đã lật, số dòng chứng
     * minh danh sách đã nghe theo. Thiếu vế thứ hai thì một `useState` không nối vào `rows`
     * vẫn xanh — và đó đúng là kiểu hỏng mà mắt không thấy vì cái nút vẫn đổi màu.
     */
    // `poll`: đọc `aria-pressed` ngay sau cú bấm là đua với lượt render của React.
    await expect.poll(
      () => toggleButtons(main),
      { message: 'bấm "Thiết bị" thì đúng một nút được bật, ba nút kia phải giữ nguyên trạng thái tắt' },
    ).toEqual([
      { ten: 'Thiết bị', bat: true },
      { ten: 'Phần mềm', bat: false },
      { ten: 'Tài khoản dịch vụ', bat: false },
      { ten: 'Đường truyền', bat: false },
    ]);

    const rowsAfter = await table.getByRole('row').count();
    expect(
      rowsAfter,
      `lọc "Thiết bị" phải BỎ BỚT dòng khỏi bảng (trước ${rowsBefore}, sau ${rowsAfter}) — ` +
        'nút sáng mà bảng đứng im là bộ lọc chưa nối vào danh sách',
    ).toBeLessThan(rowsBefore);
    await expect(deviceRow, 'lọc "Thiết bị" mà dòng thiết bị biến mất là lọc ngược').toBeVisible();
    await expect(swRow, 'lọc "Thiết bị" mà dòng phần mềm còn ở lại là bộ lọc không có tác dụng')
      .toHaveCount(0);

    // Tắt lại — nút bật/tắt phải đi được cả hai chiều, không phải một chiều.
    await main.getByRole('button', { name: /^Thiết bị \d+$/ }).click();
    await expect(swRow, 'tắt lọc thì dòng phần mềm phải quay lại').toBeVisible();

    /* ---- POPUP của một dòng: mở ra rồi soi bên trong ---- */

    await deviceRow.getByRole('button', { name: `Mở két của ${deviceCode}` }).click();
    const popup = page.getByRole('dialog', { name: new RegExp(`^Két sắt — ${deviceCode}`) });
    await expect(
      popup,
      'tiêu đề popup phải nói RÕ đang mở két của chủ thể nào — mở nhầm két là xem nhầm mật khẩu',
    ).toBeVisible();

    /*
     * `expect.poll`, KHÔNG phải `expect(await …)` — cùng cái bẫy đã ghi ở bài Port map trong
     * chính file này. Popup hiện ra TRƯỚC khi bảng bên trong có dữ liệu: nó còn phải hỏi
     * `/vault/:ownerType/:ownerId` rồi mới vẽ. Đọc một phát bằng `await` là đọc trúng khoảnh
     * khắc đó và KHÔNG có lần đọc thứ hai — mảng rỗng, bài đỏ, ảnh chụp thì thấy đủ cột
     * nằm sờ sờ. Lượt chạy 17/09/2026 đỏ đúng kiểu ấy.
     */
    await expect
      .poll(() => popup.getByRole('columnheader').allTextContents(), {
        message:
          'bảng secret trong popup: ba cột, loại/ghi chú/ngày cập nhật là dòng phụ — KHÔNG có cột giá trị (FR-026)',
      })
      .toEqual(['Tên gọi', 'Tên đăng nhập', 'Thao tác']);
    await expect(
      popup.getByRole('cell', { name: secretLabel }).first(),
      'popup phải liệt kê đúng ngăn vừa cất',
    ).toBeVisible();

    const footer = popup.getByTestId('dialog-footer');
    expect(
      await footer.getByRole('link').allTextContents(),
      'chân popup phải có đúng một đường sang hồ sơ đầy đủ — xem xong két thường là muốn xem cả máy',
    ).toEqual(['Mở hồ sơ đầy đủ']);
    expect(
      await footer.getByRole('button').allTextContents(),
      'chân popup phải có đúng một nút Đóng, không thừa nút nào',
    ).toEqual(['Đóng']);

    await footer.getByRole('button', { name: 'Đóng', exact: true }).click();
    await expect(popup, 'bấm Đóng thì popup phải đóng thật').toBeHidden();
    await expect(page, 'popup đóng lại là vẫn đứng nguyên trang tổng, không bị chuyển trang')
      .toHaveURL(/\/vault$/);

    /* ---- Khối "Luật của két" ---- */

    await expect(page.getByRole('heading', { level: 2, name: 'Luật của két' })).toBeVisible();
    /*
     * `<ul class="vault-rules">` là danh sách DUY NHẤT trong `<main>` của màn này, nên gom
     * `listitem` là gom đúng bốn gạch luật. So nguyên văn: đây là chỗ duy nhất trong sản phẩm
     * nói cho người dùng biết luật mở két, sửa chữ ở đây phải là một quyết định có ý thức.
     */
    expect(
      await page.getByRole('main').getByRole('listitem').allTextContents(),
      '"Luật của két" phải đủ BỐN gạch: cất · gõ mã · tự ẩn · ghi nhật ký',
    /*
     * BA CÂU ĐỔI NGÀY 17/09/2026, và đúng như chú thích trên đòi hỏi: có ý thức.
     *
     * · gạch 1 — bản cũ chỉ người dùng đi vòng qua trang thiết bị để làm đúng cái việc mà
     *   popup "Mở két" ngay trên màn này đã làm được;
     * · gạch 2 — bản cũ nói "mỗi phiên", trong khi luật thật là một khoảng ÂN HẠN
     *   (`secret.stepup_grace_minutes`) và chính hộp mở két có đồng hồ đếm ngược nói điều đó.
     *   Chữ ở chân trang nói ngược cái đồng hồ thì người dùng bị hỏi mã giữa chừng và tưởng
     *   hệ thống hỏng;
     * · gạch 3 — "vài chục giây" là ước lượng, trong khi màn hình có đồng hồ thật.
     */
    ).toEqual([
      'Cất bí mật: bấm "Mở két" ngay tại bảng trên, hoặc vào tab "Két sắt" của hồ sơ. Chỉ Quản trị và Super Admin ghi được.',
      'Xem giá trị: phải gõ mã 6 số (TOTP). Gõ một lần rồi thì mở tiếp được trong ít phút, hết khoảng đó phải gõ lại.',
      'Giá trị hiện ra rồi TỰ ẨN — có đồng hồ đếm ngược ngay trên hộp — và không có nút sao chép hàng loạt.',
      'Mỗi lần mở đều ghi nhật ký: ai xem, xem của ai, lúc nào — không xóa được.',
    ]);
  });

  /* ================================================================== *
   * BÀI 2 — Ma trận Quyền xem két sắt: lưới có cột gì, dòng ai có nút gì
   * ================================================================== */

  /*
   * VÌ SAO BÀI NÀY TỒN TẠI
   *
   * `vault-access.spec.ts` kiểm NGHIỆP VỤ của ma trận (gán, gỡ, tầng rộng nhất thắng, email
   * lạ bị chặn). Nó không hỏi lưới có hình dạng gì. Mà hình dạng mới là thứ trả lời được câu
   * "chỗ nào đang hổng": đúng một họ nhóm bị rụng khỏi danh sách cột là cả một mảng quyền
   * biến mất khỏi tầm mắt người rà soát, trong khi mọi bài nghiệp vụ vẫn xanh vì chúng gán
   * bằng API rồi mới đọc lại một ô.
   *
   * Lọc cột về đúng họ "Phần mềm" rồi mới so tập hợp là có chủ ý: `software_kind` là danh
   * sách CỐ ĐỊNH trong `access-list.service.ts`, không phụ thuộc danh mục của môi trường —
   * nên so được nguyên văn năm cột mà không sinh ra một bài đỏ theo máy.
   *
   * ĐỎ KHI: một loại phần mềm thêm vào API mà lưới không mọc cột; dòng của Member mất nút
   * "Gán quyền"; dòng của SA/Admin BỖNG có ô để bấm (mời người ta gán một quyền không có tác
   * dụng, rồi tưởng là đã siết); hoặc chú giải ba tầng rụng mất một tầng.
   */
  test('Ma trận Quyền xem két sắt: lưới đủ cột, Member có nút gán, SA/Admin ở khối "toàn quyền theo vai"', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await firstLogin(page, E2E_SA);

    // Lưới là tab "Ma trận" (màn rộng); tab mặc định là "Theo người".
    await page.goto('/admin/vault-access?view=matrix');
    await expect(page.getByRole('heading', { level: 1, name: 'Quyền két sắt' })).toBeVisible();

    /*
     * Khung cuộn NGANG bọc lưới. Nó tồn tại vì vài chục cột là chuyện bình thường: cho cả
     * trang cuộn ngang thì cột tên người trôi khỏi màn và lưới hết đọc được.
     */
    const grid = page.getByTestId('access-grid');
    await expect(grid, 'ma trận phải nằm trong khung cuộn riêng, không để cả trang cuộn ngang')
      .toBeVisible();

    // Lọc CỘT về đúng họ "Phần mềm" — danh sách cố định, so được nguyên văn.
    await page.getByRole('button', { name: 'Nhóm đối tượng' }).click();
    await page.getByRole('option', { name: 'Phần mềm', exact: true }).click();

    /*
     * Tiêu đề cột loại là NÚT "Gán … cho nhiều người", kèm dấu `+` trang trí
     * (`aria-hidden`) cho thấy nó bấm được. `allTextContents` đọc cả phần trang trí nên cắt nó
     * đi trước khi so chữ; việc mỗi cột loại phải có nút đó thì kiểm riêng ngay dưới.
     */
    expect(
      asSet(
        (await grid.getByRole('columnheader').allTextContents()).map((text) =>
          text.replace(/\+$/, ''),
        ),
      ),
      'lọc về họ "Phần mềm" thì lưới phải còn đúng: cột tên người + tiêu đề họ + năm loại phần mềm',
    ).toEqual(
      asSet([
        'Người',
        'Phần mềm',
        'License',
        'Chứng chỉ SSL',
        'Tên miền',
        'Hợp đồng bảo trì',
        'Khác',
      ]),
    );
    await expect(
      grid.getByRole('columnheader').getByRole('button', { name: /^Gán ".+" cho nhiều người$/ }),
      'mỗi cột loại (năm cột) là một nút gán cả cột cho nhiều người',
    ).toHaveCount(5);

    /* ---- Dòng của Member: có nút gán, và có ô để bấm ---- */

    const memberRow = grid.getByRole('row', { name: new RegExp(E2E_MEMBER.email) });
    await expect(memberRow, 'ma trận phải liệt kê được tài khoản Member').toBeVisible();
    await expect(
      memberRow.getByRole('button', { name: 'Gán quyền' }),
      'dòng của Member phải có nút "Gán quyền" — đây là chiều gán theo NGƯỜI',
    ).toBeVisible();

    /* ---- SA/Admin: KHÔNG thành dòng trống trong lưới, mà nằm trong khối gập riêng ---- */

    await expect(
      grid.getByRole('row', { name: new RegExp(E2E_SA.email) }),
      'SA/Admin xem được mọi secret theo VAI — một dòng trống trong lưới đọc như "không có quyền gì"',
    ).toHaveCount(0);
    const roleBlock = page.getByText(/^Có toàn quyền theo vai \(\d+\)$/);
    await expect(roleBlock, 'ai có toàn quyền theo vai vẫn phải thấy được khi rà soát').toBeVisible();
    await roleBlock.click();
    await expect(
      page.getByText('Quản trị và Super Admin đã xem được mọi két theo vai, không cần gán ở đây.'),
      'khối đó phải NÓI RA vì sao không có gì để gán',
    ).toBeVisible();
    await expect(page.getByText(E2E_SA.email).first()).toBeVisible();

    /* ---- Bấm tiêu đề cột = chiều gán theo NHÓM ---- */

    await grid.getByRole('button', { name: 'Gán "Phần mềm: License" cho nhiều người' }).click();
    const bulk = page.getByRole('dialog', { name: 'Gán "Phần mềm: License" cho người dùng' });
    await expect(
      bulk,
      'bấm tiêu đề cột phải mở hộp gán HÀNG LOẠT cho đúng nhóm đó — mở vòng an toàn cho một ' +
        'nhóm thường là việc của cả tổ trực, không phải một người',
    ).toBeVisible();

    await bulk.getByRole('button', { name: 'Đóng hộp thoại' }).click();
    await expect(bulk, 'nút ✕ phải đóng được hộp').toBeHidden();

    /* ---- Chú giải ba tầng ---- */

    await expect(
      page.getByText(/Xem thẳng.*Cần duyệt.*Không có quyền/),
      'lưới toàn ký hiệu ✓ ⏳ – nên PHẢI có chú giải đủ ba tầng, không thì không ai đọc được nó',
    ).toBeVisible();
  });

  /* ================================================================== *
   * BÀI 3 — Phòng Duyệt yêu cầu: ba ngăn, phiếu treo, đúng bộ nút
   * ================================================================== */

  /*
   * VÌ SAO BÀI NÀY TỒN TẠI
   *
   * `break-glass.spec.ts` chứng minh NGHIỆP VỤ duyệt chạy đúng: xin → duyệt → xem được trong
   * hạn. Nó luôn tới bằng `getByRole('button', { name: 'Duyệt' }).first()`, nên nó không biết
   * — và không thể biết — cái phiếu đó còn nút nào khác, thanh tab còn ngăn nào, hay nút Xuất
   * Excel đang nằm ở tab nào.
   *
   * Ba câu bài này hỏi, không câu nào bài kia hỏi được:
   *   1. Thanh tab có ĐỦ BA ngăn, và ngăn "Chờ duyệt" có đếm số.
   *   2. Phiếu treo hiện đủ thứ người duyệt cần để QUYẾT (ai xin, lúc nào, lý do, đối tượng,
   *      xin bao lâu) và có ĐÚNG hai nút. Một nút thứ ba mọc ra ở đây — "Duyệt nhanh", "Duyệt
   *      tất cả" — là một quyết định an ninh, không phải một cải tiến giao diện.
   *   3. Nút Xuất Excel CHỈ ở tab Nhật ký. File luôn là toàn bộ lịch sử, nên để nó ở tab "Chờ
   *      duyệt" là người đang xem 1 phiếu bấm Xuất và im lặng nhận cả kho.
   *
   * Phiếu treo dựng bằng `page.request` từ một trình duyệt thứ hai của Member: điều đang kiểm
   * là PHÒNG CÓ GÌ, không phải nghiệp vụ duyệt.
   */
  test('Phòng Duyệt yêu cầu: đủ ba ngăn, phiếu treo nói đủ và có đúng hai nút', async ({
    page,
    browser,
  }) => {
    // Hai luồng đăng nhập lần đầu (SA ở đây, Member ở trình duyệt thứ hai).
    test.setTimeout(150_000);
    await firstLogin(page, E2E_SA);

    const stamp = uniqueStamp();
    const typeId = await deviceTypeId(page, 'Switch');
    const deviceCode = `SW-E2E-DUYET-${stamp}`;
    const deviceId = await seedDevice(page, deviceCode, 'Switch');
    await stash(page, 'device', deviceId, `admin web E2E ${stamp}`);

    // Member phải ở tầng "cần duyệt" thì mới xin được: trắng trơn là xin cũng bị từ chối.
    const granted = await page.request.post('/api/v1/vault/access', {
      headers: await writeHeaders(page),
      data: {
        memberEmail: E2E_MEMBER.email,
        scopeType: 'device_type',
        scopeRef: typeId,
        tier: 'needs_approval',
      },
    });
    expect(granted.ok(), 'không gán được tầng "cần duyệt" thì Member không xin được gì').toBeTruthy();

    const reason = `E2E ${stamp}: switch tầng 3 mất kết nối, cần vào cấu hình`;
    const memberCtx = await browser.newContext(SECOND_BROWSER);
    const memberPage = await memberCtx.newPage();
    try {
      await firstLogin(memberPage, E2E_MEMBER);
      const asked = await memberPage.request.post('/api/v1/vault/break-glass', {
        headers: await writeHeaders(memberPage),
        data: { ownerType: 'device', ownerId: deviceId, reason, hours: 4 },
      });
      expect(asked.status(), 'không dựng được phiếu treo thì cả bài không có gì để soi').toBe(201);
    } finally {
      await memberCtx.close();
    }

    await page.goto('/approvals');
    await expect(page.getByRole('heading', { level: 1, name: 'Duyệt mở két' })).toBeVisible();

    /*
     * ĐỦ BA NGĂN. Nhãn tab "Chờ duyệt" có số đếm nối sau kèm dấu cách, nên cắt phần số đi rồi
     * mới so tên — còn CÓ số hay không thì khẳng định riêng ngay dưới.
     */
    const tabNames = (await page.getByRole('tab').allTextContents()).map((name) =>
      name.replace(/\s*\d+$/, '').trim(),
    );
    expect(
      tabNames,
      'SA phải thấy đủ ba ngăn: việc phải làm · sổ để trình auditor · việc của chính mình',
    ).toEqual(['Chờ duyệt', 'Nhật ký', 'Yêu cầu của tôi']);
    await expect(
      page.getByRole('tab', { name: /^Chờ duyệt/ }),
      'ngăn "Chờ duyệt" phải đeo số đếm — người trực cần biết còn mấy phiếu mà không phải mở ra',
    ).toHaveText(/^Chờ duyệt \d+$/);

    /* ---- Phiếu treo: nói đủ những gì người duyệt cần để quyết ---- */

    const panel = page.getByRole('tabpanel');
    await expect(panel.getByText(reason), 'phiếu phải hiện LÝ DO — không có lý do thì quyết bằng gì')
      .toBeVisible();
    await expect(
      panel.getByText('Chờ duyệt', { exact: true }),
      'phiếu phải đeo huy hiệu trạng thái "Chờ duyệt"',
    ).toBeVisible();
    await expect(panel.getByText(E2E_MEMBER.email), 'phiếu phải nói rõ AI xin').toBeVisible();
    await expect(
      panel.getByRole('link', { name: new RegExp(`^${deviceCode} · `) }),
      'phiếu phải nói xin quyền trên ĐỐI TƯỢNG nào — bằng mã + tên, bấm sang được hồ sơ',
    ).toHaveAttribute('href', `/devices/${deviceId}`);
    await expect(
      panel.getByText('Thiết bị', { exact: true }),
      'kèm loại đối tượng',
    ).toBeVisible();
    await expect(
      panel.getByText(/[0-9a-f]{8}-[0-9a-f]{4}/),
      'không còn in UUID ra thẻ phiếu',
    ).toHaveCount(0);
    await expect(panel.getByText('Thời hạn xin', { exact: true }), 'phiếu phải nói xin BAO LÂU').toBeVisible();
    await expect(panel.getByText('4 giờ', { exact: true })).toBeVisible();

    /*
     * Phiếu CHƯA quyết thì KHÔNG được có hai ô của phần quyết định. Cặp khẳng định âm này là
     * phần nói được nhiều nhất: nó chốt rằng vốn từ của thẻ phiếu đúng bằng những gì trạng
     * thái hiện tại cho phép, chứ không phải một khuôn cứng vẽ sẵn mọi ô rồi để trống.
     */
    await expect(
      panel.getByText('Người quyết', { exact: true }),
      'phiếu đang treo thì chưa có ai quyết — hiện ô đó ra là nói dối',
    ).toHaveCount(0);
    await expect(
      panel.getByText('Hết hạn', { exact: true }),
      'chưa duyệt thì chưa có mốc hết hạn',
    ).toHaveCount(0);

    expect(
      await panel.getByRole('button').allTextContents(),
      'phiếu treo phải có ĐÚNG hai nút: Từ chối (trái) và Duyệt (phải, vùng ngón cái). Một nút ' +
        'thứ ba ở đây ("duyệt tất cả") là một quyết định an ninh, không phải một cải tiến giao diện',
    ).toEqual(['Từ chối', 'Duyệt']);

    /* ---- Nút Xuất Excel CHỈ ở ngăn Nhật ký ---- */

    const exportBtn = page.getByRole('button', { name: 'Xuất Excel' });
    await expect(
      exportBtn,
      'ở ngăn "Chờ duyệt" mà có nút Xuất thì người xem 1 phiếu bấm vào sẽ im lặng nhận CẢ KHO',
    ).toHaveCount(0);

    await page.getByRole('tab', { name: 'Nhật ký', exact: true }).click();
    await expect(
      exportBtn,
      'ngăn "Nhật ký" là thứ đem đi trình auditor — nó PHẢI xuất được ra file',
    ).toBeVisible();
    await expect(
      page.getByRole('tabpanel').getByText(reason),
      'nhật ký phải chứa cả phiếu đang treo, không chỉ phiếu đã quyết',
    ).toBeVisible();
    /*
     * Nhật ký là sổ để TRA: phiếu đang treo ở đây không có nút Duyệt/Từ chối (hai nơi quyết
     * cùng một việc), chỉ có đường sang tab Chờ duyệt.
     */
    await expect(
      page.getByRole('tabpanel').getByRole('button', { name: 'Duyệt', exact: true }),
      'nhật ký không được là nơi thứ hai cấp quyền mở két',
    ).toHaveCount(0);
    await expect(
      page.getByRole('tabpanel').getByRole('button', { name: 'Đi tới Chờ duyệt' }).first(),
    ).toBeVisible();

    await page.getByRole('tab', { name: 'Yêu cầu của tôi', exact: true }).click();
    await expect(exportBtn, 'ngăn "Yêu cầu của tôi" không phải sổ trình auditor').toHaveCount(0);
    await expect(
      page.getByRole('tabpanel').getByText('Bạn chưa gửi yêu cầu nào'),
      'SA chưa tự xin bao giờ — ngăn này phải nói ĐÚNG câu đó, không mượn câu của Nhật ký',
    ).toBeVisible();
  });

  /* ================================================================== *
   * BÀI 4 — Bảng điều khiển: từng khối bên trong, và khối nào KHÔNG cho Member
   * ================================================================== */

  /*
   * VÌ SAO BÀI NÀY TỒN TẠI
   *
   * File này đã có một bài đi hết các LINK "Xem toàn bộ" của bảng điều khiển. Link là sợi dây
   * đi RA; bài này đếm những gì đang nằm TRONG phòng.
   *
   * Và nó tồn tại chủ yếu vì nửa sau: hai khối "Két lâu chưa đổi" và "Break-glass tuần qua"
   * bị server rút gọn theo vai. "Két lâu chưa đổi" là danh sách chủ thể đang giữ mật khẩu cũ;
   * "Break-glass tuần qua" là danh sách ai đang xin quyền khẩn cấp vào mật khẩu nào. Lọt sang
   * Member là rò rỉ an ninh — mà nó lọt một cách hoàn toàn êm ái: giao diện đẹp, không lỗi,
   * không ai báo.
   *
   * `dashboard.spec.ts` đã kiểm phần dữ liệu của hai khối đó theo vai. Bài này kiểm phần KHÁC:
   * TẬP HỢP khối mà mỗi vai nhìn thấy, và so hai tập hợp với nhau — hiệu của chúng phải đúng
   * bằng hai cái tên đó, không hơn không kém. So bằng `toHaveCount(0)` hai chuỗi thì một khối
   * thứ ba rò sang Member sẽ không ai biết.
   *
   * ĐỎ KHI: thêm/bớt một khối mà quên; một khối rụng khỏi bảng của SA; hoặc một khối chỉ dành
   * cho SA xuất hiện ở bảng của Member.
   */
  test('Bảng điều khiển: SA thấy đủ sáu khối, Member thiếu đúng hai khối an ninh', async ({
    page,
  }) => {
    // Hai luồng đăng nhập lần đầu đầy đủ (SA rồi Member) trong cùng một bài.
    test.setTimeout(150_000);

    await firstLogin(page, E2E_SA);
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Bảng điều khiển' })).toBeVisible();

    /*
     * Mỗi khối là một `<section class="card">` mở đầu bằng `<h2>`, và trên màn này KHÔNG có
     * `<h2>` nào khác — nên gom hết `heading level 2` là gom đúng danh sách khối.
     */
    // Ngưỡng dải mạng nằm TRONG tiêu đề ("Dải mạng ≥ 80%", DASH-016) — quy về một tên để so.
    // Hai khối "việc của tôi" (Cần bạn duyệt / Yêu cầu mở két của tôi) chỉ hiện khi có việc,
    // tuỳ dữ liệu bài trước để lại — không thuộc danh sáu khối cố định.
    const blockTitles = async () =>
      (await page.getByRole('main').getByRole('heading', { level: 2 }).allTextContents())
        .map((title) => title.replace(/^Dải mạng ≥ \d+%$/, 'Dải mạng ≥ N%'))
        .filter((title) => !/^(Cần bạn duyệt|Yêu cầu mở két của tôi)/.test(title));

    const saBlocks = await blockTitles();
    expect(
      asSet(saBlocks),
      'SA phải thấy đủ sáu khối — mục tiêu của epic là "sếp 3 phút sáng thứ Hai tự trả lời mọi câu hỏi"',
    ).toEqual(
      asSet([
        'Hạn cần xử lý',
        'Dải mạng ≥ N%',
        'Két lâu chưa đổi',
        'Sự cố tuần qua',
        'Yêu cầu mở két tuần qua',
        'Vừa vào kho thanh lý (7 ngày)',
      ]),
    );

    /*
     * Khối của epic chưa mở vẫn HIỆN, và phải nói rõ là CHƯA THEO DÕI.
     *
     * "Chưa có phần này" khác hẳn "tuần qua không có sự cố nào". Giấu khối đi — hoặc để nó
     * hiện một ô trống — là cách nhanh nhất để sếp yên tâm nhầm.
     */
    await expect(
      page.getByText('IMS chưa theo dõi sự cố. Sự cố hiện vẫn ghi ở nơi cũ.'),
      'khối "Sự cố tuần qua" phải nói thẳng là epic chưa mở, không được im lặng như một khối rỗng',
    ).toBeVisible();

    /* ---- Đổi người: cùng một màn, ít khối hơn ---- */

    await logout(page);
    await firstLogin(page, E2E_MEMBER);
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Bảng điều khiển' })).toBeVisible();
    // Chờ một khối chắc chắn có, để không đếm lúc trang mới dựng được nửa.
    await expect(
      page.getByRole('heading', { level: 2, name: 'Hạn cần xử lý' }),
      'Member vẫn phải thấy khối "Sắp hết hạn" — cắt theo vai không phải là cắt sạch',
    ).toBeVisible();

    const memberBlocks = await blockTitles();
    expect(
      asSet(memberBlocks),
      'Member phải thấy đúng bốn khối không dính bí mật',
    ).toEqual(
      asSet([
        'Hạn cần xử lý',
        'Dải mạng ≥ N%',
        'Sự cố tuần qua',
        'Vừa vào kho thanh lý (7 ngày)',
      ]),
    );

    /*
     * SO HAI TẬP HỢP, không so hai chuỗi.
     *
     * Hiệu của chúng phải đúng bằng hai cái tên dưới đây. Viết thành hai lượt
     * `toHaveCount(0)` thì một khối THỨ BA rò sang Member sẽ không làm đỏ gì cả — mà đó chính
     * là kiểu rò rỉ bài này sinh ra để chặn.
     */
    const missing = saBlocks.filter((title) => !memberBlocks.includes(title));
    expect(
      asSet(missing),
      'Member KHÔNG được thấy hai khối an ninh — và cũng không được thiếu khối nào khác: ' +
        `SA thấy [${saBlocks.join(' | ')}], Member thấy [${memberBlocks.join(' | ')}]`,
    ).toEqual(asSet(['Két lâu chưa đổi', 'Yêu cầu mở két tuần qua']));
  });

  /* ================================================================== *
   * BÀI 5 — Bên trong các hộp thoại của phòng Két sắt
   * ================================================================== */

  /*
   * VÌ SAO BÀI NÀY TỒN TẠI
   *
   * Ba hộp thoại đứng ngay cửa két — Cất mật khẩu/khóa, Xác nhận danh tính, Hiện secret — và cả ba
   * đều đã có bài kiểm ĐƯỜNG ĐI (`vault.spec.ts`, `vault-reveal.spec.ts`,
   * `vault-write-stepup-ui.spec.ts`). Không bài nào trong đó mở hộp ra rồi ĐẾM xem bên trong
   * có ô nào. Nghĩa là:
   *   - Một ô thứ năm mọc thêm vào hộp "Cất mật khẩu/khóa" (một ô "dán từ file", một ô "gửi mail
   *     cho") sẽ đi qua sạch sẽ.
   *   - Ô "Giá trị" đổi từ `type=password` sang `type=text` — mật khẩu hiện nguyên trên màn
   *     lúc gõ — không làm đỏ gì cả, vì mọi bài đều `fill()` được như nhau.
   *   - Thanh đo độ khó ĐỔI TỪ CẢNH BÁO THÀNH CHẶN. Đây là thứ `docs/SHARED-REGISTRY.md` nói
   *     thẳng là không được làm: chặn cứng không làm mật khẩu cái camera mạnh lên, nó chỉ đẩy
   *     người dùng ghi mật khẩu thật vào ô "Ghi chú" — chỗ KHÔNG mã hóa.
   *   - Hộp "Xác nhận danh tính" ĐÓNG khi gõ sai mã. Đây là hàng rào cuối trước khi lộ một bí
   *     mật; một hộp đóng nhầm ở đây là một lần lộ.
   *
   * Đi vào bằng popup của `/vault` chứ không bằng tab của trang chi tiết: đó là cửa của phòng
   * này, và `VaultPanel` nhúng trong popup phải cư xử y hệt bản nhúng ở trang chi tiết (AD-15).
   */
  test('Bên trong hộp Cất mật khẩu/khóa, hộp Xác nhận danh tính và hộp Hiện secret', async ({ page }) => {
    test.setTimeout(150_000);
    const totpSecret = await firstLogin(page, E2E_SA);

    const stamp = uniqueStamp();
    const deviceCode = `PC-E2E-HOP-${stamp}`;
    const deviceId = await seedDevice(page, deviceCode);
    // Một ngăn có sẵn để trang tổng liệt kê được chủ thể này.
    await stash(page, 'device', deviceId, `ngan-co-san E2E ${stamp}`);

    await page.goto('/vault');
    await page
      .getByRole('main')
      .getByRole('row', { name: new RegExp(deviceCode) })
      .getByRole('button', { name: `Mở két của ${deviceCode}` })
      .click();
    const popup = page.getByRole('dialog', { name: new RegExp(`^Két sắt — ${deviceCode}`) });
    await expect(popup).toBeVisible();

    /* ---------- HỘP "CẤT SECRET": có ô nào, ô nào bắt buộc ---------- */

    await popup.getByRole('button', { name: 'Cất mật khẩu/khóa' }).click();
    const form = page.getByRole('dialog', { name: 'Cất mật khẩu/khóa' });
    await expect(form).toBeVisible();

    expect(
      await textboxLabels(form),
      'hộp "Cất mật khẩu/khóa" phải có ĐÚNG bốn ô chữ. Một ô thứ năm ở đây là một quyết định về nơi ' +
        'chứa bí mật, không phải một cải tiến giao diện',
    ).toEqual(['Tên gọi', 'Tên đăng nhập', 'Giá trị', 'Ghi chú']);

    expect(
      await selectLabels(form),
      'hộp "Cất mật khẩu/khóa" phải có ĐÚNG một ô chọn: Loại',
    ).toEqual(['Loại']);

    /*
     * Ô "Giá trị" phải là ô MẬT KHẨU.
     *
     * `type=password` không phải chi tiết trang trí: đổi nó sang `text` là mật khẩu hiện
     * nguyên trên màn hình lúc gõ, và mọi bài kiểm hiện có vẫn xanh vì `fill()` không phân
     * biệt hai loại ô.
     */
    await expect(
      form.getByLabel('Giá trị'),
      'ô Giá trị phải che ký tự lúc gõ — người ngồi cạnh không được đọc trộm mật khẩu qua vai',
    ).toHaveAttribute('type', 'password');

    // Ô chọn "Loại" có gì bên trong. Option PORTAL ra ngoài hộp → tìm ở cấp `page`.
    await form.getByRole('button', { name: 'Loại' }).click();
    expect(
      await page.getByRole('option').allTextContents(),
      'két chỉ nhận đúng ba loại nội dung — thêm loại thứ tư là phải sửa cả CHECK ở tầng DB',
    ).toEqual(['Mật khẩu', 'License key', 'Khác']);
    /*
     * Đổi ý thì bấm Esc — đúng thứ người dùng làm, và nó phải đóng MENU chứ không đóng cả hộp
     * (lỗi 10/09, đã vá ở `ui/dialog.tsx`; bài cuối khối này canh cho nó không tái phát).
     */
    await page.keyboard.press('Escape');
    await expect(
      page.getByRole('option'),
      'Esc phải đóng menu ô chọn — còn mở thì cú bấm kế tiếp rơi trúng một option',
    ).toHaveCount(0);

    /* ---- Đường hỏng 0: bấm Lưu khi trống hẳn (DEV-025) ---- */

    /*
     * Form đặt `noValidate`: bong bóng "Please fill out this field." của trình duyệt không còn
     * chặn trước. Hai ô bắt buộc cùng thiếu → hai câu tiếng Việt dưới hai ô + dòng tóm tắt.
     */
    await form.getByRole('button', { name: 'Lưu' }).click();
    await expect(form.getByText('Còn 2 ô cần sửa trước khi lưu.')).toBeVisible();
    await expect(
      form.getByRole('textbox', { name: 'Tên gọi' }),
      'câu lỗi nằm dưới và nối vào đúng ô Tên gọi',
    ).toHaveAccessibleDescription('Đặt tên gọi cho ngăn này (vd "admin web", "SSH root").');
    await expect(form.getByRole('textbox', { name: 'Tên gọi' }), 'tiêu điểm về ô lỗi đầu tiên').toBeFocused();

    /* ---- Đường hỏng 1: tên gọi chỉ có khoảng trắng ---- */

    // Khoảng trắng là "có nội dung" với trình duyệt nhưng thua phép `.trim()` của form.
    await form.getByRole('textbox', { name: 'Tên gọi' }).fill('   ');
    await form.getByLabel(/^\s*Giá trị\s*\*?\s*$/).fill(`Tam#Thoi#${stamp}`);
    await form.getByRole('button', { name: 'Lưu' }).click();
    await expect(
      form.getByRole('textbox', { name: 'Tên gọi' }),
      'bỏ trống tên gọi thì phải nói ra ĐÚNG câu tiếng Việt, ngay dưới ô',
    ).toHaveAccessibleDescription('Đặt tên gọi cho ngăn này (vd "admin web", "SSH root").');
    await expect(form, 'báo lỗi mà hộp vẫn phải mở — đóng đi là mất sạch thứ vừa gõ').toBeVisible();

    /* ---- Đường hỏng 2: có tên gọi nhưng chưa có giá trị ---- */

    const label = `admin web E2E ${stamp}`;
    await form.getByLabel('Tên gọi').fill(label);
    const oGiaTri = form.getByLabel(/^\s*Giá trị\s*\*?\s*$/);
    await oGiaTri.fill('');
    await form.getByRole('button', { name: 'Lưu' }).click();
    await expect(
      oGiaTri,
      'ô Giá trị trống: câu tiếng Việt dưới ô (trước đây là bong bóng tiếng Anh, câu này chưa từng hiện)',
    ).toHaveAccessibleDescription(/Chưa nhập giá trị cần cất\./);
    await expect(oGiaTri).toHaveAttribute('aria-invalid', 'true');
    await expect(
      form.getByRole('textbox', { name: 'Tên gọi' }),
      'ô Tên gọi đã sửa xong thì lỗi của nó phải tự tắt',
    ).not.toHaveAttribute('aria-invalid', 'true');
    await expect(form, 'bị chặn thì hộp vẫn phải mở, không mất thứ vừa gõ').toBeVisible();

    /* ---- Giá trị YẾU: cảnh báo hiện, nhưng VẪN LƯU ĐƯỢC ---- */

    const weakValue = `yeu${stamp}`; // đủ dài, có chữ thường + chữ số; thiếu chữ HOA và ký tự đặc biệt
    await form.getByLabel('Giá trị').fill(weakValue);
    await expect(
      form.getByTestId('secret-strength'),
      'gõ ký tự đầu tiên là thanh đo phải hiện — nó là lời khuyên lúc gõ, không phải phán xét sau',
    ).toBeVisible();
    await expect(
      form.getByTestId('secret-strength-warning'),
      'giá trị thiếu chữ HOA và ký tự đặc biệt thì phải bị chê',
    ).toHaveText(
      'Giá trị này chưa đủ mạnh — vẫn lưu được, nhưng nếu là mật khẩu do mình đặt thì nên đổi.',
    );
    await expect(
      form.getByRole('button', { name: 'Lưu' }),
      'CẢNH BÁO, KHÔNG CHẶN: khóa nút Lưu ở đây là đẩy người dùng ghi mật khẩu thật vào ô ' +
        'Ghi chú — chỗ không được mã hóa. Xem docs/SHARED-REGISTRY.md trước khi đổi',
    ).toBeEnabled();

    await form.getByRole('button', { name: 'Lưu' }).click();
    await expect(form, 'lưu xong thì hộp phải đóng').toBeHidden();
    await expect(
      popup.getByRole('cell', { name: label }).first(),
      'giá trị yếu vẫn phải được cất thật, không chỉ là "hộp đóng lại rồi"',
    ).toBeVisible();

    /* ---------- HỘP "XOAY": một ô, và Esc đóng được ---------- */

    await rowAction(page, label, 'Đổi giá trị');
    const rotate = page.getByRole('dialog', { name: `Đổi giá trị: ${label}` });
    await expect(rotate).toBeVisible();
    expect(
      await textboxLabels(rotate),
      'hộp Xoay chỉ đổi GIÁ TRỊ — nó không được mọc thêm ô metadata nào (đó là việc của hộp Sửa)',
    ).toEqual(['Giá trị mới']);
    await expect(rotate.getByLabel('Giá trị mới')).toHaveAttribute('type', 'password');

    /*
     * Xoay RỖNG: cùng hàng rào với hộp Cất — form `noValidate`, câu tiếng Việt dưới ô.
     */
    await rotate.getByRole('button', { name: 'Đổi giá trị' }).click();
    await expect(
      rotate.getByLabel('Giá trị mới'),
      'xoay rỗng phải bị chặn bằng câu tiếng Việt ngay dưới ô',
    ).toHaveAccessibleDescription('Chưa nhập giá trị cần cất.');
    await expect(rotate, 'bị chặn thì hộp Xoay vẫn phải mở').toBeVisible();

    await rotate.getByLabel('Giá trị mới').fill('yeu');
    await expect(
      rotate.getByTestId('secret-strength-warning'),
      'xoay là lúc người ta ĐẶT giá trị mới — thanh đo ở đây còn đáng nói hơn lúc cất lần đầu',
    ).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(rotate, 'Esc phải đóng được hộp Xoay').toBeHidden();
    await expect(popup, 'đóng hộp con thì popup két vẫn phải còn đó').toBeVisible();

    /* ---------- HỘP "XÁC NHẬN DANH TÍNH": hàng rào cuối ---------- */

    // Hết grace — từ đây mở két phải gõ lại mã 6 số.
    expireStepUp(E2E_SA.email);

    /*
     * Bấm "Xem" của ĐÚNG dòng vừa cất, không phải `.first()`.
     *
     * Trong két này có hai ngăn và API không hứa thứ tự nào cả; `.first()` là một bài kiểm
     * quay xổ số — nó sẽ mở ngăn kia, rồi khẳng định giá trị ở cuối bài đỏ theo kiểu chẳng
     * liên quan gì tới điều đang kiểm.
     */
    await popup
      .getByRole('row', { name: new RegExp(label) })
      .getByRole('button', { name: 'Xem' })
      .click();
    /*
     * VLT-062: popup két đã là một hộp, nên bước gõ mã và bước hiện giá trị chạy NGAY TRONG
     * hộp đó — không chồng thêm hộp nào. Luôn chỉ MỘT hộp đang mở.
     */
    const stepUp = popup.getByRole('region', { name: 'Xác nhận danh tính' });
    await expect(
      stepUp,
      'hết grace mà bấm Xem thì phải được HỎI MÃ, không phải một toast lỗi rồi bỏ mặc',
    ).toBeVisible();
    await expect(page.getByRole('dialog'), 'bước mã nằm trong popup, không chồng hộp').toHaveCount(1);
    // Hộp nêu ĐÚNG ngăn đang mở (VLT-047) — người ta biết mình gõ mã để xem cái gì.
    await expect(stepUp.getByText(`Nhập mã 6 số để xem "${label}".`)).toBeVisible();

    expect(
      await textboxLabels(stepUp),
      'hộp xác nhận danh tính phải có ĐÚNG một ô: mã 6 số. Thêm ô nào ở đây cũng là thêm một ' +
        'đường đi vòng qua hàng rào cuối',
    ).toEqual(['Mã xác thực']);
    // Không dùng `maxlength`: mã dán kèm khoảng trắng ("123 456") sẽ bị trình duyệt cắt trước khi
    // lọc. Ô tự bỏ ký tự không phải số và cắt còn 6 — gõ 5 số để không kích hoạt tự gửi.
    await stepUp.getByLabel('Mã xác thực').fill('12 34 5x');
    await expect(
      stepUp.getByLabel('Mã xác thực'),
      'ô mã chỉ giữ chữ số ngay tại chỗ gõ',
    ).toHaveValue('12345');
    await stepUp.getByLabel('Mã xác thực').fill('');
    expect(
      await stepUp.getByRole('button').allTextContents(),
      'bước mã phải có đúng cặp Quay lại / Xác nhận',
    ).toEqual(['‹ Quay lại danh sách ngăn', 'Xác nhận']);

    /* ---- Gõ SAI mã: hộp KHÔNG được đóng ---- */

    await stepUp.getByLabel('Mã xác thực').fill('000000');
    await expect(
      stepUp.getByRole('alert'),
      'gõ sai mã phải nói thẳng là sai mã, không phải một lỗi chung chung',
    ).toHaveText('Mã xác thực không đúng.');
    await expect(
      stepUp,
      'GÕ SAI MÃ MÀ HỘP ĐÓNG LẠI LÀ MỘT LẦN LỘ BÍ MẬT — đây là hàng rào cuối, nó phải đứng nguyên',
    ).toBeVisible();
    await expect(
      stepUp.getByLabel('Mã xác thực'),
      'mã TOTP chỉ sống 30 giây — giữ lại con số vừa bị từ chối chỉ dụ người ta bấm lại lần nữa',
    ).toHaveValue('');
    await expect(
      page.getByTestId('secret-value'),
      'chưa qua được hàng rào thì tuyệt đối chưa được thấy giá trị',
    ).toHaveCount(0);

    /* ---- Gõ ĐÚNG mã: sang hộp hiện secret ---- */

    await stepUp.getByLabel('Mã xác thực').fill(await freshTotpCode(totpSecret));
    await expect(stepUp).toBeHidden();

    /* ---------- HỘP "HIỆN SECRET": đủ bộ ba, và một nút ẩn ngay ---------- */

    const reveal = popup.getByRole('region', { name: label });
    await expect(reveal).toBeVisible();
    await expect(page.getByRole('dialog'), 'bước giá trị cũng nằm trong popup').toHaveCount(1);
    await expect(
      reveal.getByTestId('secret-value'),
      'gõ đúng mã rồi thì phải thấy đúng giá trị vừa cất',
    ).toHaveText(weakValue);
    await expect(
      reveal.getByTestId('reveal-countdown'),
      'phải có đồng hồ "còn hiện bao lâu" — không có thì giá trị biến mất đột ngột giữa lúc đang chép',
    ).toBeVisible();
    await expect(
      reveal.getByTestId('stepup-countdown'),
      'phải có đồng hồ thứ hai "còn mở két được bao lâu" — thiếu nó thì mở ngăn kế tiếp bị hỏi ' +
        'mã giữa chừng mà không hiểu vì sao, dù mốc đó vốn đoán trước được',
    ).toBeVisible();
    await expect(
      reveal.getByText('Lượt xem này đã được ghi nhật ký.'),
      'người xem phải BIẾT là lượt xem này có vết — đó là nửa sức răn đe của cơ chế',
    ).toBeVisible();
    expect(
      await reveal.getByRole('button').allTextContents(),
      'bước hiện giá trị chỉ có nút đổi cách hiện và "Ẩn ngay" — không nút sao chép, FR-026',
    ).toEqual(['Hiện từng ký tự', 'Ẩn ngay']);

    await reveal.getByRole('button', { name: 'Ẩn ngay' }).click();
    await expect(reveal, 'bấm "Ẩn ngay" phải giấu giá trị đi ngay lập tức').toBeHidden();
    await expect(page.getByTestId('secret-value')).toHaveCount(0);
    // Ẩn xong là về lại danh sách ngăn của CÙNG popup, không đóng popup.
    await expect(popup.getByRole('row', { name: new RegExp(label) })).toBeVisible();
  });

  /* ================================================================== *
   * BÀI 6 — Bên trong hai hộp quyết định và hộp gán quyền hàng loạt
   * ================================================================== */

  /*
   * VÌ SAO BÀI NÀY TỒN TẠI
   *
   * Hộp "Duyệt" và hộp "Từ chối" nhìn ngoài giống nhau, và đó chính là bẫy: chúng KHÔNG được
   * giống nhau. Hộp Duyệt có ô SỐ GIỜ và ô đó sửa được — người duyệt nhìn lý do rồi quyết,
   * chứ không phải bấm đồng ý với con số người xin tự đặt ("xin 24 giờ để đổi một cái mật
   * khẩu" thì duyệt 2 giờ là đủ). Hộp Từ chối KHÔNG được có ô đó: cấp giờ cho một phiếu bị từ
   * chối là vô nghĩa, và một ô thừa ở đó là một cú bấm nhầm chờ sẵn.
   *
   * Hộp gán hàng loạt có một luật âm không kém quan trọng: danh sách người bên trong CHỈ gồm
   * Member. SA/Admin xem được mọi secret theo VAI, nên gán thêm cho họ là một dòng quyền không
   * có tác dụng gì — và người gán sẽ tưởng là đã siết xong.
   *
   * ĐỎ KHI: hai hộp quyết định trôi về giống nhau; ô "Cấp trong bao lâu" bị khóa hoặc biến
   * mất; hộp gán hàng loạt liệt kê cả SA/Admin; hoặc gửi hộp gán khi chưa chọn ai mà nó im
   * lặng đóng lại.
   */
  test('Bên trong hộp Duyệt, hộp Từ chối và hộp gán quyền hàng loạt', async ({ page, browser }) => {
    // Hai luồng đăng nhập lần đầu (SA ở đây, Member ở trình duyệt thứ hai).
    test.setTimeout(150_000);
    await firstLogin(page, E2E_SA);

    const stamp = uniqueStamp();
    const typeId = await deviceTypeId(page, 'Switch');
    const deviceId = await seedDevice(page, `SW-E2E-HOPD-${stamp}`, 'Switch');
    await stash(page, 'device', deviceId, `admin web E2E ${stamp}`);
    await page.request.post('/api/v1/vault/access', {
      headers: await writeHeaders(page),
      data: {
        memberEmail: E2E_MEMBER.email,
        scopeType: 'device_type',
        scopeRef: typeId,
        tier: 'needs_approval',
      },
    });

    const memberCtx = await browser.newContext(SECOND_BROWSER);
    const memberPage = await memberCtx.newPage();
    try {
      await firstLogin(memberPage, E2E_MEMBER);
      const asked = await memberPage.request.post('/api/v1/vault/break-glass', {
        headers: await writeHeaders(memberPage),
        data: {
          ownerType: 'device',
          ownerId: deviceId,
          reason: `E2E ${stamp}: cần vào cấu hình switch`,
          hours: 6,
        },
      });
      expect(asked.status(), 'không dựng được phiếu treo thì không có hộp nào để mở').toBe(201);
    } finally {
      await memberCtx.close();
    }

    /* ---------- HỘP "DUYỆT" ---------- */

    await page.goto('/approvals');
    await page.getByRole('tabpanel').getByRole('button', { name: 'Duyệt', exact: true }).click();

    const approve = page.getByRole('dialog', { name: 'Duyệt mở két', exact: true });
    await expect(approve).toBeVisible();
    await expect(
      approve.getByText(E2E_MEMBER.email),
      'thân hộp phải nêu đích danh người xin — người trực đêm mở ba phiếu liền là quyết nhầm phiếu',
    ).toBeVisible();

    expect(
      await textboxLabels(approve),
      'hộp Duyệt phải có ĐÚNG hai ô: số giờ cấp và ghi chú cho người xin',
    ).toEqual(['Cấp trong bao lâu (giờ)', 'Ghi chú cho người xin']);
    await expect(
      approve.getByLabel('Cấp trong bao lâu (giờ)'),
      'ô giờ điền sẵn con số NGƯỜI XIN đề nghị — người duyệt nhìn lý do rồi mới quyết',
    ).toHaveValue('6');
    await expect(
      approve.getByLabel('Cấp trong bao lâu (giờ)'),
      'và nó phải SỬA ĐƯỢC: khóa lại là biến người duyệt thành cái nút "đồng ý" cho con số ' +
        'người xin tự đặt',
    ).toBeEditable();
    await expect(
      approve.getByText(
        'Rút ngắn được, tối đa 6 giờ như người xin. Vượt trần hệ thống sẽ bị kẹp xuống.',
      ),
      'và phải nói ra là sửa được (chỉ rút ngắn, không cấp quá số xin), không để người duyệt tự đoán',
    ).toBeVisible();
    expect(
      await approve.getByTestId('dialog-footer').getByRole('button').allTextContents(),
      'chân hộp Duyệt: Hủy rồi mới tới Duyệt — thứ tự này giống nhau ở mọi hộp trong app. Nút ' +
        'Duyệt ghi rõ số giờ sẽ cấp, để không ai cấp nhầm 6 giờ khi định cấp 1',
    ).toEqual(['Hủy', 'Duyệt 6 giờ']);

    await approve.getByRole('button', { name: 'Đóng hộp thoại' }).click();
    await expect(approve, 'nút ✕ phải đóng được hộp Duyệt mà không quyết gì cả').toBeHidden();

    /* ---------- HỘP "TỪ CHỐI" — phải KHÁC hộp Duyệt ---------- */

    await page.getByRole('tabpanel').getByRole('button', { name: 'Từ chối', exact: true }).click();
    const deny = page.getByRole('dialog', { name: 'Từ chối yêu cầu', exact: true });
    await expect(deny).toBeVisible();
    await expect(deny.getByText(E2E_MEMBER.email)).toBeVisible();

    expect(
      await textboxLabels(deny),
      'hộp Từ chối chỉ có ô ghi chú. Ô "cấp bao lâu" ở đây là vô nghĩa — và một ô thừa cạnh ' +
        'một nút màu đỏ là một cú bấm nhầm đang chờ sẵn',
    ).toEqual(['Lý do từ chối']);
    expect(
      await deny.getByTestId('dialog-footer').getByRole('button').allTextContents(),
      'chân hộp Từ chối: Hủy rồi mới tới Từ chối',
    ).toEqual(['Hủy', 'Từ chối']);

    await page.keyboard.press('Escape');
    await expect(deny, 'Esc phải đóng được hộp Từ chối').toBeHidden();
    await expect(
      page.getByRole('tabpanel').getByRole('button', { name: 'Duyệt', exact: true }),
      'đóng hộp = KHÔNG quyết: phiếu phải còn treo nguyên với đủ nút',
    ).toBeVisible();

    /* ---------- HỘP GÁN QUYỀN HÀNG LOẠT ---------- */

    const accounts = await page.request.get('/api/v1/accounts?limit=200');
    expect(accounts.ok(), 'không đọc được danh sách tài khoản thì không so được tập hợp').toBeTruthy();
    const memberEmails = ((await accounts.json()) as {
      items: { email: string; role: string }[];
    }).items
      .filter((account) => account.role === 'member')
      .map((account) => account.email);
    expect(memberEmails.length, 'phải có ít nhất một Member để hộp gán có gì mà liệt kê')
      .toBeGreaterThan(0);

    await page.goto('/admin/vault-access?view=matrix');
    const grid = page.getByTestId('access-grid');
    await expect(grid).toBeVisible();
    await page.getByRole('button', { name: 'Nhóm đối tượng' }).click();
    await page.getByRole('option', { name: 'Phần mềm', exact: true }).click();
    await grid.getByRole('button', { name: 'Gán "Phần mềm: License" cho nhiều người' }).click();

    const bulk = page.getByRole('dialog', { name: 'Gán "Phần mềm: License" cho người dùng' });
    await expect(bulk).toBeVisible();

    /*
     * Danh sách người trong hộp phải ĐÚNG BẰNG tập Member của hệ thống.
     *
     * Đếm số ô tick rồi mới soi từng người: đủ số mà thiếu một người thì có nghĩa là có một
     * người LẠ lọt vào — và người lạ ở đây chỉ có thể là SA/Admin, đúng thứ không được có mặt.
     */
    await expect(
      bulk.getByRole('checkbox'),
      `hộp gán chỉ được liệt kê Member (${memberEmails.length} người) — SA/Admin đã xem được ` +
        'mọi secret theo VAI, gán thêm cho họ là một dòng quyền không có tác dụng gì',
    ).toHaveCount(memberEmails.length);
    for (const email of memberEmails) {
      await expect(
        bulk.getByRole('checkbox', { name: new RegExp(email) }),
        `Member ${email} phải có mặt trong hộp gán`,
      ).toHaveCount(1);
    }
    await expect(
      bulk.getByRole('checkbox', { name: new RegExp(E2E_SA.email) }),
      'tài khoản SA tuyệt đối KHÔNG được xuất hiện trong danh sách gán quyền',
    ).toHaveCount(0);

    expect(
      await textboxLabels(bulk),
      'hộp gán hàng loạt chỉ có ĐÚNG một ô chữ: ghi chú',
    ).toEqual(['Ghi chú']);
    expect(
      await selectLabels(bulk),
      'và ĐÚNG một ô chọn: tầng quyền',
    ).toEqual(['Tầng quyền']);

    // Ô chọn tầng có gì bên trong — chỉ hai tầng CẤP được; "không có quyền" là GỠ, không phải gán.
    await bulk.getByRole('button', { name: 'Tầng quyền' }).click();
    expect(
      await page.getByRole('option').allTextContents(),
      'chỉ gán được hai tầng. "Không có quyền" là mặc định và là kết quả của việc GỠ, ' +
        'không phải một lựa chọn để gán',
    ).toEqual(['Cần duyệt', 'Xem thẳng']);
    // Esc đóng MENU, không đóng hộp gán (lỗi 10/09, đã vá ở `ui/dialog.tsx`).
    await page.keyboard.press('Escape');
    await expect(
      page.getByRole('option'),
      'Esc phải đóng menu tầng quyền',
    ).toHaveCount(0);

    /* ---- Đường hỏng: gửi khi chưa chọn ai ---- */

    await bulk.getByRole('button', { name: 'Lưu' }).click();
    await expect(
      bulk.getByRole('alert'),
      'chưa chọn ai mà bấm Lưu thì phải nói ra — im lặng đóng lại là người gán tưởng đã gán xong',
    ).toHaveText('Chọn ít nhất một người.');
    await expect(bulk, 'báo lỗi thì hộp phải còn mở').toBeVisible();

    await bulk.getByRole('button', { name: 'Đóng hộp thoại' }).click();
    await expect(bulk).toBeHidden();
  });

  /* ================================================================== *
   * BÀI 7 — hai lớp chồng nhau, một phím Esc: ai đóng phần của ai
   * ================================================================== */

  /*
   * ===== `Escape` LÚC MENU Ô CHỌN ĐANG MỞ TỪNG THỔI BAY CẢ HỘP THOẠI =====
   *
   * PHÁT HIỆN THẾ NÀO: lượt E2E 10/09, hai bài của khối này đỏ vì hết 150 giây chờ nút "Lưu".
   * Ảnh chụp lúc đỏ nói rõ nút đó không mất — CẢ CÁI HỘP CHỨA NÓ đã biến mất, chỉ còn lớp
   * dưới. Việc duy nhất xảy ra ngay trước đó là một cú `Escape` để đóng menu ô chọn.
   *
   * NGUYÊN NHÂN: `ui/select.tsx` có sẵn nhánh
   * `else if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false); }` — ý định
   * "Escape chỉ đóng MENU" đã được viết ra thành mã. Nó không đạt được, vì
   * `react-dismissable-layer` của Radix nghe `keydown` ở tầng `document` với `capture: true`:
   * tầng bắt chạy XONG trước khi sự kiện kịp bò tới handler React của ô chọn. Không handler
   * nào của con chặn nổi một listener đăng ký ở tài liệu, pha bắt — đó là lý do một dòng
   * `stopPropagation` trông rất hợp lý lại vô hiệu.
   *
   * ĐÃ VÁ (10/09) ở `ui/dialog.tsx`, tại `onEscapeKeyDown` — chỗ DUY NHẤT Radix hỏi ý trước
   * khi đóng. `preventDefault()` làm Radix bỏ lượt đóng, còn sự kiện vẫn bò tiếp nên ô chọn
   * vẫn tự đóng menu của nó: mỗi bên đóng đúng phần của mình. Biết "đang có popover mở" bằng
   * `portalEl.childElementCount > 0` — cả sáu thứ có thể mở đè lên hộp đều portal vào đúng
   * điểm neo ấy, nên không có sổ đăng ký nào để mà quên cập nhật.
   *
   * VÌ SAO BÀI NÀY PHẢI SỐNG TIẾP SAU KHI ĐÃ VÁ: bản vá nằm ở bộ dùng chung (AD-15), nên nó
   * đúng hoặc sai cho MỌI form trong repo cùng một lúc — mọi ô chọn đều dựng từ
   * `ui/select.tsx`, mọi hộp đều dựng từ `ui/dialog.tsx`. Và nó rất dễ bị gỡ mất trong một
   * lượt dọn dẹp tưởng vô hại: `onEscapeKeyDown` đọc như một handler thừa nếu không đọc chú
   * thích. Thứ hỏng lại thì KHÔNG ồn ào — Esc vẫn "đóng cái gì đó", chỉ là đóng nhầm cái, và
   * người dùng mất trắng form vừa gõ mà không có một dòng lỗi nào hiện ra.
   *
   * ĐỎ KHI: chặn ở `onEscapeKeyDown` bị gỡ (Esc lại nuốt cả hộp), hoặc chặn quá tay thành
   * chặn LUÔN cả lượt đóng menu của ô chọn (menu kẹt lại, Esc thành một phím chết).
   */
  test(
    'Esc lúc menu ô chọn đang mở chỉ đóng MENU, không đóng cả hộp thoại',
    async ({ page }) => {
      test.setTimeout(150_000);
      await firstLogin(page, E2E_SA);

      const stamp = uniqueStamp();
      const deviceCode = `PC-E2E-ESC-${stamp}`;
      const deviceId = await seedDevice(page, deviceCode);
      await stash(page, 'device', deviceId, `ngan-co-san E2E ${stamp}`);

      await page.goto('/vault');
      await page
        .getByRole('main')
        .getByRole('row', { name: new RegExp(deviceCode) })
        .getByRole('button', { name: `Mở két của ${deviceCode}` })
        .click();
      const popup = page.getByRole('dialog', { name: new RegExp(`^Két sắt — ${deviceCode}`) });
      await popup.getByRole('button', { name: 'Cất mật khẩu/khóa' }).click();

      const form = page.getByRole('dialog', { name: 'Cất mật khẩu/khóa' });
      await expect(form).toBeVisible();
      // Gõ sẵn một thứ vào form: đó chính là thứ người dùng mất khi hộp bị đóng oan.
      await form.getByLabel('Tên gọi').fill(`admin web E2E ${stamp}`);

      await form.getByRole('button', { name: 'Loại' }).click();
      await expect(page.getByRole('option').first(), 'menu ô chọn phải mở ra đã').toBeVisible();

      await page.keyboard.press('Escape');

      await expect(
        page.getByRole('option'),
        'Esc phải đóng MENU của ô chọn — đó là điều `ui/select.tsx` đã viết ra là mình làm',
      ).toHaveCount(0);
      await expect(
        form,
        'nhưng hộp thoại PHẢI còn đó: một cú Esc để rút lại lựa chọn không được xoá sạch form vừa gõ',
      ).toBeVisible();
      await expect(
        form.getByLabel('Tên gọi'),
        'và thứ đã gõ phải còn nguyên',
      ).toHaveValue(`admin web E2E ${stamp}`);

      /*
       * VÀ CÚ ESC THỨ HAI PHẢI ĐÓNG ĐƯỢC HỘP.
       *
       * Nửa khẳng định này mới làm nửa trên có nghĩa. Chặn Esc vô điều kiện cũng làm mọi
       * khẳng định ở trên xanh — và biến Esc thành một phím chết trên MỌI hộp thoại của
       * repo, một cái hỏng còn phiền hơn cái vừa vá. Chặn phải có ĐIỀU KIỆN: có popover đang
       * mở thì nhường, không thì đóng như thường.
       */
      await page.keyboard.press('Escape');
      await expect(
        form,
        'không còn menu nào mở thì Esc phải đóng hộp như mọi hộp khác — chặn vô điều kiện là ' +
          'giết luôn đường thoát bằng bàn phím',
      ).toBeHidden();
      await expect(
        popup,
        'và chỉ đóng ĐÚNG một lớp: popup két bên dưới vẫn phải còn',
      ).toBeVisible();
    },
  );
});
