#!/usr/bin/env bash
# Ghép artboard IMS: _head + shell (sidebar/topbar) + body-<tên> + _tail
set -e
cd "$(dirname "$0")"

mk() {
  name=$1; w=$2; h=$3; active=$4; role=$5; hello=$6
  {
    cat _head.html
    printf '<div class="ims {{themeClass}}" style="width:%spx;min-height:%spx;position:relative">\n' "$w" "$h"
    printf '<div class="shell">\n'
    sed -e "s/__A_${active}__/active/" -e "s/__A_[A-Z]*__//g" -e "s/__ROLE__/${role}/" _sidebar.html
    printf '<div class="content">\n'
    sed -e "s/__HELLO__/${hello}/" _topbar.html
    cat "body-$name.html"
    printf '</div>\n</div>\n</div>\n'
    sed -e "s/__W__/${w}/" -e "s/__H__/${h}/" _tail.html
  } > "$name.dc.html"
  echo "built $name.dc.html"
}

mk Dashboard   1440 1000 DASH  "Admin"  "Vai trò: Admin"
mk Devices     1440 1000 DEV   "Admin"  "Vai trò: Admin"
mk DeviceDetail 1440 1160 DEV  "Admin"  "Vai trò: Admin"
mk Software    1440 1120 SW    "Admin"  "Vai trò: Admin"
mk Expiry      1440 1080 EXP   "Admin"  "Vai trò: Admin"
mk Ipam        1440 1160 IP    "Member" "Vai trò: Member"
mk Vault       1440 980  VAULT "Admin"  "Vai trò: Admin"
mk BreakGlass  1440 1300 BG    "Admin"  "Vai trò: Admin"
mk IsoForm     1440 1560 ISO   "Member" "Vai trò: Member"
mk Documents   1440 940  DOC   "Member" "Vai trò: Member"
