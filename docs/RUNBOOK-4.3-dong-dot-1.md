# Runbook — Đưa IMS lên production (Ubuntu + Docker)

Runbook này là đường đi từ **một máy Ubuntu trắng** tới IMS chạy thật trên LAN, kèm sao lưu,
diễn tập khôi phục và các thao tác vận hành về sau. Làm **đúng thứ tự A → H**; mỗi bước có ô tick.

Ước lượng lần đầu: **1 ngày**, 2 người (một SA + một người giữ phong bì thứ hai).

Quy ước: `$` là lệnh chạy trên máy chủ prod, trong thư mục `/opt/ims`, bằng user thuộc nhóm
`docker`. Lệnh nào cần root thì ghi `sudo`.

## Lối tắt: script cài đặt

Sau khi chuẩn bị xong mục 0, trên máy chủ Ubuntu chỉ cần:

```bash
git clone https://github.com/youtranken/PMH_IMS.git /opt/ims && cd /opt/ims
git checkout <tag-phát-hành>
bash ops/install-ubuntu.sh
```

Script làm hộ mục **A → D**: kiểm docker, tạo `.env` với mật khẩu ngẫu nhiên, sinh `secrets/`
(chown uid 1000), chép cert, dựng stack, tạo 2 SA (in mật khẩu tạm một lần), đặt cron sao lưu +
giám sát. Chạy lại được — bước nào đã xong thì bỏ qua, không ghi đè bí mật. Sau đó làm tay mục
**C** (phong bì), **E** (diễn tập trên VM khác), **F** (nhập dữ liệu). Các mục dưới đây là giải
thích chi tiết từng bước, dùng khi cần làm tay hoặc khi script dừng giữa chừng.

## 0. Chuẩn bị trước

- [ ] Máy chủ Ubuntu 22.04/24.04, ≥ 4 CPU, ≥ 8 GB RAM, ≥ 100 GB đĩa, IP LAN cố định
- [ ] Một **VM trắng thứ hai** cho buổi diễn tập khôi phục (xoá sau khi xong)
- [ ] NAS có thư mục riêng cho IMS, mount được từ máy chủ (NFS hoặc SMB)
- [ ] Cert wildcard `*.pmh.com.vn`: file chứng chỉ + chuỗi trung gian, và khoá riêng
- [ ] Hộp thư dịch vụ Google Workspace (ví dụ `ims@pmh.com.vn`) + **App Password** SMTP
- [ ] DNS nội bộ trỏ được `ims.pmh.com.vn` về IP máy chủ
- [ ] File Excel thiết bị thật, đã đối chiếu với `docs/mau-du-lieu/mau-thiet-bi.xlsx`
- [ ] 3 phong bì trắng + bút + máy in (không nối mạng nếu có)

---

## A. Dựng máy chủ

### A1. Cài Docker và lấy mã nguồn

```bash
# Docker Engine + compose plugin (theo hướng dẫn chính thức của Docker cho Ubuntu)
sudo apt-get update && sudo apt-get install -y ca-certificates curl git
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"      # đăng xuất / đăng nhập lại để nhận nhóm

sudo mkdir -p /opt/ims && sudo chown "$USER" /opt/ims
git clone https://github.com/youtranken/PMH_IMS.git /opt/ims
cd /opt/ims && git checkout <tag-phát-hành>   # ví dụ v1.0.0 — KHÔNG chạy prod từ nhánh đang làm
```

- [ ] `docker compose version` chạy được không cần sudo

### A2. Tạo `.env`

```bash
$ cp .env.example .env
$ nano .env
```

