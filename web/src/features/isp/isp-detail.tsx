import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";
import { ApiError, apiFetch } from "@/lib/api-client";
import { formatDate } from "@/lib/format";
import type { Me } from "@/lib/me";
import { AttachmentPanel } from "@/ui/attachment-panel";
import { HistoryPanel } from "@/ui/history-panel";
import { LoadError, Loading, NotFound } from "@/ui/load-state";
import { CopyButton } from "@/ui/copy-button";
import { BlankFields, DataItemIfSet, DetailHeader } from "@/ui/detail-header";
import {
  DetailLayout,
  DetailSection,
  RailCard,
  RailRow,
  RailRowIfSet,
} from "@/ui/detail-layout";
import { TabPanel, Tabs } from "@/ui/tabs";
import { useTabCounts } from "@/ui/tab-counts";
import { VaultPanel } from "@/ui/vault-panel";
import { IspForm } from "./isp-form";
import { liquidationOf, toIspHistory } from "./isp-history-entries";
import {
  STATUS_KEY,
  STATUS_TONE,
  type IspHistoryRow,
  type IspRow,
} from "./isp-types";
import { PATHS } from "@/lib/routes";

/**
 * Trang chi tiết đường truyền (story 3.3).
 * Tab Giấy tờ dùng lại `AttachmentPanel` chung — file scan hợp đồng gắn thẳng vào đường này.
 */
export function IspDetail({ me }: { me: Me }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { id = "" } = useParams();
  const [tab, setTab] = useState("profile");
  const [editing, setEditing] = useState(false);

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
    return line.error instanceof ApiError && line.error.status === 404 ? (
      <NotFound />
    ) : (
      <LoadError error={line.error} onRetry={() => void line.refetch()} />
    );
  }

  // Mất mạng ⇒ `fetchStatus:'paused'` ⇒ `isLoading` false, `isError` false, `data` undefined:
  // hai nhánh trên đều trượt. Xem chú thích đầy đủ ở `devices/device-detail.tsx` (lỗi F-02).
  if (!line.data) return <Loading />;
  const item = line.data;
  const liquidation =
    item.status === "terminated" ? liquidationOf(history.data ?? []) : null;

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
                  {t("isp.wanIp")} <span className="mono">{item.wanIp}</span>
                  <CopyButton value={item.wanIp} label={t("isp.copyWanIp")} />
                </span>
              </>
            ) : null}
          </>
        }
        actions={
          /* Không có nút Gia hạn: đường truyền không có hạn (Q-04). Thôi dùng thì đổi trạng
             thái sang Thanh lý trong Sửa hồ sơ. */
          <button
            type="button"
            className="btn primary"
            onClick={() => setEditing(true)}
          >
            {t("isp.edit")}
          </button>
        }
      />

      <DetailLayout
        rail={
          <RailCard title={t("detail.identityCard")}>
            {/* HOTLINE đứng DÒNG ĐẦU, và là một link bấm gọi được. Đây là trang mở ra lúc 2 giờ
                sáng khi đứt cáp — thứ cần đầu tiên là số điện thoại, không phải mã hợp đồng. */}
            <RailRow label={t("isp.hotline")} note={item.provider}>
              {item.hotline ? (
                <a className="mono" href={`tel:${item.hotline.replace(/\s/g, "")}`}>
                  {item.hotline}
                </a>
              ) : (
                "—"
              )}
            </RailRow>
            <RailRow
              label={t("isp.status")}
              note={
                liquidation
                  ? t("isp.liquidated", {
                      date: formatDate(liquidation.at),
                      actor: liquidation.actor,
                    })
                  : undefined
              }
            >
              <span className={`badge ${STATUS_TONE[item.status]}`}>
                {t(STATUS_KEY[item.status])}
              </span>
            </RailRow>
            <RailRowIfSet
              label={t("isp.startDate")}
              value={item.startDate ? formatDate(item.startDate) : null}
            />
            <RailRowIfSet label={t("isp.contractNo")} value={item.contractNo} />
            <RailRowIfSet label={t("isp.bandwidth")} value={item.bandwidth} />
            <RailRowIfSet label={t("isp.site")} value={item.siteCode} />
          </RailCard>
        }
      >

      <Tabs
        items={[
          { key: "profile", label: t("isp.tabProfile") },
          /*
            Két sắt cho đường truyền (0036).
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
                <DataItemIfSet label={t("isp.device")} value={item.deviceId}>
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
              <BlankFields
                labels={[
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
          <HistoryPanel entries={toIspHistory(history.data ?? [], t)} />
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
