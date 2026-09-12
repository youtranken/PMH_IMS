import * as RD from '@radix-ui/react-dialog';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useConfirm } from '@/ui/confirm-context';
import { useTranslation } from 'react-i18next';
import type { ReactNode } from 'react';

/**
 * Nơi các popover (DatePicker/TimeField/Combobox/Select) portal VÀO khi mở trong dialog.
 * Radix Dialog dùng react-remove-scroll + body{pointer-events:none} chỉ cho phép tương tác
 * TRONG Content; popover portal ra document.body sẽ bị chặn click LẪN cuộn (bánh xe giờ).
 * Portal vào mount-point này (nằm trong Content) → thuộc vùng cho phép. Ngoài dialog = null → body.
 */
const DialogPortalContext = createContext<HTMLElement | null>(null);
export const useDialogPortal = () => useContext(DialogPortalContext);

/**
 * Khung modal dùng chung trên Radix Dialog — thay các khối .modal-backdrop/.sheet
 * copy tay (mỗi dialog một bản). Radix lo focus trap, scroll-lock, Esc, trả focus,
 * aria-modal + aria-labelledby (qua DialogTitle) — thứ 8 modal cũ đều thiếu.
 *
 * Giữ NGUYÊN class .sheet cũ để giao diện y hệt: Overlay = nền mờ (.modal-backdrop),
 * .dialog-viewport canh giữa bằng grid (như .modal-backdrop cũ từng bọc .sheet) nên
 * .sheet vẫn dùng animation modalIn (transform) mà không đụng nhau.
 */
export const DialogTitle = RD.Title;
export const DialogDescription = RD.Description;
export const DialogClose = RD.Close;