| Biến | Giá trị prod |
| --- | --- |
| `NODE_ENV` | `production` |
| `POSTGRES_PASSWORD`, `MIGRATION_DB_PASSWORD`, `APP_DB_PASSWORD`, `REDIS_PASSWORD` | bốn mật khẩu **khác nhau**, sinh bằng `openssl rand -hex 24` (chỉ chữ + số, không `@` `:`) |
| `APP_BASE_URL` | `https://ims.pmh.com.vn` |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` | `smtp.gmail.com` / `587` / `ims@pmh.com.vn` |
| `TLS_CERT_DIR` | `./ops/certs` |
| `WEB_HTTP_PORT`, `WEB_HTTPS_PORT` | để trống (mặc định 80/443) |

```bash
$ chmod 600 .env
```

- [ ] Không còn chuỗi `doi-mat-khau-nay` nào: `grep -c doi-mat-khau-nay .env` ra `0`

### A3. Tạo bí mật (`secrets/`)

Sinh **trên chính máy chủ prod**. Không bao giờ đi qua chat, email hay git.

```bash
$ umask 077
$ echo "1=$(openssl rand -hex 32)" > secrets/master_key
$ openssl rand -hex 32 > secrets/password_pepper
$ printf '%s' '<App Password của hộp thư SMTP>' > secrets/smtp_password
$ chmod 600 secrets/master_key secrets/password_pepper secrets/smtp_password
$ sudo chown 1000:1000 secrets/*        # container api/worker chạy uid 1000
```

- [ ] Ba file tồn tại, quyền `-rw-------`, chủ `1000`

### A4. Chứng chỉ TLS

nginx đọc **đúng hai tên** `fullchain.pem` và `privkey.pem` (`web/nginx.conf`).

```bash
$ cat <chứng-chỉ>.crt <chuỗi-trung-gian>.crt > ops/certs/fullchain.pem
$ cp <khoá-riêng>.key ops/certs/privkey.pem
$ chmod 600 ops/certs/privkey.pem
$ openssl x509 -in ops/certs/fullchain.pem -noout -subject -enddate   # đúng *.pmh.com.vn, còn hạn
```

- [ ] Ghi ngày hết hạn cert vào lịch nhắc (trước 30 ngày)

---

## B. Deploy lần đầu

```bash
$ docker compose up -d --build        # KHÔNG có --profile dev: prod không chạy mailpit
$ docker compose ps                   # postgres, redis, api, worker, web đều Up / healthy
$ docker compose logs migrate | grep -E "Migration applied|Đã áp|mới nhất"   # service migrate chạy một lần rồi thoát (Exited 0)
```

Không dùng `docker-compose.override.e2e.yml` hay `docker-compose.override.drill.yml` ở máy prod.

Ba role Postgres, mỗi role một việc (DB-03, D-01):

| Role | Là gì | Ai dùng |
| --- | --- | --- |
| `POSTGRES_USER` (`ims`) | superuser của cụm | chỉ dựng `ims_owner` (lúc initdb, hoặc `ops/db-owner-bootstrap.sh`) và các script sao lưu/giám sát |
| `ims_owner` | chủ database và mọi bảng, **không** superuser, có `CREATEROLE` | chỉ service `migrate` |
| `ims_app` | role hẹp, không sở hữu gì | `api`, `worker` |

Cụm mới: postgres tự tạo `ims_owner` lúc khởi tạo thư mục dữ liệu (`ops/db/initdb-owner.sh`).
Kiểm (phải ra `ims_owner|f`):

```bash
$ docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "SELECT rolname, rolsuper FROM pg_roles WHERE rolname = '"'"'ims_owner'"'"'"'
```

### B1. Tạo SA đầu tiên

```bash
$ docker compose exec api node dist/ops/seed-sa.main.js
```

Script tạo `sa@pmh.com.vn` và `caothuan@pmh.com.vn`, in **mật khẩu tạm ngẫu nhiên một lần duy
nhất**. Chép ra giấy, trao tận tay, không gửi qua chat/email. Script từ chối chạy nếu đã có SA.

- [ ] `sa@pmh.com.vn` đăng nhập, cài TOTP, đổi mật khẩu
- [ ] `caothuan@pmh.com.vn` đăng nhập, cài TOTP, đổi mật khẩu
- [ ] Các tài khoản admin/member tạo qua màn **Tài khoản**

### B2. Kiểm từ máy người dùng

- [ ] Mở `https://ims.pmh.com.vn` từ máy IT ở **mỗi site**: không cảnh báo cert, đăng nhập được
- [ ] Trên điện thoại (390px): mở một thiết bị, đọc được hồ sơ
- [ ] Màn Tài khoản → gửi thử một mail (vd. đặt lại mật khẩu cho một tài khoản test) → **mail tới
      hộp thư thật**
- [ ] `docker compose logs worker --since 10m` không có lỗi SMTP

---

## C. Chìa, pepper và `.env` — ba phong bì

Mất **master key** = mất toàn bộ két và mọi TOTP. Mất **pepper** = mọi mật khẩu đăng nhập vô dụng,
kể cả SA. Mất **`.env`** = không nối lại được DB đã khôi phục. Cả ba **không** nằm trong bản sao lưu.

```bash
$ cat secrets/master_key secrets/password_pepper   # in ra giấy, KHÔNG lưu thêm file nào
$ cat .env                                          # in ra giấy (bản thứ ba)
```

- In **2 bản** chìa + pepper. Mỗi bản ghi thêm ngày in và câu
  *"Chìa giải mã IMS — không sao chép, không chụp ảnh"*. Bỏ vào phong bì, dán, **ký đè lên mép
  dán**. Hai người khác nhau giữ, ở hai chỗ khác nhau.
- `.env` in **1 bản**, phong bì thứ ba, cất cùng chỗ với một trong hai phong bì chìa.

> Hai bản chứ không phải một: một bản mất là hết. Không phải năm: mỗi bản thêm là một chỗ nữa
> có thể lộ.

- [ ] 2 phong bì chìa + pepper đã niêm phong, 2 người giữ
- [ ] Phong bì `.env` đã niêm phong

---

## D. Sao lưu hằng đêm sang NAS

### D1. Mount NAS cố định

```bash
sudo mkdir -p /mnt/nas/ims-backup
# NFS:  echo "nas.pmh.local:/volume1/ims /mnt/nas/ims-backup nfs defaults,_netdev 0 0" | sudo tee -a /etc/fstab
sudo mount -a && mountpoint /mnt/nas/ims-backup     # phải in "is a mountpoint"
```

### D2. Chạy tay một lần, rồi đặt cron

```bash
$ bash ops/backup-nightly.sh /mnt/nas/ims-backup
$ crontab -e
30 1 * * * cd /opt/ims && bash ops/backup-nightly.sh /mnt/nas/ims-backup >> /var/log/ims-backup.log 2>&1 || echo "IMS backup HỎNG $(date)" | mail -s "IMS backup HONG" it@pmh.com.vn
$ sudo touch /var/log/ims-backup.log && sudo chown "$USER" /var/log/ims-backup.log
```

Mỗi lượt tạo `ims-<ngày>.sql.gz` (database, **giữ quyền của `ims_app`**) và `files-<ngày>.tgz`
(file đính kèm). Script **dừng** khi: NAS chưa mount, thấy master key/pepper trong thư mục đích,
dump quá nhỏ, hoặc dump thiếu GRANT. Bản cũ hơn 30 ngày tự xoá (`IMS_BACKUP_KEEP_DAYS`).

- [ ] Chạy tay in `✓ Xong`, trên NAS có cả `.sql.gz` và `.tgz`
- [ ] Cron đã đặt; sáng hôm sau `/var/log/ims-backup.log` có dòng `✓ Xong`
- [ ] `ls /mnt/nas/ims-backup` **không** có `master_key*` hay `password_pepper*`

---

### D3. Giám sát — có người được báo khi hệ thống hỏng

`ops/healthcheck.sh` kiểm 5 phút một lần: container đang chạy/healthy, `/health` trả 200, đĩa
dưới 85%, không có thư kẹt quá 30 phút hay thư lỗi trong 24 giờ, cert còn hạn trên 30 ngày.
Có vấn đề thì báo qua webhook (Google Chat/Teams/Slack/Telegram nhận JSON `{"text": ...}`) hoặc
lệnh `mail`; cùng một vấn đề chỉ báo lại sau 60 phút, và báo "Đã ổn trở lại" khi hết.

```bash
$ IMS_ALERT_WEBHOOK='<url webhook>' bash ops/healthcheck.sh     # chạy tay: phải in OK
$ crontab -e
IMS_ALERT_WEBHOOK=<url webhook>
IMS_DISK_PATHS="/ /var/lib/docker /mnt/nas/ims-backup"
*/5 * * * * cd /opt/ims && bash ops/healthcheck.sh >> /var/log/ims-health.log 2>&1
```

- [ ] Chạy tay in `OK`
- [ ] Thử hỏng: `docker compose stop worker`, chờ tối đa 5 phút → nhận được tin báo; `docker compose start worker` → nhận "Đã ổn trở lại"

---

## E. Diễn tập khôi phục (trước khi nhập dữ liệu thật, và mỗi quý)

Mục đích: **chứng minh chìa trên giấy mở được dữ liệu trong bản sao lưu**.

### E1. Cất một secret THỬ trên prod

IMS → một thiết bị bất kỳ → tab **Két sắt** → **Cất secret**: tên gọi chứa chữ **drill**
(vd. `drill 2026-10`), loại Khác, giá trị tự nghĩ (vd. `DrillOK#2026-10`). Ghi chuỗi đó vào biên
bản. Rồi chạy `bash ops/backup-nightly.sh /mnt/nas/ims-backup`.

