import * as RD from '@radix-ui/react-dialog';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useConfirm } from '@/ui/confirm-context';
import { useTranslation } from 'react-i18next';
import type { ReactNode } from 'react';

/**
 * Nơi các popover (DatePicker/Combobox/Select/RowActions) portal VÀO khi mở trong dialog.
 * Radix Dialog dùng react-remove-scroll + body{pointer-events:none} chỉ cho phép tương tác
 * TRONG Content; popover portal ra document.body sẽ bị chặn click LẪN cuộn (bánh xe giờ).
 * Portal vào mount-point này (nằm trong Content) → thuộc vùng cho phép. Ngoài dialog = null → body.
 */
/**
 * Đếm ĐỘ SÂU hộp thoại đang mở, để hộp LỒNG không phủ mờ chồng lên hộp cha.
 *
 * `overlays.css` có sẵn `.modal-backdrop.bare` (trong suốt), nhưng bắt từng nơi gọi tự truyền
 * `overlayClassName` thì không nơi nào nhớ. Ở Két sắt, lồng hộp là đường đi CHÍNH (mở két → gõ
 * mã 6 số → hiện giá trị), nên không có bộ đếm này thì tới hộp thứ ba nền đã phủ ba lớp,
 * khoảng 0,69 độ đen, blur chồng blur.
 *
 * Để hộp TỰ BIẾT thay vì bắt từng nơi gọi tự khai: nơi gọi không phải lúc nào cũng biết mình
 * đang nằm trong một hộp khác — `VaultPanel` dùng ở cả trang chi tiết lẫn trong popup của
 * `/vault`, cùng một đoạn mã, hai độ sâu khác nhau.
 */
const DialogDepthContext = createContext(0);

/**
 * SỔ HỘP ĐANG MỞ — nửa thứ hai của cùng một câu hỏi, cho những hộp KHÔNG nằm trong cây của
 * hộp cha.
 *
 * `DialogDepthContext` đo vị trí trong cây React, nên nó chỉ thấy hộp lồng theo đúng nghĩa
 * đen: hộp dựng bên trong `sheet-body` của hộp khác (đường của Két sắt). Nó MÙ với hai cảnh
 * còn lại, và cảnh đầu mới là cảnh hay gặp nhất:
 *
 *   1. `ConfirmProvider` dựng `ConfirmDialog` ở GỐC app, là anh em của `children` chứ không
 *      nằm trong hộp nào — nên nó luôn đọc ra `depth = 0`. Mà `guardUnsaved` của chính file
 *      này gọi `askConfirm` (xem `tryClose`), nghĩa là mọi hộp có canh dữ liệu chưa lưu khi
 *      bấm Esc đều đẻ ra một lớp nền mờ THỨ HAI đè lên lớp của chính nó (đo được: hai lớp
 *      `rgba(20,26,20,.44)` chồng nhau, không lớp nào `bare`).
 *   2. Hai hộp anh em trong cùng một component (`{a && <Dialog/>}{b && <Dialog/>}`) cũng đều
 *      `depth = 0`.
 *
 * Ghi tên và đọc sổ đều làm trong `useLayoutEffect` — xem chú thích tại chỗ trong `Dialog` để
 * biết vì sao không đọc lúc render (hai hộp anh em cùng một commit sẽ cùng đọc ra sổ rỗng).
 */
let openDialogCount = 0;
const dialogSubscribers = new Set<() => void>();

function subscribeToDialogs(notify: () => void): () => void {
  dialogSubscribers.add(notify);
  return () => {
    dialogSubscribers.delete(notify);
  };
}

/** Có hộp thoại nào đang mở không — bản đọc một phát, cho handler bàn phím. */
export function isAnyDialogOpen(): boolean {
  return openDialogCount > 0;
}

/**
 * Bản phản ứng: component nào cần TỰ ĐÓNG khi có hộp thoại mở ra thì dùng cái này.
 * `getServerSnapshot` trả `false` vì trên server chưa hộp nào mở được.
 */
