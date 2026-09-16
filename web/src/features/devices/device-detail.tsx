import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ApiError, apiFetch } from "@/lib/api-client";
import { errorMessage, useApiMutation } from "@/lib/api";
import { formatDate } from "@/lib/format";
import type { Me } from "@/lib/me";
import { AttachmentPanel } from "@/ui/attachment-panel";
import { CopyButton } from "@/ui/copy-button";
import { BlankFields, DataItemIfSet, DetailHeader } from "@/ui/detail-header";
import {
  DetailLayout,
  RailCard,
  RailRow,
  RailRowIfSet,
} from "@/ui/detail-layout";
import { ExpiryBadge } from "@/ui/expiry-badge";
import { HistoryPanel } from "@/ui/history-panel";
import { LoadError, Loading, NotFound } from "@/ui/load-state";
import { TabPanel, Tabs, initialTab, useVisibleTab } from "@/ui/tabs";
import { useTabCounts } from "@/ui/tab-counts";
import { WarrantyTimeline } from "@/ui/warranty-timeline";
import { VaultPanel } from "@/ui/vault-panel";
import { useConfirm } from "@/ui/confirm-provider";
import { useToast } from "@/ui/toast";
import { DeviceLicensesExpand } from "@/features/software/device-licenses-expand";
import { DeviceForm } from "./device-form";
import { toHistoryEntries } from "./device-history-entries";
import { PortMapPanel } from "./port-map-panel";
import {
  STATUS_KEY,
  STATUS_TONE,
  locationLabel,
  type DeviceHistoryRow,
  type DeviceRow,
} from "@/lib/device-types";
import { PATHS } from "@/lib/routes";

/** Khu mở rộng do module khác đóng góp (Epic 3/4/5) — Đợt 1 luôn rỗng. */
interface DevicePanel {
  key: string;
  title: string;
  items: { label: string; value: string; link?: string; tone?: string }[];
  emptyText?: string;
}

/**
 * Trang chi tiết thiết bị tổng hợp (story 2.5, FR-001/002/006/007).
 *
 * Mở một trang thấy đủ: hồ sơ, tình trạng bảo hành, port map, giấy tờ, lịch sử.
 * Các khu IP · license · secret · phiếu đến từ `/devices/:id/panels` — module nào đăng ký
 * thì hiện, chưa có thì mảng rỗng và trang ẩn gọn, KHÔNG lỗi, không phụ thuộc tương lai.
 */