> Script diễn tập **chỉ** mở được secret có nhãn chứa "drill" — két thật không mở được bằng
> đường đó (FR-026).

### E2. Khôi phục trên VM trắng

Trên VM: cài Docker + clone repo như A1. Tạo `.env` **với mật khẩu riêng của VM** (không dùng
mật khẩu prod). Tạo `secrets/password_pepper` bằng `openssl rand -hex 32` (pepper giả là đủ — diễn
tập chỉ mở két) và `secrets/smtp_password` rỗng. Chép hai file sao lưu từ NAS sang.

```bash
bash ops/restore-drill.sh ims-<ngày>.sql.gz files-<ngày>.tgz
```

Script hỏi `MAY SACH` (nó xoá mọi volume của máy này), tự **từ chối** nếu thấy đang đứng trên máy
có dữ liệu IMS, rồi dừng chờ **người giữ phong bì gõ chìa từ bản giấy**. Gõ tay, không
copy-paste, không cắm USB.

### E3. Điều kiện ĐỖ

Bước cuối in ra chuỗi. **Khớp với chuỗi ở E1 → ĐỖ.**

| Triệu chứng | Nguyên nhân hay gặp |
| --- | --- |
| `ims_app KHÔNG có quyền đọc bảng secret` | Dump tạo bằng bản `backup-nightly.sh` cũ (có `--no-privileges`) |
| `Không có chìa version N` | Bản sao lưu cũ hơn lần xoay chìa — phong bì thiếu dòng cũ |
| `Giải mã KHÔNG thành công` | Gõ nhầm một ký tự hex; gõ lại chậm, đọc từng cặp |
| `không có secret nào để giải` | Backup chạy TRƯỚC khi cất secret thử |
| api không lên, log báo không đọc được `master_key` | `sudo chown 1000:1000 secrets/master_key` |

