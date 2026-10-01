import { formatPhone } from '@/lib/phone-format';
import { PhoneLink } from '@/ui/phone-link';
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { apiFetch } from "@/lib/api-client";
import { formatDate } from "@/lib/format";
import type { Me } from "@/lib/me";
import { AttachmentPanel } from "@/ui/attachment-panel";
import { HistoryPanel } from "@/ui/history-panel";
import { AuditLogLink } from "@/ui/audit-log-link";
import { DetailLoadFailed, LoadError, Loading } from "@/ui/load-state";
import { CopyButton } from "@/ui/copy-button";
import { BlankFields, DataItemIfSet, DetailHeader } from "@/ui/detail-header";
import {
  DetailLayout,
  DetailSection,
  RailCard,
  RailRow,
  RailRowIfSet,
} from "@/ui/detail-layout";
import { TabPanel, Tabs, initialTab } from "@/ui/tabs";
import { useTabCounts } from "@/ui/tab-counts";
import { VaultPanel } from "@/ui/vault-panel";
import { IspForm } from "./isp-form";
import { liquidationOf, toIspHistory } from "./isp-history-entries";
import {
  ACTION_KEY,
  STATUS_KEY,
  STATUS_TONE,
  type IspHistoryRow,
  type IspRow,
  type IspStatus,
} from "./isp-types";
import { errorMessage } from "@/lib/api";
import { RowActions } from "@/ui/row-actions";
import { useConfirm } from "@/ui/confirm-provider";
import { useToast } from "@/ui/toast";
import { useIsNarrow } from "@/ui/use-narrow";
import { PATHS } from "@/lib/routes";

/**
 * Trang chi tiết đường truyền.
 * Tab Giấy tờ dùng lại `AttachmentPanel` chung — file scan hợp đồng gắn thẳng vào đường này.
 */
