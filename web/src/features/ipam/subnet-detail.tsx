import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import { apiFetch } from "@/lib/api-client";
import { errorMessage, useApiMutation } from "@/lib/api";
import { formatDate, orDash } from "@/lib/format";
import type { Me } from "@/lib/me";
import { Dialog } from "@/ui/dialog";
import { DatePicker } from "@/ui/date-picker";
import { EmptyState, LoadError, Loading } from "@/ui/load-state";
import { Field } from "@/ui/page-header";
import { Pagination } from "@/ui/pagination";
import { RowActions } from "@/ui/row-actions";
import { SuggestInput } from "@/ui/suggest-input";
import { useDepartments } from "@/ui/use-departments";
import { textRule, useFormErrors } from "@/ui/use-form-errors";
import { FilterBar } from "@/ui/filter-bar";
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
  BUCKET_KEY,
  countSlots,
  filterSlots,
  shouldIsolateAssigned,
  pageOfAddress,
  pageSlots,
  searchSlots,
  SLOT_FILTERS,
  SLOT_PAGE_SIZE,
  VOIDED_FILTER,
  type SlotFilter,
} from "./slot-paging";
import { toIpHistoryEntries, type IpHistoryRow } from "./ip-history-entries";
import { AssignIpDialog, DeviceCombobox, ownerRule } from "./ip-assign-dialog";
import { PATHS } from "@/lib/routes";
import { clampPage } from "@/lib/paging";

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
  /*
   * `null` = NGƯỜI DÙNG CHƯA CHỌN GÌ, để bên dưới tự chọn hộ theo dải đang mở. Khác hẳn
   * `"all"` — đó là một lựa chọn thật sự của người dùng và phải được tôn trọng.
   */
  const [status, setStatus] = useState<SlotFilter | null>(null);
  const [page, setPage] = useState(1);
  /** Hồ sơ đang mở hộp SỬA. Cấp mới đi hộp riêng (`assigning`) — hai việc, hai hộp. */
  const [editing, setEditing] = useState<IpRow | null>(null);
  /** Hộp "Cấp IP" — `record` null là ô chưa từng có hồ sơ, có là hồ sơ đang Trống. */
  const [assigning, setAssigning] = useState<{
    address: string;
    record: IpRow | null;
  } | null>(null);
  /** Chỉ còn bước THU HỒI đi hộp này; bước cấp đã gộp vào `assigning`. */
  const [moving, setMoving] = useState<{ record: IpRow; to: IpStatus } | null>(
    null,
  );
  /** Ô tìm ngay trên bảng — lọc tại chỗ trên cả dải. */
  const [needle, setNeedle] = useState("");
  /**
   * `?ip=` — đến từ ô tra cứu cấp trang hoặc hộp Tìm nhanh: nhảy tới đúng trang chứa địa chỉ
   * và tô sáng dòng. Đọc từ URL để link gửi cho nhau mở ra đúng chỗ.
   */
  const [params] = useSearchParams();
  const focusIp = params.get("ip");
  const [highlight, setHighlight] = useState<string | null>(null);
  const appliedFocus = useRef<string | null>(null);
  const highlightRow = useRef<HTMLTableRowElement | null>(null);
  const scrolledTo = useRef<string | null>(null);
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
  /*
   * `useMemo` cho `all` (20/09/2026): `slots.data ?? []` sinh một MẢNG MỚI mỗi lượt render
   * khi dữ liệu chưa về, và mảng ấy là dep của hai memo bên dưới. Tác động thực tế gần 0
   * — có dữ liệu rồi thì `all === slots.data` nhờ structural sharing của TanStack — nhưng
   * để nguyên là một cảnh báo `exhaustive-deps` đứng mãi trong cổng, và một cảnh báo đứng
   * mãi là chỗ những cảnh báo THẬT về sau nấp vào.
   */
  const all = useMemo(() => slots.data ?? [], [slots.data]);
  const counts = useMemo(() => countSlots(all), [all]);

  /*
   * MẶC ĐỊNH CHỌN HỘ — nhưng chỉ MỘT LẦN, lúc dải vừa mở ra.
   *
   * Vấn đề thật: một /24 đã dùng 12 địa chỉ thì mở ra là 242 ô trống xếp trước mặt, 12 dòng có
   * dữ liệu nằm rải trong sáu trang. Câu hỏi hay gặp nhất — "dải này đang cấp cho những ai" —
   * phải tự đi tìm. Nhưng cũng KHÔNG được mặc định "Đang dùng" cho mọi dải: một /29 mới khai có
   * 6 ô trống thì "Đang dùng" mở ra một bảng rỗng, mà chính 6 ô trống ấy mới là thứ người ta
   * vào để bấm "Cấp IP này".
   *
   * Ngưỡng: chỉ chọn hộ khi ô trống ĐỦ NHIỀU để chôn mất dữ liệu, và khi thật sự có dữ liệu
   * để xem.
   *
   * VÌ SAO PHẢI GHIM BẰNG `ref` THAY VÌ TÍNH LẠI MỖI LƯỢT RENDER: tính lại thì ngay sau khi
   * người dùng bấm "Cấp IP này" trên một dải rộng, `assigned` nhảy từ 0 lên 1 và bộ lọc tự
   * đổi dưới tay họ — danh sách ô trống họ đang làm việc biến mất giữa chừng.
   */
  const decidedFor = useRef<string | null>(null);

  /*
   * Đổi DẢI thì về trang 1, bỏ bộ lọc cũ, VÀ cho phép quyết lại.
   *
   * ===== VÌ SAO KHỐI NÀY PHẢI KHAI TRƯỚC KHỐI QUYẾT (18/09/2026) =====
   *
   * React chạy effect theo THỨ TỰ KHAI. Bản trước đặt khối này ở cuối file, sau khối quyết,
   * nên khi `id` đổi trong cùng một commit thì:
   *
   *     khối quyết:  decidedFor.current = 'B'; setStatus('assigned')
   *     khối reset:  setStatus(null)            → bộ lọc rơi về "Tất cả"
   *
   * và vì `decidedFor.current` đã bị ghim là 'B', khối quyết KHÔNG BAO GIỜ chạy lại cho dải
   * B — tính năng tự huỷ. Cảnh dựng lại được: mở dải A → sang B → quay lại A. Lần này
   * `slots.data` của A có sẵn trong cache react-query nên có ngay ở lượt render đầu, hai
   * effect cùng bắn, và một /24 có 12 địa chỉ lại đổ ra 242 ô trống — đúng thứ đoạn mã này
   * viết ra để chặn. Chỉ lần mở ĐẦU TIÊN (chưa cache, `slots.data` còn `undefined`) là chạy
   * đúng, nên lỗi trông như "lúc được lúc không".
   *
   * Đặt trước + nhả ghim thì thứ tự thành: reset → quyết, và dải mới được quyết lại tử tế.
   *
   * BỘ LỌC phải theo trang: đang soi "Đã ẩn" ở dải A rồi bấm sang dải B là
   * gặp một bảng TRỐNG TRƠN cho một dải đầy địa chỉ — nút lọc nằm tít trên, và không ai nghĩ
   * dải mới lại thừa hưởng bộ lọc của dải cũ.
   */
  useEffect(() => {
    setPage(1);
    setStatus(null);
    setNeedle("");
    setHighlight(null);
    decidedFor.current = null;
  }, [id]);

  useEffect(() => {
    if (!slots.data || decidedFor.current === id) return;
    decidedFor.current = id;
    const fresh = countSlots(slots.data);
    setStatus(shouldIsolateAssigned(fresh.assigned, fresh.free) ? "assigned" : "all");
  }, [slots.data, id]);

  /*
   * Nhảy tới địa chỉ được hỏi — khai SAU khối quyết để thắng nó trong cùng một commit (React
   * chạy effect theo thứ tự khai): địa chỉ cần tra có thể đang Trống, và bộ lọc "Đang dùng"
   * mà khối quyết chọn hộ sẽ giấu mất đúng dòng đó. Mỗi cặp dải + địa chỉ chỉ áp MỘT lần —
   * áp lại sau mỗi lượt tải (vd vừa cấp IP xong) là giật trang dưới tay người dùng.
   */
  useEffect(() => {
    if (!slots.data || !focusIp) return;
    const key = `${id}|${focusIp}`;
    if (appliedFocus.current === key) return;
    appliedFocus.current = key;
    decidedFor.current = id;
    setStatus("all");
    setNeedle("");
    setPage(pageOfAddress(slots.data, focusIp) ?? 1);
    setHighlight(focusIp);
  }, [slots.data, focusIp, id]);

  const shown: SlotFilter = status ?? "all";
  const filtered = useMemo(
    () => searchSlots(filterSlots(all, shown), needle),
    [all, shown, needle],
  );

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
    setPage((current) => clampPage(current, filtered.length, SLOT_PAGE_SIZE));
  }, [filtered.length]);

  // Cuộn tới dòng được tô sáng một lần — trên điện thoại nó thường nằm dưới mép màn hình.
  useEffect(() => {
    if (!highlight || scrolledTo.current === highlight) return;
    if (!highlightRow.current) return;
    scrolledTo.current = highlight;
    highlightRow.current.scrollIntoView?.({ block: "center" });
  });

  /** Nút "Cấp IP" trên dòng — ô trống và hồ sơ Trống mở cùng một hộp. */
  const assignButton = (address: string, record: IpRow | null) =>
    canWrite ? (
      <button
        type="button"
        className="btn sm"
        onClick={() => setAssigning({ address, record })}
      >
        {t("ipam.assign")}
      </button>
    ) : null;

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
        {/*
          Chip "Đã ẩn" chỉ mọc ra khi ô tick bên dưới đang bật (B-04, 23/09).

          Trước đó hồ sơ đã ẩn KHÔNG có rổ nào: nó mang `status='free'` trong DB nên rơi vào
          chip "Trống", và bấm "Trống" là nó hiện lên như một ô cấp được — trong khi thẻ dải
          ngay phía trên nói "Giữ lại vì còn 1 hồ sơ IP mang lịch sử".

          Không bày chip thường trực vì API chỉ trả hồ sơ đã ẩn khi `?includeVoided=true`: một
          chip "Đã ẩn 0" đứng mãi ở đó là mời người dùng bấm vào một rổ luôn rỗng rồi kết luận
          dải này không có hồ sơ nào bị ẩn — đúng cái kết luận sai đang phải sửa.
        */}
        {[...SLOT_FILTERS, ...(showVoided ? [VOIDED_FILTER] : [])].map((key) => (
          <button
            key={key}
            type="button"
            className={shown === key ? "on" : undefined}
            aria-pressed={shown === key}
            onClick={() => {
              setStatus(key);
              setPage(1);
            }}
          >
            {t(key === "all" ? "ipam.filterAll" : BUCKET_KEY[key])}{" "}
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
              /*
               * Tắt ô tick trong khi đang đứng ở chip "Đã ẩn" thì chip ấy biến mất cùng dữ
               * liệu của nó: không chip nào sáng, bảng rỗng trơn, và người dùng kết luận dải
               * này không còn gì. Trả bộ lọc về "Tất cả" là đưa họ về chỗ nhìn thấy được.
               */
              if (!e.target.checked && shown === VOIDED_FILTER) setStatus("all");
              setPage(1);
            }}
          />
          {t("ipam.showVoided")}
        </label>
      ) : null}

      <FilterBar
        search={needle}
        onSearchChange={(value) => {
          setNeedle(value);
          setPage(1);
        }}
        searchPlaceholder={t("ipam.paneSearch")}
      />

      {slots.isLoading ? (
        <Loading />
      ) : slots.isError ? (
        <LoadError error={slots.error} onRetry={() => void slots.refetch()} />
      ) : (
        <>
          <div className="table-wrap">
            <table className="table table-stack">
              <thead>
                <tr>
                  <th>{t("ipam.address")}</th>
                  <th>{t("ipam.status")}</th>
                  <th className="col-device">{t("ipam.device")}</th>
                  <th>{t("ipam.usedBy")}</th>
                  <th className="col-date">{t("ipam.assignedAt")}</th>
                  <th className="col-center">{t("common.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((slot) =>
                  slot.kind === "free" ? (
                    <tr
                      key={slot.address}
                      className={
                        slot.address === highlight ? "row-highlight" : "row-muted"
                      }
                      ref={slot.address === highlight ? highlightRow : undefined}
                    >
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
                      {/* Ô Thao tác cũng phải có `data-label`: ở ≤960px bảng gập thẻ dọc và
                          năm ô kia đều tự xưng tên, riêng ô này thì không — thành ra một cái
                          nút lửng lơ không biết thuộc cột nào. */}
                      <td data-label={t("common.actions")}>
                        {assignButton(slot.address, null)}
                      </td>
                    </tr>
                  ) : (
                    <tr
                      key={slot.id}
                      /*
                        Hồ sơ đang Trống (đã thu hồi, hoặc hồ sơ không chủ có từ trước Q-14) nhìn
                        như ô trống: mờ, và nút "Cấp IP" ngay tại dòng. Để đậm như hồ sơ đang
                        dùng thì người đọc thấy một dòng "có gì đó" mà không biết là gì.
                      */
                      className={
                        slot.address === highlight
                          ? "row-highlight"
                          : isFreeRecord(slot)
                            ? "row-muted"
                            : undefined
                      }
                      ref={slot.address === highlight ? highlightRow : undefined}
                    >
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
                      <td data-label={t("ipam.device")} className="col-device">
                        {/* Mã máy một dòng (`.mono` trong ô bảng không ngắt), tên máy là dòng
                            phụ: mắt dò theo mã, tên để chắc là đúng cái máy mình nghĩ. */}
                        {slot.deviceId ? (
                          <>
                            <Link className="mono" to={PATHS.device(slot.deviceId)}>
                              {slot.deviceCode}
                            </Link>
                            {slot.deviceName ? (
                              <span className="cell-sub">{slot.deviceName}</span>
                            ) : null}
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td data-label={t("ipam.usedBy")}>
                        {orDash(slot.usedBy)}
                      </td>
                      <td data-label={t("ipam.assignedAt")} className="col-date">
                        {isFreeRecord(slot) ? "—" : orDash(formatDate(slot.assignedAt))}
                      </td>
                      <td data-label={t("common.actions")}>
                        <div className="action-cell">
                          {isFreeRecord(slot) ? assignButton(slot.address, slot) : null}
                          {/*
                            Gom vào một menu: bày từng nút cạnh nhau làm cột cuối rộng hơn cả các
                            cột dữ liệu cộng lại, trên một bảng người ta mở ra để ĐỌC địa chỉ. Và
                            số nút đổi theo từng dòng, nên mắt phải quét lại mỗi hàng.
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
                                 cái nút bấm vào rồi bị từ chối là cái nút không nên có. Bước
                                 CẤP đã là nút ngay trên dòng, nên menu chỉ còn bước Thu hồi. */
                              ...(canWrite && !slot.voidedAt
                                ? NEXT_STATUSES[slot.status]
                                    .filter((to) => to !== "assigned")
                                    .map((to) => ({
                                      key: `to-${to}`,
                                      label: t(TRANSITION_LABEL[`${slot.status}->${to}`]),
                                      onSelect: () => setMoving({ record: slot, to }),
                                      danger: to === "free",
                                    }))
                                : []),
                              {
                                key: "history",
                                label: t("ipam.history"),
                                onSelect: () => setHistoryOf(slot),
                              },
                              // Hồ sơ Trống thì "sửa" chính là cấp — đã có nút Cấp IP trên dòng.
                              ...(canWrite && !slot.voidedAt && !isFreeRecord(slot)
                                ? [
                                    {
                                      key: "edit",
                                      label: t("common.edit"),
                                      onSelect: () => setEditing(slot),
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
                                      label: t("ipam.voidAddress"),
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

          {/*
            BẢNG RỖNG PHẢI NÓI VÌ SAO RỖNG.
            Thiếu nhánh này thì lọc "Đang dùng" trên một dải chưa cấp ô nào cho ra một cái khung
            bảng trắng với đúng hàng tiêu đề, và người dùng không có cách nào biết đó là "dải
            sạch" hay "màn hỏng". Câu trả lời nằm
            ngay ở con số 0 trên chính nút họ vừa bấm — nhưng phải nói ra.
          */}
          {filtered.length === 0 ? (
            <EmptyState
              title={t("ipam.slotEmpty")}
              hint={shown === "all" ? t("ipam.slotEmptyAll") : t("ipam.slotEmptyFiltered")}
            />
          ) : null}

          <Pagination
            page={clampPage(page, filtered.length, SLOT_PAGE_SIZE)}
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
          record={editing}
          csrfToken={me.csrfToken}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            toast({ message: t("ipam.ipSaved") });
            void refresh();
          }}
        />
      ) : null}

      {assigning ? (
        <AssignIpDialog
          subnetId={id}
          address={assigning.address}
          record={assigning.record}
          csrfToken={me.csrfToken}
          onClose={() => setAssigning(null)}
          onDone={() => {
            const address = assigning.address;
            setAssigning(null);
            toast({ message: t("ipam.assigned", { address }) });
            void refresh();
          }}
        />
      ) : null}
    </>
  );
}

/**
 * Sửa một hồ sơ IP đang dùng. Cấp mới (ô trống hoặc hồ sơ Trống) đi `AssignIpDialog`.
 *
 * Gỡ hết máy lẫn người dùng của hồ sơ đang dùng là quay lại dòng mồ côi Q-14 cấm — muốn trả
 * địa chỉ về pool thì đi "Thu hồi", nơi lịch sử ghi lại chủ cũ.
 */
function IpForm({
  record,
  csrfToken,
  onClose,
  onSaved,
}: {
  record: IpRow;
  csrfToken: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [device, setDevice] = useState({
    deviceId: record.deviceId ?? "",
    term: record.deviceCode ?? "",
  });
  const [usedBy, setUsedBy] = useState(record.usedBy ?? "");
  const departments = useDepartments();
  const [assignedAt, setAssignedAt] = useState(record.assignedAt ?? "");
  const [note, setNote] = useState(record.note ?? "");
  const [error, setError] = useState<string | null>(null);
  const check = useFormErrors({
    owner: record.status === "assigned" ? ownerRule(t, device.deviceId, usedBy) : null,
  });

  const save = useApiMutation<Record<string, unknown>, unknown>(
    `/api/v1/ipam/addresses/${record.id}`,
    { method: "PATCH", csrfToken, refreshMe: false },
  );

  return (
    <Dialog
      open
      onOpenChange={onClose}
      /* Đang ghi thì KHÔNG cho đóng bằng Esc / bấm nền: hộp biến mất nhưng lượt ghi
         vẫn chạy tiếp, nên người dùng tin là đã hủy trong khi dữ liệu đã vào sổ. */
      dismissible={!save.isPending}
      maxWidth={560}
      title={t("ipam.editIp", { address: record.address })}
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
        ref={check.formRef}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          if (!check.check()) return;
          save.mutate(
            {
              deviceId: device.deviceId,
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
          <p className="static-value mono">{record.address}</p>
        </Field>

        <Field label={t("ipam.device")} hint={t("ipam.deviceHint")} error={check.error("owner")}>
          <DeviceCombobox
            deviceId={device.deviceId}
            term={device.term}
            onChange={setDevice}
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
 * Xác nhận bước THU HỒI.
 *
 * Hỏi LÝ DO: sáu tháng sau, câu "vì sao IP này bị thu hồi" chỉ còn dòng lịch sử trả lời được.
 * Bước cấp không đi đây — nó cần đủ máy/người/ngày, nên dùng chung hộp `AssignIpDialog`.
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
  const [error, setError] = useState<string | null>(null);

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
            className={to === "free" ? "btn danger" : "btn primary"}
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
            { to, reason: reason.trim() },
            {
              onSuccess: onDone,
              onError: (err) => setError(errorMessage(err)),
            },
          );
        }}
      >
        {to === "free" ? (
          <p className="muted">{t("ipam.reclaimHint")}</p>
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
        <LoadError error={history.error} onRetry={() => void history.refetch()} />
      ) : (
        <HistoryPanel
          entries={toIpHistoryEntries(history.data ?? [], t)}
          emptyText={t("ipam.historyEmpty")}
        />
      )}
    </Dialog>
  );
}


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

/**
 * Xóa (ẩn) MỘT hồ sơ IP, kèm lý do.
 *
 * Cùng khuôn với hộp ẩn dải và hộp gỡ rule NAT: "địa chỉ này biến đi đâu" là câu sáu tháng
 * sau sẽ có người hỏi, và chỉ dòng lịch sử trả lời được. Dùng hộp riêng chứ không dùng
 * `useConfirm` chung vì lý do ở đây là DỮ LIỆU bắt buộc, không phải một câu có/không.
 *
 * Khối này trước 26/09 nằm lạc chỗ: nó đứng NGAY TRÊN docblock của `RestoreAddressDialog` —
 * hộp BẬT LẠI — nên người đọc gán nó cho hộp đó và tin rằng hộp bật lại đòi lý do bắt buộc.
 * Hộp nó thật sự tả, chính hộp này, thì không có docstring nào.
 */
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
  const check = useFormErrors({ reason: textRule(t, reason, 3) });
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
      title={`${t("ipam.voidAddress")} — ${record.address}`}
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
            {remove.isPending ? t("common.loading") : t("ipam.voidAddress")}
          </button>
        </>
      }
    >
      <form
        id="ip-void-form"
        className="form-grid"
        data-columns={1}
        ref={check.formRef}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          if (!check.check()) return;
          remove.mutate(
            { reason: reason.trim() },
            { onSuccess: onDone, onError: (err) => setError(errorMessage(err)) },
          );
        }}
      >
        <p className="muted">{t("ipam.voidAddressHint")}</p>
        <Field
          label={t("ipam.reason")}
          required
          htmlFor="ip-void-reason"
          error={check.error("reason")}
        >
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

/** Hồ sơ còn sống mà đang Trống — với người đọc bảng, nó là một chỗ trống cấp được. */
function isFreeRecord(slot: IpRow): boolean {
  return slot.status === "free" && !slot.voidedAt;
}