- [ ] Diễn tập ĐỖ, chuỗi khớp
- [ ] Phong bì niêm phong lại, ký đè mép dán
- [ ] **Xoá hẳn VM diễn tập** (`shred` không đáng tin trên SSD/VM)
- [ ] Hẹn lần diễn tập kế tiếp (mỗi quý)

---

## F. Nhập dữ liệu thật

Chỉ làm **sau khi E đỗ**. Dùng đúng luồng nhập Excel — không có đường nhập thẳng vào DB.

1. **Khai dải IP trước**: mỗi dải một lần. Hệ thống từ chối dải chồng lên dải đã có.
2. IMS → **Thiết bị** → **Nhập Excel** → chọn file → xem bảng đối chiếu → **Xác nhận ghi**.
   Đọc kỹ phần **lỗi** trước khi xác nhận; sửa trong Excel rồi nhập lại.
3. **Phần mềm / license (Q-13):** hồ sơ có ngày hết hạn quá 30 ngày sẽ bị **tự Thanh lý và gỡ
   ghế** ở lượt quét đầu tiên, vài phút sau khi nhập. Trước khi nhập: cập nhật ngày hết hạn
   thật trong file, hoặc tạm tắt tự thanh lý rồi bật lại khi đã rà xong: đăng nhập bằng tài
   khoản SA → **Hệ thống → Tham số hệ thống** → nhóm **Phần mềm** → "Ân hạn trước khi tự Thanh lý
   phần mềm hết hạn" = `0` → **Lưu nhóm này** (hộp "Trước → Sau" + gõ mã 6 số). Rà xong thì bấm
   **Về mặc định** (30) rồi lưu lại. Mỗi lần đổi ghi một dòng nhật ký (`system_config.updated`),
   có hiệu lực trong vòng 30 giây.

   Mọi ngưỡng vận hành khác (khoá đăng nhập, rate limit, thời gian hiện mật khẩu, nhắc duyệt,
   ngưỡng dashboard, câu liên hệ hỗ trợ) cũng sửa ở màn này — **không** `UPDATE system_config`
   bằng psql trên prod: psql bỏ qua kiểm khoảng hợp lệ và không để lại nhật ký. Khoá không có
   trên màn (`app.timezone`, `mail.from_address`…) là khoá kỹ thuật, cố ý không mở.

