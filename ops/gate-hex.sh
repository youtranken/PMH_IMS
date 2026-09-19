#!/usr/bin/env bash
# CỔNG AD-15: cấm hex màu trong LUẬT CSS ngoài `web/src/css/tokens.css`.
#
# MỘT BẢN DUY NHẤT, HAI NƠI GỌI (19/09/2026). Trước file này, cùng một luật được viết hai lần:
# một bản `perl` ở `ops/ci-local.sh` và một bản `grep` thô ở `.github/workflows/ci.yml`. Bản
# nội bộ được sửa ngày 18/09 để bỏ qua chú thích; bản GitHub thì không — nên nhánh
# `feat/ui-chi-tiet-v2` XANH ở máy và ĐỎ ở cổng chặn merge, trên ba file mà lỗi duy nhất là có
# chú thích nhắc tới mã màu. Lỗi BLOCKER 18/09 không mất đi, nó chỉ dịch từ cổng này sang cổng
# kia. Đó đúng lớp lỗi "hai bản luật cho cùng một khái niệm" mà bản vá hôm ấy lên án, nên lần
# này luật ở một chỗ và cả hai nơi gọi vào đây.
#
# VÌ SAO PHẢI BỎ CHÚ THÍCH. `grep` thẳng vào file không phân biệt được một LUẬT CSS đặt màu
# cứng với một CHÚ THÍCH nhắc tới mã màu — mà chú thích kiểu "`--warn` vốn đã là bản ĐẬM
# (#a34d08)" hay "hoà ra #a1a3a0 → 2,54:1" chính là thứ nên khuyến khích: nó ghi lại con số ĐO
# ĐƯỢC, giải thích vì sao luật bên dưới viết như vậy. Cổng báo sai chỗ còn tệ hơn không có
# cổng: nó vừa chặn nhầm, vừa che mất thứ nó phải canh — ở tầng một, nó chặn luôn cả E2E.
#
# `perl -0777` nuốt trọn file rồi xoá mọi khối `/* … */` (kể cả nhiều dòng), sau đó mới soi.
#
# CÒN HỔNG, CÓ CHỦ Ý (rà soát 19/09): cổng này chỉ soi `#hex` trong `.css`. Nó KHÔNG bắt
# `rgb()/rgba()/hsl()` (20 chỗ đang nợ), KHÔNG bắt hex mã hoá URL `%23` trong `url("data:…svg")`
# (3 chỗ), và KHÔNG soi `.tsx`. Mở rộng biểu thức mà chưa dọn những chỗ ấy thì cổng đỏ ngay —
# xem `docs/NO-KY-THUAT-LOW-2026-09-19.md`. Đừng nới luật trước khi dọn.
set -euo pipefail
cd "$(dirname "$0")/.."

# FAIL-CLOSED KHI THIẾU PERL. `perl … | grep -q` nằm trong điều kiện `if`, nên `set -e` không
# áp: perl thoát 127 thì grep đọc đầu vào rỗng và MỌI file được coi là sạch. Một cổng an ninh
# tự tắt trong im lặng rồi in "xanh" thì nguy hiểm hơn hẳn việc không có cổng.
command -v perl >/dev/null 2>&1 || {
  printf '\033[31m✗ Thiếu `perl` — cổng hex không chạy được. Không coi đây là XANH.\033[0m\n'
  exit 1
}

# MIỄN TRỪ THEO ĐƯỜNG DẪN, KHÔNG THEO TÊN FILE (19/09/2026). Bản trước dùng `! -name
# "tokens.css"`, tức miễn cho BẤT KỲ file nào tên `tokens.css` ở bất kỳ đâu dưới `web/src` —
# một `features/x/tokens.css` tương lai được cấp quyền viết hex mà không ai quyết. Bản `grep`
# cũ trên GitHub ghim đúng đường dẫn; gộp hai cổng làm một đã vô tình nới luật ra.
rogue=""
soFile=0
while IFS= read -r f; do
  [ -z "$f" ] && continue
  soFile=$((soFile + 1))
  # Bắt lỗi perl TƯỜNG MINH: `perl … | grep -q` nằm trong `if` thì `set -e`/`pipefail` không
  # áp, nên perl chết giữa chừng (file lỗi mã hoá, hết bộ nhớ) sẽ cho ra đầu vào rỗng và file
  # được coi là SẠCH. Gán vào biến trước rồi mới soi.
  sach=$(perl -0777 -pe 's{/\*.*?\*/}{}gs' "$f") || {
    printf '\033[31m✗ perl hỏng khi đọc %s — không coi đây là XANH.\033[0m\n' "$f"
    exit 1
  }
  if printf '%s' "$sach" | grep -qE "#[0-9a-fA-F]{3,8}\b"; then
    rogue="${rogue}${f}"$'\n'
  fi
done < <(find web/src -name "*.css" ! -path "*/css/tokens.css")

# CHỐT SÀN SỐ FILE. `find` nằm trong process substitution nên mã thoát của nó KHÔNG được kiểm:
# đổi tên thư mục, chạy sai gốc, hay `web/src` biến mất đều cho vòng lặp đọc 0 dòng → `rogue`
# rỗng → exit 0, cổng XANH mà không soi file nào. Đúng chế độ hỏng im lặng mà khối chú thích
# `command -v perl` bên trên tuyên bố đã vá — chỉ vá được một nửa. Repo hiện có ~20 file `.css`;
# sàn 10 đủ rộng để không đỏ oan khi ai đó gộp vài file, đủ hẹp để bắt cảnh quét trượt cả cây.
if [ "$soFile" -lt 10 ]; then
  printf '\033[31m✗ Chỉ quét được %s file .css (chờ ≥10) — cổng không soi đúng cây nguồn.\033[0m\n' "$soFile"
  exit 1
fi

if [ -n "$rogue" ]; then
  printf '\033[31mCó hex màu trong LUẬT CSS ngoài tokens.css:\033[0m\n%s' "$rogue"
  exit 1
fi
