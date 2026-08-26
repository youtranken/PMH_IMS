import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { apiFetch } from "@/lib/api-client";
import { errorMessage, useApiMutation } from "@/lib/api";
import { formatDate, orDash } from "@/lib/format";
import type { Me } from "@/lib/me";
import { Combobox } from "@/ui/combobox";
import { Dialog } from "@/ui/dialog";
import { DatePicker } from "@/ui/date-picker";
import { LoadError, Loading } from "@/ui/load-state";
import { Field } from "@/ui/page-header";
import { Pagination } from "@/ui/pagination";
import { SuggestInput } from "@/ui/suggest-input";
import { useDepartments } from "./use-departments";
import { useToast } from "@/ui/toast";
import { HistoryPanel } from "@/ui/history-panel";
import {
  NEXT_STATUSES,
  STATUS_KEY,
  STATUS_TONE,
  TRANSITION_LABEL,
  type IpRow,
  type IpStatus,
  type SubnetRow,
  type SubnetSlot,
} from "./ipam-types";
import {
  clampPage,
  countSlots,
  filterSlots,
  pageSlots,
  SLOT_FILTERS,
  SLOT_PAGE_SIZE,
  type SlotFilter,
} from "./slot-paging";
import { toIpHistoryEntries, type IpHistoryRow } from "./ip-history-entries";
import { PATHS } from "@/lib/routes";

interface DeviceOption {
  id: string;
  code: string;
  name: string;
}

/**
 * Cột PHẢI của màn Địa chỉ IP: toàn bộ một dải — IP đã có hồ sơ và ô còn trống, xếp theo thứ
 * tự địa chỉ (story 5.1).
 *
 * Ô trống hiện luôn trong bảng chứ không giấu sau một nút "thêm IP": câu hỏi thật khi cắm máy
 * là "còn chỗ nào trống", và nhìn thấy chỗ trống rồi bấm vào đó là đường ngắn nhất.
 *
 * Nhận cả bản ghi dải qua props (cột trái đã tải danh sách rồi) — không hỏi lại API cho một
 * thứ đang nằm sẵn trong tay.
 */