| Kiểm | Cách |
| --- | --- |
| Tổng số thiết bị | Đếm dòng file Excel = số ở màn Thiết bị |
| Theo site / theo loại | Lọc từng site, từng loại, so với subtotal trong Excel |
| Serial trùng | Màn nhập báo ở cột lỗi — phải bằng 0 |

- [ ] Import xong, 0 dòng lỗi, bốn phép đối chiếu khớp
- [ ] Chạy tay `bash ops/backup-nightly.sh /mnt/nas/ims-backup` ngay sau khi nhập xong

---

## G. Khôi phục production thật (khi máy chủ hỏng)

1. Dựng máy mới theo **A1**. Lấy `.env` từ phong bì thứ ba (`.env` in trước DB-03 chưa có
   `MIGRATION_DB_PASSWORD`: thêm `echo "MIGRATION_DB_PASSWORD=$(openssl rand -hex 24)" >> .env`); `master_key` và `password_pepper`
   gõ lại từ phong bì chìa (`chown 1000:1000`, `chmod 600`). Cert theo **A4**.
2. Chép bản sao lưu mới nhất (`ims-*.sql.gz` + `files-*.tgz`) từ NAS sang.
3. Nạp database và file, **trước** khi bật api:

   ```bash
   $ docker compose up -d postgres
   $ docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "CREATE ROLE ims_app NOLOGIN"'
   $ gzip -dc ims-<ngày>.sql.gz | docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -q'
   $ bash ops/db-owner-bootstrap.sh     # dump nạp bằng superuser: giao lại mọi bảng cho ims_owner
   $ docker compose run --rm --no-deps -T --entrypoint sh api -c 'tar xzf - -C /data/files' < files-<ngày>.tgz
   $ docker compose up -d
   ```

   Service `migrate` (chạy một lần trước `api`) đặt mật khẩu cho `ims_app` theo `APP_DB_PASSWORD`.
4. Kiểm như **B2**, rồi trỏ DNS sang máy mới. Chạy lại **D** trên máy mới.

---

## H. Vận hành về sau

| Việc | Lệnh |
| --- | --- |
| Xem log | `docker compose logs -f --tail 200 api worker` |
| Khởi động lại một service | `docker compose restart api` |
| Nâng cấp lên bản mới | `git fetch --tags && git checkout <tag-mới> && docker compose up -d --build` (backup tay trước) |
| Quay lại bản trước | `git checkout <tag-cũ> && docker compose up -d --build`. Migration chỉ tiến: nếu bản mới đã thêm migration thì bản cũ vẫn chạy trên schema mới — kiểm log api; hỏng thì khôi phục theo **G** từ bản sao lưu trước nâng cấp |
| Nâng cấp từ bản **trước DB-03** (migrate còn chạy bằng superuser) | Làm **một lần**, xem mục **H1** bên dưới |
| DB dựng **trước lượt gộp migration** (Q-17) | Chỉ có ở máy dev/thử nghiệm: không nâng cấp được, phải dựng lại DB trắng (xem **H2**). Cài mới theo **B** không bị ảnh hưởng. Cũng vì thế, không quay về một tag trước lượt gộp trên DB đã dựng từ bộ gộp |
| Thay cert | Chép đè hai file ở **A4** rồi `docker compose restart web` |
| Xoay master key khi nghi lộ | Xem `secrets/README.md` mục "Xoay chìa". **Không xoá dòng chìa cũ** khi lệnh kiểm chưa báo 0 bản ghi |
| Đổi trần giấy tờ đính kèm | Màn **Tham số hệ thống → Giấy tờ đính kèm**: `file.max_size_mb` (1–25), `file.max_files_per_batch`, `file.purge_after_days`. Trần cứng 25 MB nằm ở `FILE_HARD_CAP_MB` (API) và `client_max_body_size 26m` (`web/nginx.conf`); muốn quá 25 MB phải sửa code và dựng lại `api` + `web`, không chỉnh được bằng tham số |
| Dọn nội dung file đã xoá | Worker tự chạy mỗi phút: file xoá mềm quá `file.purge_after_days` ngày (mặc định 30) bị gỡ khỏi volume `filesdata`, hàng DB giữ lại với `purged_at`, nhật ký ghi `file.purged`. Cần lấy lại một file đã xoá thì phải làm **trước** mốc đó (từ volume), hoặc lấy từ bản `files-<ngày>.tgz` trên NAS |

