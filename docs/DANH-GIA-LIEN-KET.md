# Đánh giá liên kết tính năng — trước khi mở phase sau

Ngày soi: 28/08/2026. Nguồn: FK thật trong DB, whitelist trong migration, đăng ký nguồn hạn
trong code, và `graphify god-nodes`. Không phỏng đoán — mỗi kết luận đều tra được lại.

## Ma trận: chủ thể nào nối được với năng lực nào

| Chủ thể | Lịch sử nghiệp vụ | Giấy tờ | Két sắt | Ma trận quyền két | Nguồn hạn | Dashboard |
| --- | --- | --- | --- | --- | --- | --- |
| Thiết bị | ✅ `device_history` | ✅ | ✅ | ✅ site + loại | ✅ bảo hành | ✅ |
| Phần mềm | ✅ `software_history` | ✅ | ✅ | ✅ theo loại | ✅ license · SSL · domain | ✅ |
| Đường truyền ISP | ✅ `isp_line_history` | ✅ | ❌ | ❌ | ✅ hợp đồng | ✅ |
| Tài khoản dịch vụ | ✅ `service_account_history` | ✅ | ✅ | ❌ | ❌ | ❌ |
| Dải mạng (subnet) | ❌ | ❌ | — | — | — | ❌ |
| Hồ sơ IP | ✅ `ip_history` | ❌ | — | — | — | ❌ |
| Rule NAT | ❌ | ❌ | — | — | — | ❌ |

Cột nào cũng có ít nhất một ô đỏ. Bảy phát hiện dưới đây xếp theo mức đáng làm trước.

---

## 1. Két sắt không với tới đường truyền — bất đối xứng vô lý

`secret.owner_type` chỉ nhận `device`, `software`, `service_account`
(migration `0019` + `0033`). Nhưng `file.owner_type` **đã** nhận `isp` từ lâu.

Nghĩa là: hợp đồng PDF của đường truyền đính vào được, còn **mật khẩu PPPoE và tài khoản quản
trị modem nhà mạng thì không có chỗ đứng**. Hai thứ đó luôn đi cùng nhau trong đời thật.

Hiện người dùng chỉ còn hai đường, cả hai đều sai:
- gắn nhờ vào hồ sơ router — rồi sáu tháng sau đổi router là mất dấu;
- ghi vào ô Ghi chú của `isp_line` — chỗ **không mã hóa**, đúng thứ két sắt sinh ra để dọn.

**Việc phải làm:** thêm `isp` vào ba chỗ — `SECRET_OWNER_TYPES`, `SecretOwnerType` ở
`vault-panel.tsx`, và **CHECK constraint trong migration**. Hợp đồng epic sau trong `EPIC-MAP`
đã ghi sẵn cái bẫy "tầng DB là tầng bị quên".

## 2. Ma trận quyền két bỏ sót tài khoản dịch vụ — đây là NỢ, không phải thiết kế

`access_list.scope_type` chỉ có `device_site`, `device_type`, `software_kind`
(migration `0024`).

Tài khoản dịch vụ đã cất được mật khẩu từ `0033`, nhưng **không nhóm đối tượng nào phủ nó**.
Nên tầng quyền của mọi Member với mọi secret của tài khoản dịch vụ vĩnh viễn là CẤM — kể cả
khi SA muốn cấp quyền thì cũng không có ô nào để chọn.

Điểm đáng lo hơn: bài kiểm e2e hiện tại đang **khóa đúng hành vi đó lại như thể nó là đặc tả**
("Member KHÔNG xem được mật khẩu của tài khoản dịch vụ — mặc định CẤM"). Câu chú thích trong
bài nói rõ đây là hệ quả của việc chưa có nhóm đối tượng, nhưng ai đọc lướt sẽ tưởng là chủ ý.

**Việc phải làm:** thêm `service_account_kind` (và `isp_provider` nếu làm mục 1) vào
`scope_type`, rồi sửa bài e2e nói đúng lý do.

## 3. Sổ NAT và Dải mạng không có lịch sử nghiệp vụ

`nat_rule` và `subnet` **không có bảng history**, cũng không có tab Lịch sử. Chỉ có `audit_log`.

Sổ NAT lại chính là thứ auditor hỏi nhiều nhất: *"ai mở port 3389 ra internet, ngày nào, vì
sao, và ai gỡ nó"*. Hiện muốn trả lời phải tra `audit_log` bằng SQL — không có màn nào làm được.

Đối chiếu: `ip_address` **có** `ip_history` và AC 5.2 bắt giữ vĩnh viễn. Nên đây không phải
quyết định kiến trúc, chỉ là chưa làm tới.

## 4. Giấy tờ không với tới IPAM và NAT

`FILE_OWNER_TYPES = ['device', 'isp', 'software', 'service_account']`.

Không đính được: sơ đồ mạng của một dải, biên bản bàn giao dải IP tĩnh từ nhà mạng, ảnh chụp
màn hình cấu hình Draytek kèm rule NAT. Ba thứ này đều là giấy tờ thật, đều đang nằm trong
thư mục chia sẻ của phòng IT.