export function DeviceDetail({ me }: { me: Me }) {
  const { t } = useTranslation();
  const toast = useToast();
  const askConfirm = useConfirm();
  const queryClient = useQueryClient();
  const { id = "" } = useParams();
  const [params] = useSearchParams();
  const [tab, setTab] = useState(() =>
    initialTab(params.get("tab"), [
      "profile",
      "ports",
      "attachments",
      "vault",
      "history",
    ]),
  );
  const [editing, setEditing] = useState(false);

  const device = useQuery({
    queryKey: ["devices", id],
    queryFn: () => apiFetch<DeviceRow>(`/api/v1/devices/${id}`),
    retry: false,
  });

  const panels = useQuery({
    queryKey: ["devices", id, "panels"],
    queryFn: () => apiFetch<DevicePanel[]>(`/api/v1/devices/${id}/panels`),
    enabled: device.isSuccess,
  });

  const history = useQuery({
    queryKey: ["devices", id, "history"],
    queryFn: () =>
      apiFetch<DeviceHistoryRow[]>(`/api/v1/devices/${id}/history`),
    enabled: tab === "history",
  });

  /*
   * Đếm cổng cho huy hiệu trên tab Port map.
   *
   * Trước 16/09 chỉ Giấy tờ và Két sắt có số, nên tab DÀY nhất lại là tab duy nhất trông như
   * rỗng — người đọc suy "không có số nghĩa là không có gì".
   *
   * Dùng ĐÚNG `queryKey` của `PortMapPanel` nên đây không phải lượt gọi thứ hai: bấm sang tab
   * là dữ liệu đã nằm sẵn trong cache, tab mở ra không còn quay vòng chờ.
   */
  const ports = useQuery({
    queryKey: ["devices", id, "ports"],
    queryFn: () =>
      apiFetch<{ ports: unknown[] }>(`/api/v1/devices/${id}/ports`),
    enabled: device.data?.hasPortMap === true,
  });

  const setStatus = useApiMutation<{ status: string; cleanup?: boolean }, unknown>(
    `/api/v1/devices/${id}/status`,
    { method: "PATCH", csrfToken: me.csrfToken, refreshMe: false },
  );

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["devices"] });

  /**
   * Tab Két sắt hiện cho MỌI vai kể từ story 6.3.
   *
   * Trước đây chỉ SA/Admin thấy. Nhưng Member giờ có thể được whitelist hoặc xin duyệt, và
   * quyền đó nằm ở ma trận 6.2 — client không tự suy ra được từ vai. Ẩn tab theo vai thì
   * người đã được gán quyền lại không có đường nào tới. Panel tự nói rõ tầng của người xem.
   */
  const canVault = true;

  /*
   * Danh sách tab dựng TRƯỚC mấy nhánh `return` sớm bên dưới, vì `useVisibleTab` là hook:
   * đặt nó sau `if (device.isLoading) return` thì số hook giữa hai lượt render lệch nhau.
   * Lúc hồ sơ chưa về thì chỉ có Hồ sơ + Giấy tờ + Lịch sử, nhưng cũng chưa vẽ gì.
   */
  const counts = useTabCounts("device", id, me);
  const tabItems = [
    { key: "profile", label: t("devices.tabProfile") },
    // Tab Port map CHỈ hiện với loại có port (FR-006) — bảng port của một cái máy in
    // là chỗ trống vô nghĩa.
    ...(device.data?.hasPortMap
      ? [
          {
            key: "ports",
            label: t("devices.tabPortMap"),
            count: ports.data?.ports.length,
          },
        ]
      : []),
    {
      key: "attachments",
      label: t("devices.tabAttachments"),
      count: counts.files,
    },
    // Két sắt chỉ hiện với người có quyền — Member không có đường tới endpoint (AD-9),
    // hiện tab rồi báo 403 chỉ tổ làm người ta tưởng hệ thống hỏng.
    ...(canVault
      ? [{ key: "vault", label: t("vault.tab"), count: counts.secrets }]
      : []),
    { key: "history", label: t("devices.tabHistory") },
  ];
  const safeTab = useVisibleTab(
    tab,
    tabItems.map((entry) => entry.key),
    setTab,
  );

  if (device.isLoading) return <Loading />;
  if (device.isError) {
    // 404 = thiết bị không tồn tại → trang 404 tử tế, không phải khối lỗi đỏ "thử lại".
    return device.error instanceof ApiError && device.error.status === 404 ? (
      <NotFound />
    ) : (
      <LoadError error={device.error} onRetry={() => void device.refetch()} />
    );
  }

  const item = device.data!;
  const retired = item.status === "retired";
  /** Ghi vào két vẫn chỉ SA/Admin — API chặn, UI đừng bày ra nút để bấm rồi 403. */
  const canVaultWrite = me.role === "sa" || me.role === "admin";
  /** Khu do module `software` đăng ký — tách riêng vì nó có bảng riêng, không dùng khu chung. */
  const softwarePanel = (panels.data ?? []).find(
    (panel) => panel.key === "software",
  );

  return (
    <>
      <DetailHeader
        crumbs={[
          { label: t("nav.devices"), to: PATHS.devices },
          { label: item.deviceTypeName },
          { label: item.code },
        ]}
        code={item.code}
        name={item.name}
        /*
         * Dòng định danh CHỈ còn serial (16/09/2026).
         *
         * Loại thiết bị đã nằm ở breadcrumb ngay phía trên, model là một ô của lưới Hồ sơ ngay
         * phía dưới — in lại ở đây là nói ba lần cùng một chuyện trong vòng 200px, và chủ dự án
         * chỉ ra đúng chỗ đó. Serial thì ở lại: nó là thứ người ta chép đi dán vào terminal,
         * nên nút chép phải nằm chỗ dễ với nhất.
         */
        subline={
          item.serial ? (
            <span>
              S/N <span className="mono">{item.serial}</span>
              <CopyButton value={item.serial} label={t("devices.copySerial")} />
            </span>
          ) : null
        }
        actions={
          <>
            {/* NÚT CHÍNH của màn phải NẶNG HƠN nút phá (16/09/2026).
                Trước đây "Sửa hồ sơ" là nút viền xám còn "Thanh lý" là nút nền đỏ đặc: việc
                làm mỗi ngày thì thì thầm, còn việc một năm một lần và không lấy lại được thì
                hét lên — ngay tại góc phải, đúng chỗ mắt và chuột tìm nút chính. */}
            <button
              type="button"
              className="btn primary"
              disabled={retired}
              title={retired ? t("devices.retiredLocked") : undefined}
              onClick={() => setEditing(true)}
            >
              {t("devices.edit")}
            </button>
            {/* ĐỎ khi là "Thanh lý", KHÔNG đỏ khi là "Mở lại".
                Màu đỏ nói "việc này lấy đi cái gì đó" — thanh lý khóa hồ sơ, dừng tính hạn,
                cắt máy khỏi email nhắc gia hạn. Mở lại là việc ngược lại, tô đỏ nó thì màu đỏ
                thành trang trí và lần sau người dùng không còn đọc nó như một cảnh báo nữa. */}
            <button
              type="button"
              /* `danger-ghost` chứ không phải `danger` nền đặc: đỏ vẫn nói "việc này lấy đi
                 cái gì đó", nhưng không còn là thứ nặng nhất trên màn. Nền đỏ đặc để dành cho
                 nút xác nhận TRONG hộp thoại — chỗ người ta đã đọc câu hỏi rồi. */
              className={retired ? "btn" : "btn danger-ghost"}
              onClick={() => {
                void (async () => {
                  let cleanup = false;
                  if (!retired) {
                    /*
                     * Ô tick "dọn hết thứ liên quan": không tick thì API CHẶN và liệt kê đích
                     * danh thứ máy còn giữ (IP, rule NAT, ghế license). Mặc định KHÔNG tick là
                     * có chủ ý — dọn tự động thu hồi IP và gỡ rule NAT trong một cú bấm, nên
                     * nó phải là điều người dùng nói ra.
                     */
                    const answer = await askConfirm({
                      title: t("common.titleOf", {
                        action: t("devices.retire"),
                        subject: item.code,
                      }),
                      message: t("devices.confirmRetire", { name: item.code }),
                      danger: true,
                      confirmLabel: t("devices.retire"),
                      checkbox: {
                        label: t("devices.retireCleanup"),
                        hint: t("devices.retireCleanupHint"),
                      },
                    });
                    if (!answer.ok) return;
                    cleanup = answer.checked;
                  } else {
                    /*
                     * ===== NHÁNH "ĐƯA LẠI VÀO DÙNG" CŨNG PHẢI HỎI (12/09, rà UI/UX #21) =====
                     *
                     * Mục #21 nói đúng một nửa: nút này CÙNG TỌA ĐỘ với "Thanh lý" hôm trước,
                     * nên trí nhớ cơ bắp dẫn tay tới đây. Bản trước nhánh `retired` đi thẳng
                     * vào `mutate` — tức một cú bấm theo quán tính đổi luôn trạng thái hồ sơ.
                     *
                     * VÌ SAO KHÔNG DỒN VÀO `RowActions` NHƯ HAI CHỖ BẢNG: đầu trang này chỉ có
                     * HAI nút, và một trong hai ("Sửa hồ sơ") là hành động chính của màn. Đẩy
                     * nút còn lại vào menu là dựng một menu MỘT MỤC — đúng thứ
                     * `docs/SHARED-REGISTRY.md` viết rõ là KHÔNG dùng ("thêm một cú bấm mà
                     * không giấu được gì"). Nên chỗ này vá cái hở thật: không tọa độ nào trên
                     * đầu trang đổi được trạng thái hồ sơ mà không hỏi một câu.
                     */
                    const ok = await askConfirm({
                      title: t("common.titleOf", {
                        action: t("devices.reopen"),
                        subject: item.code,
                      }),
                      message: t("devices.confirmReopen", { name: item.code }),
                      confirmLabel: t("devices.reopen"),
                    });
                    if (!ok) return;
                  }
                  setStatus.mutate(
                    { status: retired ? "in_use" : "retired", cleanup },
                    {
                      onSuccess: () => {
                        toast({ message: t("devices.statusChanged") });
                        void refresh();
                      },
                      onError: (err) =>
                        toast({ message: errorMessage(err), tone: "error" }),
                    },
                  );
                })();
              }}
            >
              {t(retired ? "devices.reopen" : "devices.retire")}
            </button>
          </>
        }
      />

      {retired ? <p className="alert">{t("devices.retiredLocked")}</p> : null}

      <DetailLayout
        rail={
          <RailCard title={t("detail.identityCard")}>
            <RailRow
              label={t("devices.status")}
              note={
                item.purchaseDate
                  ? t("devices.since", { date: formatDate(item.purchaseDate) })
                  : undefined
              }
            >
              <span className={`badge ${STATUS_TONE[item.status]}`}>
                {t(STATUS_KEY[item.status])}
              </span>
            </RailRow>
            {/* KHÔNG kèm `note={cabinetCode}`: `locationLabel` đã ghép sẵn "LST · T-1", nên
                dòng chú bên dưới in lại đúng mã tủ ấy lần thứ hai trong cùng một ô. */}
            <RailRow label={t("devices.location")}>
              <span className="mono">{locationLabel(item)}</span>
            </RailRow>
            <RailRowIfSet
              label={t("devices.assignedTo")}
              value={item.assignedTo}
              note={item.department ?? undefined}
            />
            {/*
             * THANH HẠN NẰM Ở ĐÂY, KHÔNG CÒN Ở CỘT CHÍNH NỮA (16/09/2026).
             *
             * Trước đây tab Hồ sơ có hẳn một thẻ "Bảo hành" chiếm trọn bề ngang, in lại đúng ba
             * con số mà dải chỉ số đã có (còn N ngày, đến ngày nào, nhà cung cấp) — hai chỗ cách
             * nhau 40px. Và một thanh tiến độ kéo dài 1150px thì phần kéo dài ấy không nói thêm
             * gì cả. Hạn là TRẠNG THÁI của hồ sơ nên nó thuộc về thẻ định danh.
             *
             * Vẫn là `WarrantyTimeline` ĐẦY ĐỦ chứ không phải bản `compact`: bản gọn giấu hai
             * mốc ngày và dòng "Đã đi N%", mà đó là những thứ thanh này sinh ra để nói.
             */}
            <RailRow label={t("devices.warranty")}>
              {item.warrantyEnd ? (
                <WarrantyTimeline
                  start={item.warrantyStart ?? item.purchaseDate}
                  end={item.warrantyEnd}
                  startLabel={
                    item.warrantyStart
                      ? t("devices.warrantyStart")
                      : t("devices.purchaseDate")
                  }
                  endLabel={t("devices.warrantyEnd")}
                />
              ) : (
                <ExpiryBadge end={null} />
              )}
            </RailRow>
            <RailRowIfSet label={t("devices.vendor")} value={item.vendorName} />
            <RailRowIfSet
              label={t("devices.purchaseDate")}
              value={formatDate(item.purchaseDate)}
            />
          </RailCard>
        }
      >
        <Tabs
          items={tabItems}
          value={safeTab}
          onChange={setTab}
          ariaLabel={t("devices.title")}
        />

        <TabPanel tabKey={safeTab}>
        {safeTab === "profile" ? (
          <>
            {/*
             * Lưới này chỉ còn thứ CHƯA nói ở đâu khác. Thanh bảo hành, trạng thái, vị trí,
             * người dùng, nhà cung cấp, ngày mua đều đã ở thẻ định danh bên phải; serial thì ở
             * dòng định danh dưới tiêu đề, chỗ có nút chép. In lại ở đây là đúng lỗi bản trước.
             */}
            <dl className="data-grid">
              <DataItemIfSet label={t("devices.model")} value={item.model} />
              <DataItemIfSet label={t("devices.note")} value={item.note} />
            </dl>

            {/* Ô chưa khai gom về MỘT dòng, thay cho một dãy hộp chỉ chứa dấu gạch ngang —
                hồ sơ khai sơ sài trông như dữ liệu hỏng chứ không phải việc còn thiếu. */}
            <BlankFields
              labels={[
                item.model ? null : t("devices.model"),
                item.serial ? null : t("devices.serial"),
                item.vendorName ? null : t("devices.vendor"),
                item.department ? null : t("devices.department"),
                item.purchaseDate ? null : t("devices.purchaseDate"),
                item.note ? null : t("devices.note"),
              ].filter((label): label is string => label !== null)}
            />

            {/* Phần mềm đang cài dùng BẢNG GHẾ đầy đủ (kỳ hạn · chi phí · hợp đồng), không
                phải khu `nhãn: giá trị` chung — cùng một bảng với khu bung dòng ở danh sách
                thiết bị, nên hai chỗ không thể trả lời khác nhau (AD-15).

                Tiêu đề lấy từ CHÍNH `panel.title` của API, không tự đặt một chuỗi thứ hai:
                module `software` là chủ sở hữu khu này (nó tự đăng ký vào sổ của `devices`),
                nên nó cũng là nơi quyết định khu ấy tên gì. Đặt tên riêng ở đây là để hai
                chỗ trôi lệch nhau, và bài kiểm e2e đã bắt đúng lúc chúng bắt đầu lệch. */}
            {softwarePanel ? (
              <section className="card device-panel">
                <h2 className="form-section-title">{softwarePanel.title}</h2>
                <DeviceLicensesExpand deviceId={item.id} />
              </section>
            ) : null}

            {/*
              KHU MỞ RỘNG HỎNG PHẢI NÓI RA, KHÔNG ĐƯỢC BIẾN MẤT.
              `(panels.data ?? [])` biến một lỗi 500 thành "máy này không giữ gì cả" — và
              trang vẫn trông hoàn chỉnh, vì phần hồ sơ ở trên vẫn đầy đủ. Đúng câu hỏi người
              ta mở trang này ra để hỏi TRƯỚC KHI THANH LÝ: máy còn giữ IP, rule NAT, ghế
              license nào không. Đọc nhầm sự im lặng đó thành "sạch rồi" là thanh lý nhầm.
            */}
            {panels.isError ? (
              <div className="card device-panel">
                <LoadError error={panels.error} onRetry={() => void panels.refetch()} />
              </div>
            ) : (
              <ExtensionPanels
                panels={(panels.data ?? []).filter(
                  (panel) => panel.key !== "software",
                )}
              />
            )}
          </>
        ) : safeTab === "ports" ? (
          <PortMapPanel
            device={item}
            csrfToken={me.csrfToken}
            canEdit={!retired}
          />
        ) : safeTab === "vault" ? (
          <VaultPanel
            ownerType="device"
            ownerId={item.id}
            me={me}
            /* Ghi vào két là việc của SA/Admin. Member giờ MỞ được tab (story 6.3) nên
               phải chặn ở đây — không thì họ thấy "Cất secret"/"Xoay"/"Xóa" và bấm vào
               là 403 (code review Epic 6, finding 3). */
            canEdit={canVaultWrite && !retired}
          />
        ) : safeTab === "attachments" ? (
          <AttachmentPanel
            ownerType="device"
            ownerId={item.id}
            csrfToken={me.csrfToken}
            /* Thiết bị đã thanh lý: hồ sơ khóa lại thì giấy tờ cũng chỉ còn đọc/tải. */
            canEdit={!retired}
          />
        ) : history.isLoading ? (
          <Loading />
        ) : history.isError ? (
          <LoadError error={history.error} onRetry={() => void history.refetch()} />
        ) : (
          <HistoryPanel entries={toHistoryEntries(history.data ?? [], t)} />
        )}
        </TabPanel>
      </DetailLayout>

      {editing ? (
        <DeviceForm
          device={item}
          csrfToken={me.csrfToken}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            void refresh();
          }}
        />
      ) : null}
    </>
  );
}