### H1. Nâng cấp một lần: migration chuyển sang role chủ sở hữu `ims_owner` (DB-03)

Bản cài trước DB-03 có mọi bảng thuộc superuser `ims`, và `migrate` đăng nhập bằng superuser. Từ
bản này `migrate` đăng nhập bằng `ims_owner`, nên phải tạo role đó và giao database cho nó
**trước** khi `up` bản mới. Thứ tự:

```bash
$ bash ops/backup-nightly.sh /mnt/nas/ims-backup          # 1. sao lưu tay trước
$ git fetch --tags && git checkout <tag-mới>                # 2. lấy mã có DB-03
$ grep -q '^MIGRATION_DB_PASSWORD=' .env || echo "MIGRATION_DB_PASSWORD=$(openssl rand -hex 24)" >> .env
$ bash ops/db-owner-bootstrap.sh                            # 3. tạo lại container postgres (vài giây) + giao DB cho ims_owner
$ docker compose up -d --build --wait                       # 4. migrate chạy bằng ims_owner
$ docker compose logs migrate | tail -3                     # "Schema đã mới nhất." hoặc "Đã áp N migration."
```

Kiểm `ims_owner` không phải superuser và sở hữu mọi bảng (hai dòng phải ra `ims_owner|f` và `0`):

```bash
$ docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "SELECT rolname, rolsuper FROM pg_roles WHERE rolname = '"'"'ims_owner'"'"'"'
$ docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "SELECT count(*) FROM pg_tables WHERE schemaname = '"'"'public'"'"' AND tableowner <> '"'"'ims_owner'"'"'"'
```

`ops/db-owner-bootstrap.sh` chạy lại được bao nhiêu lần cũng được. Chạy lại nó sau mỗi lần nạp
dump (mục **G**; `ops/restore-drill.sh` tự làm), và sau khi lỡ quay về một bản cũ hơn DB-03 rồi
nâng lên lại: bản cũ migrate bằng superuser nên bảng nó tạo ra sẽ thuộc superuser.

Ghi `MIGRATION_DB_PASSWORD` mới vào bản in `.env` trong phong bì thứ ba (mục **C**).

### H2. DB dựng trước lượt gộp migration (Q-17) — chỉ máy dev

96 file migration cũ đã được gộp thành 34 file theo bảng. DB nào dựng từ bộ cũ có journal
`_migrations` mang tên file không còn tồn tại; service `migrate` dừng ngay với câu "DB này dựng từ
bộ migration trước lượt gộp migration (Q-17)…" và không áp gì. Không có đường nâng cấp: DB đó chỉ
có dữ liệu thử, nên xoá volume postgres rồi dựng lại (`docker compose down` + `docker volume rm
<project>_pgdata`, rồi làm lại mục **B** từ đầu, gồm cả **B1** tạo SA). Máy prod cài sau lượt gộp
không bao giờ gặp mục này.

**Không bao giờ chạy trên máy prod:** `ops/ci-local.sh`, `ops/seed-demo.sql`,
`ops/unseed-demo.sql`, `api/scripts/reset-e2e.mjs`, hay các file `docker-compose.override.*.yml`.

### H2. Lưu trữ nhật ký năm cũ (`audit_log`)