export function useAnyDialogOpen(): boolean {
  return useSyncExternalStore(subscribeToDialogs, isAnyDialogOpen, () => false);
}

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
  overlayClassName,
  maxWidth,
  title,
  footer,
  closeLabel,
  initialFocus,
  children,
}: {
  /**
   * Chỗ đặt tiêu điểm khi hộp mở. Bỏ trống = Radix tự chọn (thường là nút ✕ — vòng focus to
   * nằm ở góc, và người gõ phải Tab thêm mới tới ô đầu).
   *   · `'first-field'`: hộp có form — tiêu điểm vào ô nhập đầu tiên để gõ được ngay.
   *   · `'title'`: hộp chỉ đọc — trình đọc màn hình đọc tiêu đề trước, không đọc "Đóng, nút".
   */
  initialFocus?: 'first-field' | 'title';
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
   * `accounts.spec.ts` canh đúng lỗi đó ở hộp mật khẩu tạm.
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
  const depth = useContext(DialogDepthContext);
  const [portalEl, setPortalEl] = useState<HTMLDivElement | null>(null);

  /*
   * ===== CANH DỮ LIỆU CHƯA LƯU — xem chú thích của prop `guardUnsaved` =====
   *
   * `bodyRef` trỏ vào thân hộp. Chữ ký là danh sách cặp (tên ô, giá trị) của mọi ô nhập
   * NATIVE bên trong, đem `JSON.stringify`.
   *
   * Dùng JSON chứ không nối chuỗi bằng một dấu phân cách tự chọn: mọi dấu phân cách đều có
   * thể xuất hiện TRONG giá trị người dùng gõ, và lúc đó hai form khác nhau băm ra cùng một
   * chữ ký — cửa canh im lặng bỏ sót. JSON tự lo việc thoát ký tự, nên không có cảnh đó.
   */
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const initialSignature = useRef<string | null>(null);

  const fieldSignature = useCallback((): string => {
    const root = bodyRef.current;
    if (!root) return '';
    return JSON.stringify(
      // `Array.from` chứ không phải spread: `tsconfig.app.json` nhắm bản ES cũ hơn nên
      // `NodeListOf` chưa có `[Symbol.iterator]`.
      Array.from(root.querySelectorAll('input, textarea, select')).map((el) => {
        const field = el as HTMLInputElement;
        const value =
          field.type === 'checkbox' || field.type === 'radio'
            ? String(field.checked)
            : field.value;
        return [field.name || field.id || '', value];
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
    initialSignature.current = fieldSignature();
  }, [guardUnsaved, open, portalEl, fieldSignature]);

  /** Đang chờ người dùng trả lời câu "bỏ hay ở lại" — đừng hỏi chồng lên nhau. */
  const asking = useRef(false);

  const tryClose = useCallback(() => {
    if (initialSignature.current === null || fieldSignature() === initialSignature.current) {
      onOpenChange(false);
      return;
    }
    if (asking.current) return;
    asking.current = true;
    void (async () => {
      const ok = await askConfirm({
        title: t('app.discardTitle'),
        message: t('app.discardMessage'),
        confirmLabel: t('app.discardConfirm'),
        cancelLabel: t('app.discardCancel'),
        danger: true,
      });
      asking.current = false;
      if (ok) onOpenChange(false);
    })();
  }, [askConfirm, fieldSignature, onOpenChange, t]);

  /*
   * ===== ESC LÚC MENU Ô CHỌN ĐANG MỞ CHỈ ĐƯỢC ĐÓNG MENU =====
   *
   * Mở form, bấm ô chọn, đổi ý, bấm Esc — không được để CẢ HỘP đóng và mất trắng những gì vừa
   * gõ. Đây không phải việc của một màn: mọi ô chọn trong repo đều dựng từ `ui/select.tsx`, mọi
   * hộp đều dựng từ file này.
   *
   * `select.tsx` bắt Escape rồi `e.stopPropagation()` là KHÔNG đủ, vì Radix nghe `keydown` ở
   * `document` với `capture: true`
   * (`react-dismissable-layer/dist/index.mjs:105`) — tầng bắt chạy XONG trước khi sự kiện kịp
   * bò tới handler React của ô chọn. Không handler nào của con chặn nổi một listener đăng ký
   * ở tài liệu, pha bắt. Đó là lý do một dòng `stopPropagation` trông rất hợp lý lại vô hiệu.
   *
   * Chặn phải đặt ở ĐÂY, tại `onEscapeKeyDown` — chỗ duy nhất Radix hỏi ý trước khi đóng.
   * `preventDefault()` làm Radix bỏ lượt đóng, còn sự kiện vẫn bò tiếp nên ô chọn vẫn tự đóng
   * menu của nó. Mỗi bên đóng đúng phần của mình.
   *
   * LÀM SAO BIẾT "CÓ POPOVER ĐANG MỞ": mọi thứ có thể mở đè lên hộp — `select`, `combobox`,
   * `date-picker`, `row-actions` — đều `createPortal` vào ĐÚNG điểm neo dưới
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
    tryClose();
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
    tryClose();
  };

  const onInteractOutside = (event: Event) => {
    if (!dismissible || requireExplicitClose || guardUnsaved) event.preventDefault();
  };

  /*
   * ===== TRẢ TIÊU ĐIỂM VỀ NÚT ĐÃ MỞ HỘP =====
   *
   * Radix lo focus trap, scroll-lock, Esc — nhưng phần TRẢ FOCUS thì không tự đúng ở repo này:
   * gõ Tab tới nút "Thêm thiết bị", Enter mở hộp, Esc đóng — tiêu điểm rơi về `<body>`.
   * Người dùng bàn phím bị ném về đầu trang sau MỖI lần đóng hộp, và phải
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

  /*
   * GHI TÊN VÀO SỔ, VÀ CHỐT "MÌNH CÓ PHẢI HỘP LỒNG KHÔNG" — cùng một layout effect.
   *
   * ===== VÌ SAO LÀ `useLayoutEffect`, KHÔNG PHẢI ĐỌC LÚC RENDER =====
   *
   * Đọc sổ trong lúc render thì hai hộp ANH EM mở trong CÙNG một commit
   * (`{a && <Dialog/>}{b && <Dialog/>}`) đều đọc ra sổ rỗng — chưa hộp nào kịp ghi tên — nên
   * cả hai cùng lấy nền đặc. Bài `dialog-nested-backdrop.test.tsx` bắt đúng cảnh đó.
   *
   * Layout effect thì chạy theo thứ tự cây: hộp anh ghi tên xong mới tới lượt hộp em đọc, nên
   * hộp em thấy sổ có một tên và tự biết mình là lớp thứ hai. Đổi lại là một lượt render nữa,
   * nhưng layout effect chạy TRƯỚC khi trình duyệt vẽ nên không có nháy hình.
   *
   * ===== VÌ SAO VẪN GIỮ `depth` =====
   *
   * Hộp lồng THẬT (hộp con dựng trong `sheet-body` của hộp cha) có thứ tự ngược lại: layout
   * effect của con chạy TRƯỚC của cha, nên con đọc sổ vẫn thấy rỗng. `depth` lo đúng cảnh đó.
   * Hai cơ chế phủ kín nhau, không cái nào thừa.
   */
  const [isNested, setIsNested] = useState(false);
  useLayoutEffect(() => {
    if (!open) return undefined;
    setIsNested(depth > 0 || openDialogCount > 0);
    openDialogCount += 1;
    for (const notify of dialogSubscribers) notify();
    return () => {
      openDialogCount -= 1;
      for (const notify of dialogSubscribers) notify();
    };
  }, [open, depth]);

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
        <RD.Overlay
          className={
            overlayClassName ?? (isNested ? 'modal-backdrop bare' : 'modal-backdrop')
          }
        />
        <div className="dialog-viewport">
          <RD.Content
            className={className}
            style={maxWidth ? { maxWidth } : undefined}
            onEscapeKeyDown={onEscapeKeyDown}
            onPointerDownOutside={onPointerDownOutside}
            onInteractOutside={onInteractOutside}
            onOpenAutoFocus={(event) => {
              if (!initialFocus) return;
              const root = event.currentTarget as HTMLElement | null;
              const target =
                initialFocus === 'title'
                  ? root?.querySelector<HTMLElement>('.sheet-title')
                  : root?.querySelector<HTMLElement>(
                      '.sheet-body input:not([type=hidden]):not([disabled]), .sheet-body textarea:not([disabled]), .sheet-body select:not([disabled]), .sheet-body [role=combobox]',
                    );
              if (!target) return;
              event.preventDefault();
              if (initialFocus === 'title') target.tabIndex = -1;
              target.focus();
            }}
          >
            <DialogPortalContext.Provider value={portalEl}>
              {title === undefined ? (
                /*
                 * Hộp không title vẫn cần `bodyRef` (thiếu nó `guardUnsaved` đọc chữ ký rỗng và
                 * không bao giờ hỏi) và `DialogDepthContext` (hộp mở từ trong nó phải biết mình
                 * là hộp lồng). `display: contents` để lớp bọc không đổi bố cục nơi gọi tự dựng.
                 */
                <div ref={bodyRef} style={{ display: 'contents' }}>
                  <DialogDepthContext.Provider value={depth + 1}>
                    {children}
                  </DialogDepthContext.Provider>
                </div>
              ) : (
                <>
                  <div className="sheet-header">
                    <RD.Title className="sheet-title">{title}</RD.Title>
                    <span className="spacer" />
                    {/*
                      `RD.Close` đóng hộp NGAY, không hỏi ai — nên khi đang canh dữ liệu chưa
                      lưu thì phải là nút thường đi qua `tryClose()`. Hai nhánh cùng class, cùng
                      nhãn trợ năng: người dùng không thấy khác gì.
                    */}
                    {guardUnsaved ? (
                      <button
                        type="button"
                        className="sheet-close"
                        aria-label={closeLabel ?? t('common.closeDialog')}
                        disabled={!dismissible || requireExplicitClose}
                        onClick={tryClose}
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
                    {/* Con của hộp này nằm SÂU HƠN một tầng: hộp nào mở ra từ đây là hộp lồng
                        và sẽ tự dùng nền trong suốt. */}
                    <DialogDepthContext.Provider value={depth + 1}>
                      {children}
                    </DialogDepthContext.Provider>
                  </div>
                  {footer ? (
                    /*
                     * ===== CỬA THỨ TƯ CỦA `dismissible` =====
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