export function IspDetail({ me }: { me: Me }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { id = "" } = useParams();
  const [params] = useSearchParams();
  // `?tab=vault` từ thư "đã được duyệt": người xin mở thẳng két, không phải tìm tab.
  const [tab, setTab] = useState(() =>
    initialTab(params.get("tab"), ["profile", "vault", "attachments", "history"]),
  );
  const [editing, setEditing] = useState(false);
  const narrow = useIsNarrow();
  const askConfirm = useConfirm();
  const toast = useToast();

  /* Trước mọi nhánh `return` sớm bên dưới: đây là hook, đặt sau `if (isLoading) return` thì
     số hook giữa hai lượt render lệch nhau. */
  const counts = useTabCounts("isp", id, me);

  const line = useQuery({
    queryKey: ["isp", id],
    queryFn: () => apiFetch<IspRow>(`/api/v1/isp-lines/${id}`),
    retry: false,
  });

  const history = useQuery({
    queryKey: ["isp", id, "history"],
    queryFn: () => apiFetch<IspHistoryRow[]>(`/api/v1/isp-lines/${id}/history`),
    // Line đã thanh lý thì thẻ định danh phải nói ai thanh lý, lúc nào (Q-04) — thông tin đó
    // chỉ nằm trong sổ lịch sử, nên hỏi sổ ngay cả khi chưa mở tab.
    enabled: tab === "history" || line.data?.status === "terminated",
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["isp"] });

  if (line.isLoading) return <Loading />;
  if (line.isError) {
    // Giữ đường lùi về danh sách, và tách "hồ sơ không còn" (404) khỏi "máy chủ lỗi".
    return (
      <DetailLoadFailed
        error={line.error}
        onRetry={() => void line.refetch()}
        backTo={PATHS.ispLines}
        backLabel={t("nav.isp")}
      />
    );
  }

  // Mất mạng ⇒ `fetchStatus:'paused'` ⇒ `isLoading` false, `isError` false, `data` undefined:
  // hai nhánh trên đều trượt. Xem chú thích đầy đủ ở `devices/device-detail.tsx`.
  if (!line.data) return <Loading />;
  const item = line.data;
  const terminated = item.status === "terminated";
  const liquidation = terminated ? liquidationOf(history.data ?? []) : null;

  /**
   * Đổi trạng thái từ menu ⋯ — luôn hỏi lại. Thanh lý nhắc hai việc KHÔNG tự xảy ra: huỷ mật
   * khẩu PPPoE/modem trong két, và gỡ đường khỏi Draytek đang cắm.
   */
  const changeStatus = async (next: IspStatus) => {
    const vaultNote =
      counts.secrets && counts.secrets > 0 ? t("isp.terminateVault", { count: counts.secrets }) : "";
    const deviceNote = item.deviceCode ? t("isp.terminateDevice", { device: item.deviceCode }) : "";
    const ok = await askConfirm({
      title: t(`isp.statusTitle_${next}`, { code: item.code }),
      message: [t(`isp.statusMessage_${next}`), vaultNote, deviceNote].filter(Boolean).join(" "),
      confirmLabel: t(ACTION_KEY[next]),
      danger: next === "terminated",
    });
    if (!ok) return;
    try {
      await apiFetch(`/api/v1/isp-lines/${item.id}`, {
        method: "PATCH",
        csrfToken: me.csrfToken,
        body: JSON.stringify({ status: next }),
      });
      toast({ message: t("isp.saved") });
      void refresh();
    } catch (error) {
      toast({ message: errorMessage(error), tone: "error" });
    }
  };

  return (
    <>
      <DetailHeader
        crumbs={[
          { label: t("nav.isp"), to: PATHS.ispLines },
          { label: item.provider },
          { label: item.code },
        ]}
        code={item.code}
        name={item.provider}
        subline={
          <>
            {item.bandwidth ? <span>{item.bandwidth}</span> : null}
            {item.siteCode ? (
              <>
                <span aria-hidden="true">·</span>
                <span>{item.siteCode}</span>
              </>
            ) : null}
            {item.wanIp ? (
              <>
                <span aria-hidden="true">·</span>
                <span>
                  {t("isp.wanIp")} <span className="mono">{item.wanIp}</span>{" "}
                  <CopyButton value={item.wanIp} label={t("isp.copyWanIp")} inline />
                </span>
              </>
            ) : null}
          </>
        }
        actions={
          /*
           * Không có nút Gia hạn: đường truyền không có hạn (Q-04). Đổi trạng thái (Tạm ngưng,
           * Thanh lý…, Dùng lại) đi menu ⋯ và luôn hỏi lại. Điện thoại: "Sửa hồ sơ" cũng vào
           * menu — nút gradient to chiếm đầu một màn ĐỌC là đẩy thông tin xuống dưới mép.
           * Đã thanh lý thì Sửa hạ xuống nút thường: nó không còn là việc chính của trang.
           */
          <>
            {narrow ? null : (
              <button
                type="button"
                className={terminated ? "btn" : "btn primary"}
                onClick={() => setEditing(true)}
              >
                {t("isp.edit")}
              </button>
            )}
            <RowActions
              label={t("common.actionsOf", { subject: item.code })}
              items={[
                ...(narrow
                  ? [{ key: "edit", label: t("isp.edit"), onSelect: () => setEditing(true) }]
                  : []),
                ...(item.status === "active"
                  ? [
                      {
                        key: "suspend",
                        label: t("isp.suspendMenu"),
                        onSelect: () => void changeStatus("suspended"),
                      },
                    ]
                  : [
                      {
                        key: "reactivate",
                        label: t("isp.reactivateMenu"),
                        onSelect: () => void changeStatus("active"),
                      },
                    ]),
                ...(terminated
                  ? []
                  : [
                      {
                        key: "terminate",
                        label: t("isp.terminateMenu"),
                        onSelect: () => void changeStatus("terminated"),
                        danger: true,
                      },
                    ]),
              ]}
            />
          </>
        }
      />

      {/* Đường đã thanh lý phải TRÔNG như đã thanh lý — không chỉ một huy hiệu xám nhỏ trong
          thẻ bên phải. Chưa có mốc trong sổ lịch sử (dữ liệu cũ) thì nói thẳng là chưa rõ. */}
      {terminated ? (
        <p className="alert warn" role="note">
          {liquidation
            ? t("isp.liquidated", {
                date: formatDate(liquidation.at),
                actor: liquidation.actor,
              })
            : t("isp.liquidatedUnknown")}
        </p>
      ) : null}

      <DetailLayout
        rail={
          <>
            {/*
              "KHI MẤT MẠNG" đứng ĐẦU cột phải (và đầu trang ở điện thoại): trang này hay được
              mở lúc 2 giờ sáng khi đứt cáp — thứ cần là một nút gọi to, số hợp đồng để đọc cho
              tổng đài, IP WAN, và con Draytek nào đang cắm đường này. Đã thanh lý thì thẻ này
              không còn việc gì để làm.
            */}
            {terminated ? null : (
              <RailCard title={t("isp.incidentCard")}>
                {item.hotline ? (
                  <PhoneLink className="btn primary isp-call" value={item.hotline}>
                    {t("isp.callHotline", { hotline: formatPhone(item.hotline) })}
                  </PhoneLink>
                ) : (
                  <RailRow label={t("isp.hotline")}>—</RailRow>
                )}
                {item.contractNo ? (
                  /* Không kèm tên nhà mạng: nó đã là tên trang và breadcrumb. */
                  <RailRow label={t("isp.contractNo")}>
                    <span className="mono">{item.contractNo}</span>{" "}
                    <CopyButton
                      value={item.contractNo}
                      label={t("isp.copyContractNo")}
                      inline
                    />
                  </RailRow>
                ) : null}
                {/* IP WAN không lặp ở đây: nó đứng ngay dòng định danh dưới tiêu đề, có nút chép. */}
                {item.deviceId ? (
                  <RailRow label={t("isp.device")} note={item.deviceName ?? undefined}>
                    <Link className="mono" to={PATHS.device(item.deviceId)}>
                      {item.deviceCode}
                    </Link>
                    {/* Rule NAT đang mở trên chính con Draytek này — luồng "ghi line → gắn
                        Draytek → mở port" không bắt đi tìm qua ba màn. */}
                    <Link className="rail-sublink" to={PATHS.natOf(item.deviceId)}>
                      {t("isp.natOnDevice")}
                    </Link>
                  </RailRow>
                ) : null}
                {item.deviceId ? <EdgeFacts deviceId={item.deviceId} /> : null}
              </RailCard>
            )}
            {/* Băng thông và site ĐÃ ở dòng định danh dưới tiêu đề — không lặp ở đây. */}
            <RailCard title={t("detail.identityCard")}>
              <RailRow label={t("isp.status")}>
                <span className={`badge ${STATUS_TONE[item.status]}`}>
                  {t(STATUS_KEY[item.status])}
                </span>
              </RailRow>
              <RailRowIfSet
                label={t("isp.startDate")}
                value={item.startDate ? formatDate(item.startDate) : null}
              />
              {/* Đã thanh lý: số hợp đồng vẫn cần tra (đối chiếu hoá đơn cuối) — thẻ sự cố đã
                  ẩn nên nó sang đây. */}
              {terminated ? (
                <RailRowIfSet label={t("isp.contractNo")} value={item.contractNo} />
              ) : null}
            </RailCard>
          </>
        }
      >

      <Tabs
        items={[
          { key: "profile", label: t("isp.tabProfile") },
          /*
            Két sắt cho đường truyền.
            Mật khẩu PPPoE và tài khoản quản trị modem nhà mạng trước đây không có chỗ đứng —
            `file.owner_type` đã nhận `isp` từ lâu mà `secret.owner_type` thì chưa, nên hợp
            đồng PDF đính vào được còn mật khẩu thì chảy vào ô Ghi chú, chỗ không mã hóa.
          */
          { key: "vault", label: t("vault.tab"), count: counts.secrets },
          {
            key: "attachments",
            label: t("isp.tabAttachments"),
            count: counts.files,
          },
          { key: "history", label: t("isp.tabHistory") },
        ]}
        value={tab}
        onChange={setTab}
        ariaLabel={t("isp.title")}
      />

      <TabPanel tabKey={tab}>
        {tab === "profile" ? (
          <>
            {/* Nhà mạng · băng thông · IP tĩnh ĐÃ ở dòng định danh; hotline · trạng thái ·
                hợp đồng · số hợp đồng · site ĐÃ ở thẻ định danh bên phải. Lưới chỉ còn phần
                chưa nói ở đâu, và ô nào trống thì KHÔNG vẽ. */}
            {/* Khu "Hồ sơ" có thẻ + tiêu đề như mọi khu khác — xem chú thích dài ở
                `ui/detail-layout.tsx`, chỗ khai `DetailSection`. KHÔNG `compact`: khu này đứng
                một mình trong cột chính, thứ để mắt so là thẻ định danh bên phải. */}
            <DetailSection title={t("detail.profileSection")}>
              <dl className="data-grid">
                {/* Đường còn dùng thì thiết bị đầu cuối đã đứng ở thẻ "Khi mất mạng" bên
                    phải; chỉ khi thanh lý (thẻ đó ẩn) nó mới cần chỗ ở lưới này. */}
                <DataItemIfSet label={t("isp.device")} value={terminated ? item.deviceId : null}>
                  {/* `?? ''` chứ KHÔNG `!`: JSX dựng `children` TRƯỚC khi `DataItemIfSet`
                      quyết định `return null`, nên dòng này CHẠY THẬT cả khi `deviceId` rỗng
                      — `!` ở đây là một lời khẳng định sai ở đúng nhánh nó khẳng định. Link
                      không được render nên đường dẫn rỗng vô hại. */}
                  <Link className="mono" to={PATHS.device(item.deviceId ?? '')}>
                    {item.deviceCode}
                  </Link>
                </DataItemIfSet>
                <DataItemIfSet label={t("isp.note")} value={item.note} />
              </dl>
              {/* Đường đã thanh lý thì thôi nhắc "Chưa khai" — không ai điền tiếp cho một line
                  đã chết. */}
              <BlankFields
                labels={terminated ? [] : [
                  item.bandwidth ? null : t("isp.bandwidth"),
                  item.wanIp ? null : t("isp.wanIp"),
                  item.hotline ? null : t("isp.hotline"),
                  item.siteCode ? null : t("isp.site"),
                  item.deviceId ? null : t("isp.device"),
                  item.note ? null : t("isp.note"),
                ].filter((label): label is string => label !== null)}
              />
            </DetailSection>
          </>
        ) : tab === "vault" ? (
          <VaultPanel
            ownerType="isp"
            ownerId={item.id}
            ownerLabel={item.code}
            me={me}
            /* Ghi vào két vẫn chỉ SA/Admin — API chặn, UI đừng bày nút ra để bấm rồi 403. */
            canEdit={me.role === "sa" || me.role === "admin"}
          />
        ) : tab === "attachments" ? (
          <AttachmentPanel
            ownerType="isp"
            ownerId={item.id}
            csrfToken={me.csrfToken}
          />
        ) : history.isLoading ? (
          <Loading />
        ) : history.isError ? (
          <LoadError error={history.error} onRetry={() => void history.refetch()} />
        ) : (
          <>
            <AuditLogLink role={me.role} objectType="isp_line" objectId={item.id} />
            <HistoryPanel entries={toIspHistory(history.data ?? [], t)} />
          </>
        )}
      </TabPanel>
      </DetailLayout>

      {editing ? (
        <IspForm
          row={item}
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
 * Model và IP LAN của thiết bị biên, ngay trong thẻ "Khi mất mạng": đứt cáp thì việc kế tiếp
 * là vào trang quản trị Draytek — phải biết địa chỉ mà không bấm sang trang khác. Đọc qua
 * `devices` và `ipam` (AD-2); hỏng thì thẻ chỉ thiếu hai dòng này.
 */
function EdgeFacts({ deviceId }: { deviceId: string }) {
  const { t } = useTranslation();
  const device = useQuery({
    queryKey: ["devices", deviceId],
    queryFn: () => apiFetch<{ model: string | null }>(`/api/v1/devices/${deviceId}`),
  });
  const ips = useQuery({
    queryKey: ["ipam", "devices", "addresses", [deviceId]],
    queryFn: () =>
      apiFetch<Record<string, string[]>>(`/api/v1/ipam/devices/addresses?deviceIds=${deviceId}`),
  });
  const lan = ips.data?.[deviceId] ?? [];
  return (
    <>
      <RailRowIfSet label={t("isp.edgeModel")} value={device.data?.model ?? null} />
      {lan.length > 0 ? (
        <RailRow label={t("isp.edgeLanIp")}>
          {lan.map((ip) => (
            <span key={ip} className="subline-item">
              <span className="mono">{ip}</span>{" "}
              <CopyButton value={ip} label={t("devices.copyIp")} inline />
            </span>
          ))}
        </RailRow>
      ) : null}
    </>
  );
}
