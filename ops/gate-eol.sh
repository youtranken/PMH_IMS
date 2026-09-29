#!/usr/bin/env bash
# CỔNG KIỂU XUỐNG DÒNG: cấm file LẪN CRLF và LF trong cùng một file.
#
# ===== VÌ SAO CÓ CỔNG NÀY =====
#
# Repo trộn kiểu xuống dòng có chủ ý: `core.autocrlf=false`, và `.gitattributes` chỉ đóng băng
# `api/src/migrations/*.sql` (checksum migration băm trên byte thô — xem chú thích ở đó). Trộn
# GIỮA các file thì vô hại. Trộn TRONG một file thì không:
#
#   · `git diff` hiện một dòng "đã sửa" mà nội dung y hệt. Người đọc diff không còn phân biệt
#     được thay đổi thật với nhiễu — và diff là thứ duy nhất đứng giữa một bản vá và production.
#   · Nó sinh ra lặng lẽ: chỉ cần một script thay chuỗi mà chuỗi thay thế mang xuống-dòng kiểu
#     Linux, giữa một file kiểu Windows. Không công cụ nào kêu.
#
# ===== MỘT LỖI THẬT MÀ CỔNG NÀY KHÔNG BẮT, CỐ Ý =====
#
# `ops/ci-local.sh` và `design-ims/build.sh` từng là CRLF TOÀN BỘ — tức không "lẫn", nên cổng
# này im. Hỏng thật nằm ở chỗ khác: `bash` trên Linux chết ở
# `syntax error near unexpected token $'in\r'`, trong khi Git Bash trên Windows nuốt được.
# Luật `*.sh text eol=lf` trong `.gitattributes` mới là thứ canh chuyện đó. Hai luật, hai loại
# hỏng — đừng gộp, và đừng tưởng cổng này thay được luật kia.
#
# ===== BỎ QUA `.claude/skills/` =====
#
# Đó là bộ công cụ BMAD cài vào repo, không phải sản phẩm. Một cổng đỏ vì nội dung người khác
# viết là một cổng sẽ bị tắt trong vòng một tuần. Đây là quyết định về phạm vi, không phải để
# né một đống nợ.
#
# ===== VÀ BỎ QUA `api/src/migrations/*.sql` — ĐÂY MỚI LÀ CHỖ NGUY HIỂM =====
#
# Cổng này in ra một CHỈ DẪN SỬA: "bỏ hết CR rồi thêm lại CR trước mọi LF". Làm đúng chỉ dẫn
# ấy trên một file migration là đổi BYTE của nó — mà `migration-runner` băm sha256 trên byte
# thô và so với checksum đã lưu trong `_migrations`. Lệch là `throw`, và migration chạy TRƯỚC
# `app.listen`, nên MỌI DB đã áp migration đó không boot lại được; đường thoát duy nhất là sửa
# tay bảng `_migrations` trên production.
#
# Tức là: cổng đỏ → người ta làm theo chỉ dẫn của chính nó → hỏng nặng hơn hẳn thứ nó cảnh báo.
#
# Bỏ qua được vì migration KHÔNG cần cổng này: `.gitattributes` khai `-text` cho chúng nên git
# không bao giờ chuẩn hoá, và byte đã ghi là byte vĩnh viễn. Một migration lẫn kiểu xuống dòng
# vẫn chạy đúng — miễn không ai đụng vào nó nữa, và đó chính là luật đã có.
#
# `set -e` bị BỎ có chủ ý — xem chỗ bắt `scan_status` bên dưới.
set -uo pipefail
cd "$(dirname "$0")/.."

# MỘT lượt `perl` cho TẤT CẢ file, không phải hai `tr` cho mỗi file: bản đầu làm thế và chạy
# quá 5 phút trên Windows — sinh tiến trình ở đó đắt tới mức cổng trở nên vô dụng, mà một cổng
# người ta ngại chạy là một cổng không tồn tại.
#
# `-0777` nuốt trọn từng file; `$ARGV` là tên file đang đọc.
#
# Danh sách CHO PHÉP, và ba tệp từng lọt (§18 #13): `Dockerfile`, `web/nginx.conf`,
# `.env.example` không có đuôi nằm trong danh sách — trong khi chúng đúng là loại tệp bị script
# sửa và được đọc THEO DÒNG. Một `Dockerfile` lẫn CRLF mang ký tự CR thẳng vào lệnh `RUN`.
#
# Vẫn giữ danh sách cho phép chứ không quét tất: repo có ảnh, font, `.xlsx` mẫu — quét nhị phân
# thì cổng đỏ vì những thứ không phải văn bản, và một cổng đỏ sai là một cổng bị tắt.
mixed=$(git ls-files -z -- \
    '*.ts' '*.tsx' '*.js' '*.mjs' '*.cjs' '*.json' '*.css' \
    '*.html' '*.md' '*.sql' '*.sh' '*.yml' '*.yaml' \
    'Dockerfile' '*/Dockerfile' '*.conf' '.env.example' \
    ':(exclude).claude/skills/**' \
    ':(exclude)api/src/migrations/*.sql' \
  | xargs -0 perl -0777 -ne 'my $cr = () = /\r/g; next if $cr == 0; my $lf = () = /\n/g; next if $cr == $lf; print "  $ARGV (CR=$cr LF=$lf)\n";')

scan_status=$?

# "CỔNG HỎNG" và "CÓ FILE LẪN EOL" phải nói hai câu khác nhau.
#
# Với `set -e`: thiếu `perl` trên máy, hay `git ls-files` lỗi, thì lệnh gán chết im lặng và
# script thoát khác 0 — TRÔNG Y HỆT "cổng bắt được file lẫn dòng". Người đọc mã thoát
# sẽ đi tìm một file lẫn EOL không hề tồn tại.
if [ "$scan_status" -ne 0 ]; then
  echo "✗ CỔNG HỎNG (không phải repo hỏng): lượt quét thoát mã $scan_status." >&2
  echo "  Thường là thiếu 'perl' hoặc 'xargs' trên máy này. Cài rồi chạy lại." >&2
  exit 2
fi

if [ -n "$mixed" ]; then
  echo "✗ File LẪN kiểu xuống dòng (vừa CRLF vừa LF trong cùng một file):" >&2
  echo "$mixed" >&2
  echo >&2
  echo "Sửa: đọc file ở chế độ NHỊ PHÂN, bỏ hết CR rồi thêm lại CR trước mọi LF (hoặc ngược" >&2
  echo "lại nếu file vốn LF thuần). ĐỪNG dùng 'sed -i' hay Python text-mode — cả hai đổi kiểu" >&2
  echo "xuống dòng của CẢ file, và diff sẽ phình ra hàng nghìn dòng giả." >&2
  exit 1
fi

echo "✓ không file nào lẫn kiểu xuống dòng"