export function SubnetPane({
  subnet: item,
  me,
}: {
  subnet: SubnetRow;
  me: Me;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const id = item.id;
  const [status, setStatus] = useState<SlotFilter>("all");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<{
    record: IpRow | null;
    address: string;
  } | null>(null);
  const [moving, setMoving] = useState<{ record: IpRow; to: IpStatus } | null>(
    null,
  );
  const [historyOf, setHistoryOf] = useState<IpRow | null>(null);

  const slots = useQuery({
    queryKey: ["ipam", "subnets", id, "addresses"],
    queryFn: () =>
      apiFetch<SubnetSlot[]>(`/api/v1/ipam/subnets/${id}/addresses`),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["ipam"] });

  /**
   * Lọc theo trạng thái, gồm cả "Trống" — đúng bộ lọc của mockup.
   *
   * Thay ô tick "chỉ hiện IP đã cấp" cũ: ô tick chỉ mở/đóng được MỘT trạng thái, nên câu hỏi
   * hay gặp thứ hai — "còn chỗ nào trống" — vẫn phải tự dò bằng mắt giữa 254 dòng.
   */
  const all = slots.data ?? [];
  const counts = useMemo(() => countSlots(all), [all]);
  const filtered = useMemo(() => filterSlots(all, status), [all, status]);

  /**
   * Phân trang Ở CLIENT, cố ý.
   *
   * `MIN_PREFIX = 24` phía API chặn dải rộng nhất ở /24 = 254 host, nên cả dải về trong MỘT
   * lượt gọi và nằm gọn trong bộ nhớ. Cắt trang ở đây thì đổi trang là tức thì, còn bộ lọc
   * và con số đếm trên từng nút vẫn tính trên TOÀN dải chứ không phải trên 50 dòng đang xem —
   * đó mới là câu trả lời đúng cho "còn mấy chỗ trống". Đẩy phân trang xuống server sẽ đổi
   * một lượt gọi thành sáu, mà chẳng bớt được byte nào đáng kể.
   */
  const rows = pageSlots(filtered, page);

  // Đổi dải hoặc đổi bộ lọc thì số dòng đổi theo; giữ nguyên trang 5 của tập cũ là nhìn vào
  // một bảng rỗng và tưởng không có gì.
  useEffect(() => {
    setPage((current) => clampPage(current, filtered.length));
  }, [filtered.length, id]);

  return (
    <>
      {/*
        CHỈ tiêu đề, KHÔNG lặp lại thanh mức sử dụng.
        Thẻ dải đang chọn nằm ngay bên trái và đã hiện đúng con số đó rồi; vẽ lại lần hai
        cách nhau 300px không thêm thông tin nào, chỉ làm người đọc phải đối chiếu xem hai
        chỗ có khớp nhau không.
      */}
      <div className="pane-head">
        <h2 className="pane-title">
          <span className="mono">{item.cidr}</span> — {item.name}
        </h2>
      </div>

      {/* Bộ lọc trạng thái — "Trống" là một lựa chọn ngang hàng, không phải một ô tick phụ.
          Con số đi kèm ngay trên nút: "còn mấy chỗ trống" là câu hỏi màn này sinh ra để trả
          lời, bắt bấm vào rồi mới đếm là bắt làm hai lần một việc. */}
      <div className="segmented" role="group" aria-label={t("ipam.status")}>
        {SLOT_FILTERS.map((key) => (
          <button
            key={key}
            type="button"
            className={status === key ? "on" : undefined}
            aria-pressed={status === key}
            onClick={() => {
              setStatus(key);
              setPage(1);
            }}
          >
            {t(key === "all" ? "ipam.filterAll" : STATUS_KEY[key])}{" "}
            <span className="seg-count">{counts[key]}</span>
          </button>
        ))}
      </div>

      {slots.isLoading ? (
        <Loading />
      ) : slots.isError ? (
        <LoadError onRetry={() => void slots.refetch()} />
      ) : (
        <>
          <div className="table-wrap">
            <table className="table table-stack">
              <thead>
                <tr>
                  <th>{t("ipam.address")}</th>
                  <th>{t("ipam.status")}</th>
                  <th>{t("ipam.device")}</th>
                  <th>{t("ipam.usedBy")}</th>
                  <th>{t("ipam.assignedAt")}</th>
                  <th className="col-center">{t("common.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((slot) =>
                  slot.kind === "free" ? (
                    <tr key={slot.address} className="row-muted">
                      <td data-label={t("ipam.address")}>
                        <span className="mono">{slot.address}</span>
                      </td>
                      <td data-label={t("ipam.status")}>
                        <span className="badge muted">
                          {t("ipam.statusFree")}
                        </span>
                      </td>
                      <td data-label={t("ipam.device")}>—</td>
                      <td data-label={t("ipam.usedBy")}>—</td>
                      <td data-label={t("ipam.assignedAt")}>—</td>
                      <td>
                        <button
                          type="button"
                          className="btn sm"
                          onClick={() =>
                            setEditing({ record: null, address: slot.address })
                          }
                        >
                          {t("ipam.assign")}
                        </button>
                      </td>
                    </tr>
                  ) : (
                    <tr key={slot.id}>
                      <td data-label={t("ipam.address")}>
                        <span className="mono">{slot.address}</span>
                      </td>
                      <td data-label={t("ipam.status")}>
                        <span className={`badge ${STATUS_TONE[slot.status]}`}>
                          {t(STATUS_KEY[slot.status])}
                        </span>
                      </td>
                      <td data-label={t("ipam.device")}>
                        {slot.deviceId ? (
                          <Link to={PATHS.device(slot.deviceId)}>
                            {slot.deviceCode}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td data-label={t("ipam.usedBy")}>
                        {orDash(slot.usedBy)}
                      </td>
                      <td data-label={t("ipam.assignedAt")}>
                        {orDash(formatDate(slot.assignedAt))}
                      </td>
                      <td>
                        <div className="action-cell">
                          {/* Chỉ hiện những bước chuyển ĐI ĐƯỢC từ trạng thái hiện tại — một
                            cái nút bấm vào rồi bị từ chối là cái nút không nên có. */}
                          {NEXT_STATUSES[slot.status].map((to) => (
                            <button
                              key={to}
                              type="button"
                              className={`btn sm${to === "reclaimed" ? " danger" : ""}`}
                              onClick={() => setMoving({ record: slot, to })}
                            >
                              {t(TRANSITION_LABEL[`${slot.status}->${to}`])}
                            </button>
                          ))}
                          <button
                            type="button"
                            className="btn sm"
                            onClick={() => setHistoryOf(slot)}
                          >
                            {t("ipam.history")}
                          </button>
                          <button
                            type="button"
                            className="btn sm"
                            onClick={() =>
                              setEditing({
                                record: slot,
                                address: slot.address,
                              })
                            }
                          >
                            {t("common.edit")}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>

          <Pagination
            page={clampPage(page, filtered.length)}
            limit={SLOT_PAGE_SIZE}
            total={filtered.length}
            onPageChange={setPage}
          />
        </>
      )}

      {moving ? (
        <TransitionDialog
          record={moving.record}
          to={moving.to}
          csrfToken={me.csrfToken}
          onClose={() => setMoving(null)}
          onDone={() => {
            setMoving(null);
            toast({ message: t("ipam.transitioned") });
            void refresh();
          }}
        />
      ) : null}

      {historyOf ? (
        <IpHistoryDialog
          record={historyOf}
          onClose={() => setHistoryOf(null)}
        />
      ) : null}

      {editing ? (
        <IpForm
          subnetId={id}
          record={editing.record}
          address={editing.address}
          csrfToken={me.csrfToken}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            toast({ message: t("ipam.ipSaved") });
            void refresh();
          }}
        />
      ) : null}
    </>
  );
}

function IpForm({
  subnetId,
  record,
  address,
  csrfToken,
  onClose,
  onSaved,
}: {
  subnetId: string;
  record: IpRow | null;
  address: string;
  csrfToken: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [deviceId, setDeviceId] = useState(record?.deviceId ?? "");
  const [deviceTerm, setDeviceTerm] = useState(record?.deviceCode ?? "");
  const [usedBy, setUsedBy] = useState(record?.usedBy ?? "");
  const departments = useDepartments();
  const [assignedAt, setAssignedAt] = useState(record?.assignedAt ?? "");
  const [note, setNote] = useState(record?.note ?? "");
  const [error, setError] = useState<string | null>(null);

  const devices = useQuery({
    queryKey: ["devices", "search", deviceTerm],
    queryFn: () =>
      apiFetch<{ items: DeviceOption[] }>(
        `/api/v1/devices?limit=20&search=${encodeURIComponent(deviceTerm)}`,
      ),
    enabled: deviceTerm.length > 0,
  });

  const save = useApiMutation<Record<string, unknown>, unknown>(
    record ? `/api/v1/ipam/addresses/${record.id}` : "/api/v1/ipam/addresses",
    { method: record ? "PATCH" : "POST", csrfToken, refreshMe: false },
  );

  return (
    <Dialog
      open
      onOpenChange={onClose}
      maxWidth={560}
      title={
        record ? t("ipam.editIp", { address }) : t("ipam.assignIp", { address })
      }
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button
            type="submit"
            form="ip-form"
            className="btn primary"
            disabled={save.isPending}
          >
            {save.isPending ? t("common.loading") : t("common.save")}
          </button>
        </>
      }
    >
      <form
        id="ip-form"
        className="form-grid"
        /* Hai cột: năm ô ngắn (địa chỉ · máy · người dùng · ngày cấp) xếp một cột dọc làm
           hộp cao gấp đôi cần thiết, phải cuộn mới thấy nút Lưu. Ghi chú `span={2}`. */
        data-columns={2}
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          save.mutate(
            record
              ? {
                  deviceId,
                  usedBy: usedBy.trim(),
                  assignedAt,
                  note: note.trim(),
                }
              : {
                  subnetId,
                  address,
                  deviceId,
                  usedBy: usedBy.trim(),
                  assignedAt,
                  note: note.trim(),
                },
            {
              onSuccess: onSaved,
              onError: (err) => setError(errorMessage(err)),
            },
          );
        }}
      >
        {/* Địa chỉ CỐ ĐỊNH ở hộp này — `.static-value` là lớp dành riêng cho "giá trị không
            sửa được trong form"; để `<p class="mono">` trần thì nó cao khác mọi ô còn lại và
            hàng đầu tiên trông lệch. */}
        <Field label={t("ipam.address")}>
          <p className="static-value mono">{address}</p>
        </Field>

        <Field label={t("ipam.device")} hint={t("ipam.deviceHint")}>
          <Combobox
            placeholder={t("ipam.deviceSearch")}
            query={deviceTerm}
            onQuery={(value) => {
              setDeviceTerm(value);
              // Gõ lại là bỏ lựa chọn cũ — nếu không, ô hiện mã A mà id gửi đi là B.
              setDeviceId("");
            }}
            options={devices.data?.items ?? []}
            getKey={(item) => item.id}
            renderOption={(item) => (
              <>
                <span className="mono">{item.code}</span>{" "}
                <small>{item.name}</small>
              </>
            )}
            onSelect={(item) => {
              setDeviceId(item.id);
              setDeviceTerm(item.code);
            }}
          />
        </Field>

        <Field label={t("ipam.usedBy")} hint={t("ipam.usedByHint")}>
          {/* Gợi ý từ danh mục Bộ phận, VẪN gõ tự do được: ô này đôi khi là một phòng, đôi
              khi là "Chị Lan — Kế toán", đôi khi là hai phòng dùng chung một máy in. Ép thành
              khóa ngoại là ép người dùng khai sai cho vừa cái ô. */}
          <SuggestInput
            value={usedBy}
            onChange={setUsedBy}
            options={departments}
            placeholder={t("ipam.usedByPlaceholder")}
            ariaLabel={t("ipam.usedBy")}
          />
        </Field>

        <Field label={t("ipam.assignedAt")}>
          <DatePicker
            value={assignedAt}
            onChange={setAssignedAt}
            ariaLabel={t("ipam.assignedAt")}
          />
        </Field>

        <Field label={t("ipam.note")} htmlFor="ip-note" span={2}>
          <textarea
            id="ip-note"
            className="inp"
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>

        {error ? (
          <p className="alert error span-2" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}

/**
 * Xác nhận một bước chuyển vòng đời.
 *
 * Thu hồi hỏi LÝ DO: sáu tháng sau, câu "vì sao IP này bị thu hồi" chỉ còn dòng lịch sử trả
 * lời được. Cấp / cấp lại thì hỏi CHỦ MỚI ngay tại đây để cả việc đi thành MỘT dòng lịch sử,
 * đúng như việc thật, thay vì hai dòng rời "đổi trạng thái" rồi "sửa hồ sơ".
 */
function TransitionDialog({
  record,
  to,
  csrfToken,
  onClose,
  onDone,
}: {
  record: IpRow;
  to: IpStatus;
  csrfToken: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState("");
  const [usedBy, setUsedBy] = useState("");
  const departments = useDepartments();
  const [error, setError] = useState<string | null>(null);
  const asksOwner = to === "assigned";

  const move = useApiMutation<Record<string, unknown>, unknown>(
    `/api/v1/ipam/addresses/${record.id}/transition`,
    { csrfToken, refreshMe: false },
  );

  return (
    <Dialog
      open
      onOpenChange={onClose}
      maxWidth={480}
      title={
        <>
          {t(TRANSITION_LABEL[`${record.status}->${to}`])} — {record.address}
        </>
      }
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button
            type="submit"
            form="transition-form"
            className={to === "reclaimed" ? "btn danger" : "btn primary"}
            disabled={move.isPending}
          >
            {move.isPending ? t("common.loading") : t("common.confirm")}
          </button>
        </>
      }
    >
      <form
        id="transition-form"
        className="form-grid"
        data-columns={1}
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          move.mutate(
            { to, reason: reason.trim(), usedBy: usedBy.trim() },
            {
              onSuccess: onDone,
              onError: (err) => setError(errorMessage(err)),
            },
          );
        }}
      >
        {to === "reclaimed" ? (
          <p className="muted">{t("ipam.reclaimHint")}</p>
        ) : null}

        {asksOwner ? (
          <Field label={t("ipam.usedBy")} hint={t("ipam.usedByHint")}>
            <SuggestInput
              value={usedBy}
              onChange={setUsedBy}
              options={departments}
              placeholder={t("ipam.usedByPlaceholder")}
              ariaLabel={t("ipam.usedBy")}
            />
          </Field>
        ) : null}

        <Field
          label={t("ipam.reason")}
          hint={t("ipam.reasonHint")}
          htmlFor="tr-reason"
        >
          <input
            id="tr-reason"
            className="inp"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>

        {error ? (
          <p className="alert error" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}

/** AC 5.2: lịch sử giữ VĨNH VIỄN và xem được ngay trên trang IP. */
function IpHistoryDialog({
  record,
  onClose,
}: {
  record: IpRow;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const history = useQuery({
    queryKey: ["ipam", "addresses", record.id, "history"],
    queryFn: () =>
      apiFetch<IpHistoryRow[]>(`/api/v1/ipam/addresses/${record.id}/history`),
  });

  return (
    <Dialog
      open
      onOpenChange={onClose}
      maxWidth={620}
      title={t("ipam.historyOf", { address: record.address })}
      footer={
        <button type="button" className="btn" onClick={onClose}>
          {t("common.close")}
        </button>
      }
    >
      {history.isLoading ? (
        <Loading />
      ) : history.isError ? (
        <LoadError onRetry={() => void history.refetch()} />
      ) : (
        <HistoryPanel
          entries={toIpHistoryEntries(history.data ?? [])}
          emptyText={t("ipam.historyEmpty")}
        />
      )}
    </Dialog>
  );
}