export function Dialog({
  open,
  onOpenChange,
  dismissible = true,
  requireExplicitClose = false,
  guardUnsaved = false,
  className = 'sheet',
  overlayClassName = 'modal-backdrop',
  maxWidth,
  title,
  footer,
  closeLabel,
  children,
}: {
  /**
   * Tiêu đề hộp. Truyền vào là `Dialog` TỰ DỰNG khung ba phần (header có nền riêng + thân
   * cuộn được + chân dính đáy) — đúng thứ CSS `.sheet-*` đã có sẵn từ đầu nhưng gần như
   * không nơi nào dùng, khiến tiêu đề dính mép trên và ô nhập chạm mép trái.
   *
   * Không truyền → giữ nguyên hành vi cũ (children đổ thẳng vào `.sheet`), để những hộp có
   * bố cục riêng không bị ép khuôn.
   */
  title?: ReactNode;
  /** Hàng nút chân hộp. Tự đẩy sang phải, tự tách khỏi phần thân bằng viền trên. */
  footer?: ReactNode;
  /** Nhãn trợ năng cho nút ✕ (mặc định "Đóng"). */
  closeLabel?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // false = chặn đóng bằng Esc/click-ngoài (vd đang busy) — nút ✕ tự disable, VÀ cả chân hộp
  // thành trơ (xem chú thích ở `.sheet-footer` bên dưới).
  dismissible?: boolean;
  /**
   * true = đóng phải CÓ CHỦ Ý: chặn Esc, chặn click-nền, tắt nút ✕ — nhưng chân hộp VẪN SỐNG.
   *
   * Tách khỏi `dismissible` vì hai nhu cầu khác hẳn nhau đang bị gộp làm một:
   *   · `dismissible={false}` = "đang có lượt ghi BAY, đừng đóng bằng bất cứ gì" — nên nó nuốt
   *     luôn click ở chân hộp. Hộp tự mở lại khi ghi xong, người dùng không kẹt.
   *   · `requireExplicitClose` = "đóng nhầm là MẤT DỮ LIỆU, nên phải bấm nút" — chân hộp bắt
   *     buộc phải bấm được, nếu không hộp thành KHÔNG CÓ LỐI RA.
   *
   * Dùng nhầm cái đầu cho vế thứ hai là dựng một hộp không đóng được bằng gì cả. Bài
   * `accounts.spec.ts` bắt đúng lỗi đó ngày 12/09, khi hộp mật khẩu tạm vá bằng nhầm prop.
   */
  requireExplicitClose?: boolean;
  /**
   * true = Esc / bấm nền / ✕ chỉ đóng khi KHÔNG có gì đang gõ dở; có thì hỏi lại.
   *
   * ===== VẤN ĐỀ =====
   *
   * `dismissible={!save.isPending}` chỉ chặn lúc lượt ghi ĐANG BAY. Trước khi bấm Lưu thì Esc,
   * bấm nền hay ✕ đóng thẳng và xoá sạch — 10 form trong repo đang như vậy, nặng nhất là
   * `device-form` (15 ô) và `service-account-form` (có cả ô Mật khẩu). Không một chữ hỏi lại.
   *
   * ===== VÌ SAO ĐO Ở DOM, KHÔNG BẮT MỖI FORM TỰ KHAI "DIRTY" =====
   *
   * Bắt 10 form cùng dựng một đối tượng `values` rồi so với ảnh chụp ban đầu là 10 chỗ phải
   * nhớ cập nhật khi thêm ô mới — và chỗ thứ mười một sẽ quên, đúng cách 17/18 hộp đã quên
   * `disabled` nút Hủy (xem chú thích ở `.sheet-footer`). Ở đây thì một lần đọc
   * `input/textarea/select` trong thân hộp là phủ mọi form, kể cả form viết sau.
   *
   * GIỚI HẠN PHẢI BIẾT: ô chọn ngày, combobox và `Select` của repo render ra `<button>`, không
   * phải `<input>`, nên đổi RIÊNG chúng thì cửa này không thấy. Chấp nhận: nó không bao giờ
   * báo động giả (chỉ hỏi khi có thay đổi thật), và vẫn bắt đúng cảnh hay gặp nhất — gõ tay
   * một lúc rồi lỡ Esc. Thà bắt được phần lớn còn hơn bắt 0% như hiện nay.
   *
   * KHÔNG canh nút "Hủy" ở chân hộp: bấm Hủy là CỐ Ý bỏ, hỏi lại ở đó chỉ là thêm một cú bấm
   * cho việc người ta vừa nói rõ là muốn làm. Cửa này dành cho ba lối đóng TÌNH CỜ.
   *
   * Ảnh chụp gốc lấy sau lượt render đầu, nên form nào nạp dữ liệu BÊN TRONG hộp (thay vì nhận
   * qua prop) sẽ trông như vừa bị sửa lúc dữ liệu về. 10 form đang bật cờ này đều khởi tạo
   * `useState` từ prop, nên không dính; đó cũng là lý do prop này phải TỰ KHAI, không bật sẵn.
   */
  guardUnsaved?: boolean;
  // Class hộp nội dung: 'sheet' (header/body/footer) hoặc 'modal' (hộp gọn), + biến thể.
  className?: string;
  // Class nền mờ. Dialog LỒNG (vd cascade trên form) dùng 'modal-backdrop bare' để
  // không dim đôi (form đã dim trang rồi).
  overlayClassName?: string;
  maxWidth?: number;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const askConfirm = useConfirm();
  const [portalEl, setPortalEl] = useState<HTMLDivElement | null>(null);

  /*
   * ===== CANH DỮ LIỆU CHƯA LƯU (12/09) — xem chú thích của prop `guardUnsaved` =====
   *
   * `bodyRef` trỏ vào thân hộp. Chữ ký là danh sách cặp (tên ô, giá trị) của mọi ô nhập
   * NATIVE bên trong, đem `JSON.stringify`.
   *
   * Dùng JSON chứ không nối chuỗi bằng một dấu phân cách tự chọn: mọi dấu phân cách đều có
   * thể xuất hiện TRONG giá trị người dùng gõ, và lúc đó hai form khác nhau băm ra cùng một
   * chữ ký — cửa canh im lặng bỏ sót. JSON tự lo việc thoát ký tự, nên không có cảnh đó.
   */
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const banDau = useRef<string | null>(null);

  const chuKyCacO = useCallback((): string => {
    const root = bodyRef.current;
    if (!root) return '';
    return JSON.stringify(
      // `Array.from` chứ không phải spread: `tsconfig.app.json` nhắm bản ES cũ hơn nên
      // `NodeListOf` chưa có `[Symbol.iterator]`.
      Array.from(root.querySelectorAll('input, textarea, select')).map((el) => {
        const o = el as HTMLInputElement;
        const gia = o.type === 'checkbox' || o.type === 'radio' ? String(o.checked) : o.value;
        return [o.name || o.id || '', gia];
      }),
    );
  }, []);

  useEffect(() => {
    /*
     * CHỜ `portalEl` rồi mới chụp — đây là chỗ bản đầu sai và bài kiểm bắt được ngay.
     *
     * `RD.Portal` dựng thùng chứa của nó trong một layout effect, nên ở lượt effect ĐẦU của
     * component này thân hộp CHƯA nằm trong tài liệu: `bodyRef.current` còn `null`, chữ ký
     * chụp được là chuỗi rỗng. Tới lúc người dùng bấm Esc thì chữ ký thật khác chuỗi rỗng, và
     * MỌI hộp đều bị coi là "đang gõ dở" — cửa canh hỏi lại cả khi người ta chưa gõ gì.
     *
     * `portalEl` do `<div ref={setPortalEl} />` BÊN TRONG `RD.Content` đặt, nên nó khác `null`
     * đúng vào lúc thân hộp đã mount. Không cần thêm cờ nào khác.
     */
    if (!guardUnsaved || !open || !portalEl) return;
    banDau.current = chuKyCacO();
  }, [guardUnsaved, open, portalEl, chuKyCacO]);

  /** Đang chờ người dùng trả lời câu "bỏ hay ở lại" — đừng hỏi chồng lên nhau. */
  const dangHoi = useRef(false);

  const thuDong = useCallback(() => {
    if (banDau.current === null || chuKyCacO() === banDau.current) {
      onOpenChange(false);
      return;
    }
    if (dangHoi.current) return;
    dangHoi.current = true;
    void (async () => {
      const ok = await askConfirm({
        title: t('app.discardTitle'),
        message: t('app.discardMessage'),
        confirmLabel: t('app.discardConfirm'),
        cancelLabel: t('app.discardCancel'),
        danger: true,
      });
      dangHoi.current = false;
      if (ok) onOpenChange(false);
    })();
  }, [askConfirm, chuKyCacO, onOpenChange, t]);

  /*
   * ===== ESC LÚC MENU Ô CHỌN ĐANG MỞ CHỈ ĐƯỢC ĐÓNG MENU (10/09) =====
   *
   * Mở form, bấm ô chọn, đổi ý, bấm Esc — CẢ HỘP đóng và mất trắng những gì vừa gõ. Bài kiểm
   * "đi khắp giao diện" bắt được, và nó không phải lỗi của một màn: mọi ô chọn trong repo đều
   * dựng từ `ui/select.tsx`, mọi hộp đều dựng từ file này.
   *
   * Ý định đúng ĐÃ có trong mã: `select.tsx` bắt Escape rồi `e.stopPropagation()`. Nó không
   * đạt được vì Radix nghe `keydown` ở `document` với `capture: true`
   * (`react-dismissable-layer/dist/index.mjs:105`) — tầng bắt chạy XONG trước khi sự kiện kịp
   * bò tới handler React của ô chọn. Không handler nào của con chặn nổi một listener đăng ký
   * ở tài liệu, pha bắt. Đó là lý do một dòng `stopPropagation` trông rất hợp lý lại vô hiệu.
   *
   * Chặn phải đặt ở ĐÂY, tại `onEscapeKeyDown` — chỗ duy nhất Radix hỏi ý trước khi đóng.
   * `preventDefault()` làm Radix bỏ lượt đóng, còn sự kiện vẫn bò tiếp nên ô chọn vẫn tự đóng
   * menu của nó. Mỗi bên đóng đúng phần của mình.
   *
   * LÀM SAO BIẾT "CÓ POPOVER ĐANG MỞ": cả sáu thứ có thể mở đè lên hộp — `select`, `combobox`,
   * `date-picker`, `time-field`, `row-actions` — đều `createPortal` vào ĐÚNG điểm neo dưới
   * đây (`portal ?? document.body`). Nên "điểm neo có con" chính là "đang có popover mở".
   * Không cần sổ đăng ký, không cần context thứ hai, và không thể quên cập nhật.
   */
  const onEscapeKeyDown = (event: KeyboardEvent) => {
    if (!dismissible || requireExplicitClose) {
      event.preventDefault();
      return;
    }
    if (portalEl && portalEl.childElementCount > 0) {
      event.preventDefault();
      return;
    }
    if (!guardUnsaved) return;
    // Radix tự đóng nếu ta không cản; cản rồi tự quyết sau khi hỏi xong.
    event.preventDefault();
    thuDong();
  };

  /*
   * Bấm ra ngoài hộp: Radix bắn CẢ HAI sự kiện dưới đây, nên cả hai phải cản, nhưng chỉ MỘT
   * được phép mở câu hỏi — nếu không sẽ hỏi hai lần cho một cú bấm.
   */
  const onPointerDownOutside = (event: Event) => {
    if (!dismissible || requireExplicitClose) {
      event.preventDefault();
      return;
    }
    if (!guardUnsaved) return;
    event.preventDefault();
    thuDong();
  };

  const onInteractOutside = (event: Event) => {
    if (!dismissible || requireExplicitClose || guardUnsaved) event.preventDefault();
  };

  /*
   * ===== TRẢ TIÊU ĐIỂM VỀ NÚT ĐÃ MỞ HỘP (09/09) =====
   *
   * Chú thích ở đầu file này từng hứa "Radix lo focus trap, scroll-lock, Esc, TRẢ FOCUS".
   * Hai phần ba lời hứa đó đúng. Phần trả focus thì KHÔNG, và bài kiểm bàn phím đầu tiên của
   * bộ E2E đã bắt được: gõ Tab tới nút "Thêm thiết bị", Enter mở hộp, Esc đóng — tiêu điểm
   * rơi về `<body>`. Người dùng bàn phím bị ném về đầu trang sau MỖI lần đóng hộp, và phải
   * gõ lại hơn hai chục lượt Tab để về chỗ cũ.
   *
   * VÌ SAO RADIX KHÔNG LÀM ĐƯỢC Ở ĐÂY: nó trả focus trong bước dọn của `FocusScope`, bước ấy
   * chỉ chạy khi `open` LẬT từ true sang false trong lúc `RD.Root` còn sống. Nhưng gần như
   * mọi call site trong repo viết `{dangMo ? <XForm onClose={…}/> : null}` với `<Dialog open>`
   * cứng — nghĩa là đóng hộp = THÁO CẢ GỐC ra khỏi cây React. Radix không còn cơ hội chạy
   * bước nào cả. Sửa từng call site là sửa hàng chục chỗ và chỗ thứ mười một sẽ lại quên;
   * sửa ở đây là sửa cho tất cả (AD-15).
   *
   * GHI LẠI TRONG LÚC RENDER, không phải trong effect: layout effect của con (`RD.Content`)
   * chạy TRƯỚC của cha, nên tới lượt cha thì tiêu điểm đã nằm trong hộp rồi — ghi lúc đó là
   * ghi nhầm chính cái hộp.
   */
  const opener = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  if (open && !wasOpen.current) {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }
  wasOpen.current = open;

  const returnFocus = useCallback(() => {
    const el = opener.current;
    opener.current = null;
    if (!el || !el.isConnected) return;
    /*
     * CHỈ nhặt tiêu điểm lên khi nó đã RƠI. Nếu màn vừa chủ động đưa tiêu điểm đi đâu đó
     * (mở tiếp hộp thứ hai, nhảy tới ô vừa tạo), cướp lại còn tệ hơn là không làm gì.
     */
    const now = document.activeElement;
    if (now && now !== document.body) return;
    el.focus();
  }, []);

  // Hai đường đóng hộp: `open` lật về false, hoặc cả component bị tháo. Cả hai đều phải trả.
  useEffect(() => {
    if (!open) returnFocus();
  }, [open, returnFocus]);
  useEffect(() => () => returnFocus(), [returnFocus]);

  return (
    <RD.Root open={open} onOpenChange={onOpenChange}>
      <RD.Portal>
        <RD.Overlay className={overlayClassName} />
        <div className="dialog-viewport">
          <RD.Content
            className={className}
            style={maxWidth ? { maxWidth } : undefined}
            onEscapeKeyDown={onEscapeKeyDown}
            onPointerDownOutside={onPointerDownOutside}
            onInteractOutside={onInteractOutside}
          >
            <DialogPortalContext.Provider value={portalEl}>
              {title === undefined ? (
                children
              ) : (
                <>
                  <div className="sheet-header">
                    <RD.Title className="sheet-title">{title}</RD.Title>
                    <span className="spacer" />
                    {/*
                      `RD.Close` đóng hộp NGAY, không hỏi ai — nên khi đang canh dữ liệu chưa
                      lưu thì phải là nút thường đi qua `thuDong()`. Hai nhánh cùng class, cùng
                      nhãn trợ năng: người dùng không thấy khác gì.
                    */}
                    {guardUnsaved ? (
                      <button
                        type="button"
                        className="sheet-close"
                        aria-label={closeLabel ?? t('common.closeDialog')}
                        disabled={!dismissible || requireExplicitClose}
                        onClick={thuDong}
                      >
                        ✕
                      </button>
                    ) : (
                      <RD.Close asChild>
                        <button
                          type="button"
                          className="sheet-close"
                          /* KHÔNG dùng chung nhãn "Đóng" với nút ở chân hộp: hai nút cùng tên trong một
                             hộp thì trình đọc màn hình đọc "Đóng, nút" hai lần, không phân biệt được. */
                          aria-label={closeLabel ?? t('common.closeDialog')}
                          disabled={!dismissible || requireExplicitClose}
                        >
                          ✕
                        </button>
                      </RD.Close>
                    )}
                  </div>
                  <div className="sheet-body" ref={bodyRef}>
                    {children}
                  </div>
                  {footer ? (
                    /*
                     * ===== CỬA THỨ TƯ CỦA `dismissible` (10/09) =====
                     *
                     * Prop `dismissible` sinh ra để chặn đúng một cảnh: lượt ghi ĐANG BAY, hộp
                     * biến mất, POST vẫn hoàn tất — dữ liệu vào sổ nhưng `onSaved()` không
                     * chạy, nên không toast, không refresh, và người vận hành tin là mình đã
                     * hủy. Nó bịt Esc, bịt click-nền, bịt nút ✕.
                     *
                     * Nút HỦY ở chân hộp thì không: nó là `children` do nơi gọi truyền vào.
                     * Kiểm lại 18 hộp trong repo thì đúng 1 (`import-dialog`) nhớ tự
                     * `disabled={busy}` — 17 hộp còn lại để cửa mở, và bấm Hủy lúc đang chờ
                     * rơi vào ĐÚNG cảnh trên, chỉ khác đường vào.
                     *
                     * "Đang bận thì chân hộp không ăn" là MỘT khái niệm; bắt 18 nơi gọi cùng
                     * nhớ nó là đúng cách 17/18 đã quên (AD-15). Chặn ở pha BẮT nên click
                     * không bò tới được handler của nút, dù nút đó là gì.
                     *
                     * Nơi gọi VẪN nên `disabled` nút Hủy của mình — hàng rào này chặn hậu quả,
                     * không thay được việc cho người dùng THẤY nút đã mờ đi.
                     */
                    <div
                      className="sheet-footer"
                      data-testid="dialog-footer"
                      onClickCapture={
                        dismissible
                          ? undefined
                          : (event) => {
                              event.preventDefault();
                              event.stopPropagation();
                            }
                      }
                    >
                      <span className="spacer" />
                      {footer}
                    </div>
                  ) : null}
                </>
              )}
            </DialogPortalContext.Provider>
            {/* Mount-point cho popover portal vào (trong Content → tránh RRS chặn cuộn/click). */}
            <div ref={setPortalEl} />
          </RD.Content>
        </div>
      </RD.Portal>
    </RD.Root>
  );
}