## 5. Dashboard chỉ biết ba khối

Hiện có: Sắp hết hạn · Sự cố (chưa mở) · Break-glass tuần qua.

Ba câu sếp hay hỏi mà dashboard không trả lời được, dù dữ liệu **đã có sẵn**:
- Két sắt: bao nhiêu mật khẩu quá lâu chưa xoay;
- IPAM: dải nào sắp đầy (`subnetUsage` đã tính sẵn phần trăm);
- Tài khoản dịch vụ: bao nhiêu cái đã vô hiệu mà mật khẩu vẫn nằm trong két.

## 6. Tài khoản dịch vụ không có ngày hết hiệu lực

`service_account` không có cột nào kiểu `end_date`. Nhưng VPN cấp cho nhà thầu, cho kiểm toán
viên, cho nhân sự thời vụ **luôn có ngày hết hạn** — và đó đúng là loại tài khoản dễ bị quên
nhất.

Không có cột đó thì nó không vào được cỗ máy expiry, không vào digest email, không lên
dashboard. Cả một dây chuyền đã dựng sẵn mà chủ thể này không bước vào được.

## 7. Tiền chỉ tồn tại ở đúng một chỗ

Soi toàn bộ schema, cột liên quan tới tiền **chỉ có một**: `license_assignment.cost` (kèm
`license_assignment.contract`) — chi phí của **một ghế gán cho một máy**.

Không có: giá mua thiết bị, số hóa đơn thiết bị, chi phí tổng của một hồ sơ phần mềm, cước
tháng của đường truyền.

Nên câu "IT tiêu bao nhiêu một năm" hiện chỉ cộng được phần license theo ghế, và đó là phần
nhỏ nhất trong ba phần.

---

## Sức khỏe kiến trúc — phần này ĐẠT

`graphify god-nodes` sau lượt cập nhật mới nhất (3200 node, 7514 cạnh, 241 community):

```
1. Roles()              145   2. AuthedRequest       100   3. Audited()            86
4. Database              60   5. Tx                   53   6. firstLogin()         47
7. resetUsers()          47   8. AuditWriterService   45   9. E2E_SA               42
10. SystemConfigService  37  11. DevicesService       30  12. SoftwareService      30
```

Mười hub đầu **đều là hạ tầng xuyên suốt** (quyền, audit, transaction, config) và helper e2e —
đúng thứ được phép làm hub. Không có file nghiệp vụ nội bộ nào trèo lên, tức là **AD-2 vẫn
đang được giữ**: module khác đọc nhau qua `*.api.ts`, không import chéo vào ruột.

`dependency-cruiser` cũng sạch: 191 module, 850 phụ thuộc, 0 vi phạm.

Một quan sát nhỏ đáng ghi: **module `isp` không tồn tại** — đường truyền sống trong module
`software` (`software-expiry-sources.ts` đăng ký luôn `ispSource()`). Đúng theo AD-3 thì đây
là một chủ thể có bảng riêng (`isp_line`, `isp_line_history`) nhưng không có module chủ. Chưa
gây hỏng gì, nhưng nếu phase sau đụng nhiều vào ISP thì nên tách ra trước khi nó dính thêm.

---

## Đề xuất thứ tự cho phase sau

Chia làm ba nhóm theo mức "đóng lỗ hổng" so với "thêm tính năng".

**Nhóm A — đóng lỗ hổng của thứ đã có (rẻ, nên làm trước)**

1. `isp` vào két sắt (mục 1) — ba chỗ + một migration.
2. `service_account_kind` vào ma trận quyền (mục 2) — mở khóa một tính năng đang chết.
3. `nat_rule_history` + tab Lịch sử cho sổ NAT (mục 3) — thứ auditor hỏi.
4. `subnet` và `nat` vào `FILE_OWNER_TYPES` (mục 4).

**Nhóm B — nối chủ thể vào dây chuyền đã dựng sẵn**

5. `service_account.end_date` → tự động vào expiry + digest + dashboard (mục 6).
6. Ba khối mới cho dashboard từ dữ liệu đã có (mục 5).

**Nhóm C — thêm chiều dữ liệu mới (cần bàn trước, đụng nhiều màn)**

7. Tiền: `device.purchase_price` + `device.invoice_no`, `software.annual_cost`,
   `isp_line.monthly_fee` (mục 7). Đây là nhóm duy nhất mở ra một câu hỏi mới cho hệ thống —
   "chi phí" — nên nó xứng đáng một buổi bàn riêng chứ không phải một migration lẻ.

Epic 8 (phiếu ISO) và Epic 9 (sự cố) đang `backlog`. Cả hai sẽ cần đính giấy tờ, cần lịch sử,
cần audit — tức là chúng sẽ **đi qua đúng những đường đang thiếu ở nhóm A**. Làm nhóm A trước
thì hai epic đó không phải tự dựng đường riêng.