/**
 * Khu mở rộng. Rỗng thì KHÔNG render gì cả — không có tiêu đề "Địa chỉ IP" treo lơ lửng,
 * cũng không có dòng "tính năng sẽ có ở epic sau". Người dùng Đợt 1 không cần biết Đợt 2.
 *
 * Dựng bằng BẢNG chứ không phải danh sách `nhãn: giá trị`.
 *
 * Danh sách định nghĩa chỉ đọc xuôi được từng cặp một; khi khu này có nhiều dòng cùng loại —
 * ba secret của một con switch, hai IP của một server — thì mắt phải nhảy qua nhảy lại để so.
 * Bảng xếp cùng loại vào một cột, và đó chính là việc người ta mở trang này ra để làm.
 */
function ExtensionPanels({ panels }: { panels: DevicePanel[] }) {
  if (panels.length === 0) return null;
  return (
    <div className="device-panels">
      {panels.map((panel) => (
        <section key={panel.key} className="card device-panel">
          <h2 className="form-section-title">{panel.title}</h2>
          {panel.items.length === 0 ? (
            <p className="muted">{panel.emptyText ?? "—"}</p>
          ) : (
            <div className="table-wrap">
              <table className="table table-stack">
                <tbody>
                  {panel.items.map((entry, index) => (
                    <tr key={`${panel.key}-${index}`}>
                      {/* `scope="row"` chứ không phải `<td>`: ô đầu là TÊN của dòng, và trình
                          đọc màn hình cần biết điều đó để đọc "Admin web — ••••" chứ không
                          đọc hai ô rời nhau. */}
                      <th scope="row" className="panel-key">
                        {entry.label}
                      </th>
                      <td>
                        {entry.link ? (
                          <Link to={entry.link}>{entry.value}</Link>
                        ) : entry.tone ? (
                          <span className={`badge ${entry.tone}`}>
                            {entry.value}
                          </span>
                        ) : (
                          entry.value
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ))}
    </div>
  );
}