`audit_log` chia ngăn theo năm (`audit_log_2026`, `audit_log_2027`… và `audit_log_default`).
Worker tự tạo ngăn năm nay và năm sau ở mỗi lượt sweep, nên ngăn năm mới luôn có trước giao
thừa; không cần làm gì. Nếu worker tắt qua giao thừa, dòng mới rơi vào `audit_log_default` và
lượt sweep đầu tiên sau đó tự dời chúng sang ngăn đúng năm (log worker có dòng `dời N dòng`).

Lưu trữ thì **không** tự chạy: nhật ký giữ vĩnh viễn (NFR-03), đưa một năm ra khỏi DB là việc
người trực làm có chủ đích. Ngưỡng `audit.archive_after_years` (system_config, mặc định 2): ngăn
nào có mọi dòng cũ hơn ngần ấy năm thì mới được lưu trữ.

```bash
$ bash ops/audit-archive.sh /mnt/nas/ims-backup              # 1. xem ngăn nào sẽ bị tách, bao nhiêu dòng
$ bash ops/backup-nightly.sh /mnt/nas/ims-backup             # 2. sao lưu đầy đủ trước
$ bash ops/audit-archive.sh /mnt/nas/ims-backup --yes        # 3. tách + dump, bảng vẫn ở lại trong DB
# 4. mở thử file dump (pg_restore --list), rồi mới xoá bảng đã tách:
$ docker compose exec postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "DROP TABLE audit_archive_2026;"'
```

Mỗi năm ra một file `audit_log_<năm>-<ngày>.dump` (pg_dump custom). Ngăn đã tách được đổi tên
thành `audit_archive_<năm>`, không còn nằm trong `audit_log` nên màn Nhật ký không thấy nó nữa.
`--yes --drop` làm cả bước 4 trong một lượt, chỉ dùng khi đã quen quy trình.

**Khôi phục một năm** để tra cứu (ví dụ 2026):

```bash
$ docker compose exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner' < audit_log_2026-<ngày>.dump
$ docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1' <<'SQL'
ALTER TABLE audit_archive_2026 RENAME TO audit_log_2026;
ALTER TABLE audit_log ATTACH PARTITION audit_log_2026
  FOR VALUES FROM ('2026-01-01 00:00:00+00') TO ('2027-01-01 00:00:00+00');
SELECT audit_log_seal_partition('audit_log_2026'::regclass);   -- thu quyền ims_app, gắn trigger
SQL
```

- [ ] Bước 1 chỉ liệt kê, không đổi gì
- [ ] Sau bước 3: file `.dump` có trên NAS, `pg_restore --list` thấy `TABLE DATA public audit_archive_<năm>`

---

## Biên bản diễn tập khôi phục

Điền, in, ký, kẹp vào hồ sơ ISO.

```
BIÊN BẢN DIỄN TẬP KHÔI PHỤC HỆ THỐNG IMS

Ngày diễn tập      : ____/____/________        Bắt đầu: ____:____  Kết thúc: ____:____
Người chủ trì (SA) : ______________________________
Người giữ phong bì : ______________________________

Bản sao lưu dùng   : ims-________________.sql.gz  + files-________________.tgz
Máy diễn tập       : ______________________________  (KHÔNG phải máy chạy IMS)

Secret thử         : nhãn ..........................  id ..............................
Chuỗi đã cất       : ______________________________
Chuỗi giải ra được : ______________________________
Chìa dùng (version): ______

KẾT QUẢ:   [ ] ĐỖ — hai chuỗi khớp        [ ] HỎNG — ghi rõ bên dưới

Ghi chú / sự cố gặp phải:
_________________________________________________________________________

Sau diễn tập:
[ ] Phong bì đã niêm phong lại, ký đè mép dán
[ ] VM diễn tập đã xoá hẳn
[ ] Ngày diễn tập kế tiếp: ____/____/________  (mỗi quý)

Chữ ký SA: ______________________   Chữ ký người giữ phong bì: ______________________
```

---

## Sau khi xong A → F lần đầu

1. Đánh dấu story 4.3 và `epic-4: done` trong `_bmad-output/implementation-artifacts/sprint-status.yaml`.
2. Thêm mục **"Epic 4 đã đóng góp gì"** vào `docs/EPIC-MAP.md`.
3. `graphify update . && graphify cluster-only .`
