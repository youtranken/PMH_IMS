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
import { RowActions } from "@/ui/row-actions";
import { SuggestInput } from "@/ui/suggest-input";
import { useDepartments } from "@/ui/use-departments";
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
  /** Hồ sơ IP đang chờ XÓA (ẩn kèm lý do) — khác `moving` vốn là bước vòng đời. */
  const [voiding, setVoiding] = useState<IpRow | null>(null);
  const [restoring, setRestoring] = useState<IpRow | null>(null);
  /**
   * Dải ĐÃ VÔ HIỆU HÓA thì cả bảng này chỉ còn ĐỌC (28/08/2026).
   *
   * Hồ sơ IP vẫn hiện nguyên — đó chính là điểm: mấy cái máy ngoài kia không tự nhả IP tĩnh
   * ra chỉ vì cuốn sổ cất dải đi, nên giấu chúng đi là nói dối. Nhưng cấp mới, chuyển trạng
   * thái hay sửa thì API từ chối (`cidrOf` đòi dải còn sống), và một cái nút bấm vào rồi bị
   * từ chối là cái nút không nên có. Muốn sửa thì bật lại dải trước.
   */
  const subnetDisabled = item.voidedAt !== null;
  /**
   * Cấp IP · chuyển trạng thái · sửa hồ sơ: CẢ TEAM IT làm được (`@Roles('sa','admin','member')`).
   * Người cắm máy chính là người biết IP nào vừa cấp — bắt họ chờ Admin duyệt thì cuốn sổ sẽ
   * quay về file Excel trên máy ai đó.
   */
  const canWrite = !subnetDisabled;
  /** XÓA hồ sơ thì chỉ SA/Admin — API chặn, UI đừng bày nút ra để bấm rồi 403. */
  const canEdit = (me.role === "sa" || me.role === "admin") && !subnetDisabled;

  /*
   * "Hiện hồ sơ đã ẩn" — TẮT mặc định, và phải tắt mặc định.
   *
   * Ẩn một hồ sơ nhập nhầm phải trả ô đó về "trống"; đó là toàn bộ ý nghĩa của việc ẩn. Nhưng
   * cho tới 09/09 ẩn là đường MỘT CHIỀU: bật lại được cả một DẢI, còn một hồ sơ lẻ bấm nhầm
   * thì không có đường nào quay lại — nó biến khỏi mọi màn, `findOne` trả 404, nên không mở
   * ra xem được cả lý do vừa ghi. Ô tick này là đường tới nút "Bật lại".
   */
  const [showVoided, setShowVoided] = useState(false);

  const slots = useQuery({
    // `showVoided` PHẢI nằm trong khóa: thiếu nó thì bật ô tick xong màn hình đứng im vì
    // react-query trả lại đúng ảnh chụp cũ.
    queryKey: ["ipam", "subnets", id, "addresses", showVoided],
    queryFn: () =>
      apiFetch<SubnetSlot[]>(
        `/api/v1/ipam/subnets/${id}/addresses${showVoided ? "?includeVoided=true" : ""}`,
      ),
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

  // Đổi bộ lọc thì số dòng đổi theo; giữ nguyên trang 5 của tập cũ là nhìn vào một bảng
  // rỗng và tưởng không có gì.
  useEffect(() => {
    setPage((current) => clampPage(current, filtered.length));
  }, [filtered.length]);

  /*
   * Đổi DẢI thì về trang 1, không phải chỉ kẹp lại.
   *
   * Đang ở trang 4 của một /24 rồi bấm sang dải khác mà vẫn ở trang 4 là mở ra dòng 151–200
   * của dải mới, còn 150 địa chỉ đầu thì biến mất — không có gì trên màn hình giải thích vì
   * sao. Nút lọc đã `setPage(1)` rồi; đổi dải cũng phải vậy.
   */
  useEffect(() => {
    setPage(1);
  }, [id]);

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

      {/* Nói NGAY vì sao mọi nút biến mất. Không có dòng này thì bảng chỉ-đọc trông như hỏng. */}
      {subnetDisabled ? (
        <p className="alert">{t("ipam.voidedSlotHint")}</p>
      ) : null}

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

      {/*
        Đường tới nút "Bật lại". Chỉ SA/Admin thấy: họ là người duy nhất ẩn được, nên cũng là
        người duy nhất cần bật lại. Dải đã ẩn thì mọi hồ sơ trong đó vốn đã hiện — ô tick ở đó
        không đổi gì, nên không bày ra.
      */}
      {canEdit ? (
        <label className="row" style={{ gap: "var(--space-3)" }}>
          <input
            type="checkbox"
            checked={showVoided}
            onChange={(e) => {
              setShowVoided(e.target.checked);
              setPage(1);
            }}
          />
          {t("ipam.showVoided")}
        </label>
      ) : null}

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
                        {canWrite ? (
                          <button
                            type="button"
                            className="btn sm"
                            onClick={() =>
                              setEditing({ record: null, address: slot.address })
                            }
                          >
                            {t("ipam.assign")}
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ) : (
                    <tr key={slot.id}>
                      <td data-label={t("ipam.address")}>
                        <span className="mono">{slot.address}</span>
                      </td>
                      <td data-label={t("ipam.status")}>
                        {/*
                          Hồ sơ ĐÃ ẨN phải đọc ra là đã ẩn, không phải "Đang dùng" mờ mờ: nó
                          giữ nguyên `status` cũ, nên vẽ theo `status` là nói dối trắng trợn về
                          một hàng mà người khác đang được phép cấp lại địa chỉ đó.
                        */}
                        {slot.voidedAt ? (
                          <span className="badge muted" title={slot.voidReason ?? undefined}>
                            {t("ipam.voidedBadge")}
                          </span>
                        ) : (
                          <span className={`badge ${STATUS_TONE[slot.status]}`}>
                            {t(STATUS_KEY[slot.status])}
                          </span>
                        )}
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
                          {/*
                            Năm cái nút cạnh nhau trước đây ("Đánh dấu nghi chết" · "Thu hồi" ·
                            "Lịch sử" · "Sửa" · "Xóa") làm cột cuối rộng hơn cả năm cột dữ liệu
                            còn lại cộng lại, trên một bảng người ta mở ra để ĐỌC địa chỉ. Và số
                            nút đổi theo từng dòng, nên mắt phải quét lại mỗi hàng.
                          */}
                          <RowActions
                            label={t("common.actionsOf", { subject: slot.address })}
                            items={[
                              /*
                                Hồ sơ ĐÃ ẨN chỉ có hai việc: xem lịch sử, và BẬT LẠI. Mọi việc
                                khác (chuyển trạng thái, sửa, ẩn tiếp) API đều từ chối vì chúng
                                đi qua `requireAlive` — bày ra là bày nút để bấm rồi ăn lỗi.
                              */
                              ...(slot.voidedAt
                                ? [
                                    {
                                      key: "restore",
                                      label: t("ipam.restoreAddress"),
                                      onSelect: () => setRestoring(slot),
                                    },
                                  ]
                                : []),
                              /* Chỉ hiện những bước chuyển ĐI ĐƯỢC từ trạng thái hiện tại — một
                                 cái nút bấm vào rồi bị từ chối là cái nút không nên có. */
                              ...(canWrite && !slot.voidedAt
                                ? NEXT_STATUSES[slot.status].map((to) => ({
                                    key: `to-${to}`,
                                    label: t(TRANSITION_LABEL[`${slot.status}->${to}`]),
                                    onSelect: () => setMoving({ record: slot, to }),
                                    danger: to === "reclaimed",
                                  }))
                                : []),
                              {
                                key: "history",
                                label: t("ipam.history"),
                                onSelect: () => setHistoryOf(slot),
                              },
                              ...(canWrite && !slot.voidedAt
                                ? [
                                    {
                                      key: "edit",
                                      label: t("common.edit"),
                                      onSelect: () =>
                                        setEditing({
                                          record: slot,
                                          address: slot.address,
                                        }),
                                    },
                                  ]
                                : []),
                              /*
                                XÓA hồ sơ IP — khác "Thu hồi".

                                Thu hồi là bước vòng đời: địa chỉ trả về pool nhưng hàng ở lại
                                kèm lịch sử "IP này từng của máy nào" (AC 5.2). Xóa là cho bản
                                ghi KHAI NHẦM: nó biến khỏi bảng, chỗ trống hiện lại như chưa
                                từng có ai cấp. Thiếu nút này thì một địa chỉ gõ nhầm nằm lại
                                trong sổ vĩnh viễn — người dùng báo đúng chuyện đó.

                                Vẫn là ẩn ở tầng DB, không DELETE: `ip_history` trỏ vào hàng này.
                              */
                              ...(canEdit && !slot.voidedAt
                                ? [
                                    {
                                      key: "void",
                                      label: t("common.delete"),
                                      onSelect: () => setVoiding(slot),
                                      danger: true,
                                    },
                                  ]
                                : []),
                            ]}
                          />
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

      {voiding ? (
        <VoidAddressDialog
          record={voiding}
          csrfToken={me.csrfToken}
          onClose={() => setVoiding(null)}
          onDone={() => {
            setVoiding(null);
            toast({ message: t("ipam.addressVoided") });
            void refresh();
          }}
        />
      ) : null}

      {restoring ? (
        <RestoreAddressDialog
          record={restoring}
          csrfToken={me.csrfToken}
          onClose={() => setRestoring(null)}
          onDone={() => {
            setRestoring(null);
            toast({ message: t("ipam.addressRestored") });
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
        `/api/v1/devices?limit=20&usable=true&search=${encodeURIComponent(deviceTerm)}`,
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
      /* Đang ghi thì KHÔNG cho đóng bằng Esc / bấm nền: hộp biến mất nhưng lượt ghi
         vẫn chạy tiếp, nên người dùng tin là đã hủy trong khi dữ liệu đã vào sổ. */
      dismissible={!save.isPending}
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
            failed={devices.isError}
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
            options={departments.names}
            failed={departments.failed}
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
  /*
   * "Xác nhận vẫn dùng" mở ra với chủ HIỆN TẠI đã điền sẵn, không phải ô trống.
   *
   * Ô trống ở đây từng là một câu hỏi trá hình: người trực thấy trống, để nguyên, bấm Xác
   * nhận — và `used_by` bị xóa. Máy tưởng chết hóa ra còn sống thì nó vẫn là chính nó, chủ
   * không đổi; điền sẵn nói đúng điều đó và vẫn cho sửa nếu quả thật đã đổi chủ.
   *
   * Lượt CẤP MỚI (`free`/`reclaimed` → `assigned`) vẫn mở ô trống — ở đó chưa có chủ nào.
   */
  const [usedBy, setUsedBy] = useState(
    record.status === "suspect_dead" ? (record.usedBy ?? "") : "",
  );
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
      /* Đang ghi thì KHÔNG cho đóng bằng Esc / bấm nền: hộp biến mất nhưng lượt ghi
         vẫn chạy tiếp, nên người dùng tin là đã hủy trong khi dữ liệu đã vào sổ. */
      dismissible={!move.isPending}
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
              options={departments.names}
              failed={departments.failed}
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


/**
 * Xóa (ẩn) MỘT hồ sơ IP, kèm lý do.
 *
 * Cùng khuôn với hộp ẩn dải và hộp gỡ rule NAT: "địa chỉ này biến đi đâu" là câu sáu tháng
 * sau sẽ có người hỏi, và chỉ dòng lịch sử trả lời được. Dùng hộp riêng chứ không dùng
 * `useConfirm` chung vì lý do ở đây là DỮ LIỆU bắt buộc, không phải một câu có/không.
 */
/**
 * Bật lại một hồ sơ đã ẩn.
 *
 * Là hộp thoại chứ không phải một cú bấm thẳng: API có thể từ chối vì địa chỉ đã bị hồ sơ khác
 * chiếm trong lúc này (`IP_TAKEN`) hoặc vì dải cha đang bị ẩn (`SUBNET_VOIDED`). Cả hai câu
 * đều cần chỗ để hiện ra và cần người đọc — nuốt chúng vào một cái toast đỏ nửa giây là đúng
 * lỗi mà đợt B vừa dọn ở màn duyệt.
 */
function RestoreAddressDialog({
  record,
  csrfToken,
  onClose,
  onDone,
}: {
  record: IpRow;
  csrfToken: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const restore = useApiMutation<Record<string, never>, unknown>(
    `/api/v1/ipam/addresses/${record.id}/restore`,
    { csrfToken, refreshMe: false },
  );

  return (
    <Dialog
      open
      onOpenChange={onClose}
      /* Đang ghi thì KHÔNG cho đóng bằng Esc / bấm nền: hộp biến mất nhưng lượt ghi
         vẫn chạy tiếp, nên người dùng tin là đã hủy trong khi dữ liệu đã vào sổ. */
      dismissible={!restore.isPending}
      maxWidth={480}
      title={`${t("ipam.restoreAddress")} — ${record.address}`}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={restore.isPending}
            onClick={() => {
              setError(null);
              restore.mutate(
                {},
                { onSuccess: onDone, onError: (err) => setError(errorMessage(err)) },
              );
            }}
          >
            {restore.isPending ? t("common.loading") : t("ipam.restoreAddress")}
          </button>
        </>
      }
    >
      <p className="muted">{t("ipam.restoreAddressHint")}</p>
      {record.voidReason ? (
        <p className="muted">
          {t("ipam.voidReasonWas")} <b>{record.voidReason}</b>
        </p>
      ) : null}
      {error ? (
        <p className="alert error" role="alert">
          {error}
        </p>
      ) : null}
    </Dialog>
  );
}

function VoidAddressDialog({
  record,
  csrfToken,
  onClose,
  onDone,
}: {
  record: IpRow;
  csrfToken: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const remove = useApiMutation<{ reason: string }, unknown>(
    `/api/v1/ipam/addresses/${record.id}`,
    { method: "DELETE", csrfToken, refreshMe: false },
  );

  return (
    <Dialog
      open
      onOpenChange={onClose}
      /* Đang ghi thì KHÔNG cho đóng bằng Esc / bấm nền: hộp biến mất nhưng lượt ghi
         vẫn chạy tiếp, nên người dùng tin là đã hủy trong khi dữ liệu đã vào sổ. */
      dismissible={!remove.isPending}
      maxWidth={480}
      title={`${t("common.delete")} — ${record.address}`}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button
            type="submit"
            form="ip-void-form"
            className="btn danger"
            disabled={remove.isPending}
          >
            {remove.isPending ? t("common.loading") : t("common.delete")}
          </button>
        </>
      }
    >
      <form
        id="ip-void-form"
        className="form-grid"
        data-columns={1}
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          remove.mutate(
            { reason: reason.trim() },
            { onSuccess: onDone, onError: (err) => setError(errorMessage(err)) },
          );
        }}
      >
        <p className="muted">{t("ipam.voidAddressHint")}</p>
        <Field label={t("ipam.reason")} required htmlFor="ip-void-reason">
          <input
            id="ip-void-reason"
            className="inp"
            required
            minLength={3}
            placeholder={t("ipam.voidAddressPlaceholder")}
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
