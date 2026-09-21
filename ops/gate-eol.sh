#!/usr/bin/env bash
# CỔNG KIỂU XUỐNG DÒNG: cấm file LẪN CRLF và LF trong cùng một file.
#
# ===== VÌ SAO CÓ CỔNG NÀY (21/09/2026) =====
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
# Đếm lúc dựng cổng: 28 file đã lẫn dòng từ trước, gom lại trong một commit riêng.
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
# viết là một cổng sẽ bị tắt trong vòng một tuần. (Đo 21/09: thư mục đó hiện SẠCH, nên đây là
# quyết định về phạm vi, không phải để né một đống nợ.)
set -euo pipefail
cd "$(dirname "$0")/.."

# MỘT lượt `perl` cho TẤT CẢ file, không phải hai `tr` cho mỗi file: bản đầu làm thế và chạy
# quá 5 phút trên Windows — sinh tiến trình ở đó đắt tới mức cổng trở nên vô dụng, mà một cổng
# người ta ngại chạy là một cổng không tồn tại.
#
# `-0777` nuốt trọn từng file; `$ARGV` là tên file đang đọc.
mixed=$(git ls-files -z -- \
    '*.ts' '*.tsx' '*.js' '*.mjs' '*.cjs' '*.json' '*.css' \
    '*.html' '*.md' '*.sql' '*.sh' '*.yml' '*.yaml' \
    ':(exclude).claude/skills/**' \
  | xargs -0 perl -0777 -ne 'my $cr = () = /\r/g; next if $cr == 0; my $lf = () = /\n/g; next if $cr == $lf; print "  $ARGV (CR=$cr LF=$lf)\n";')

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
