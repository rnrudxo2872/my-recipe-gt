import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

/** 아래에서 올라오는 창. 넓은 화면에서는 가운데 대화상자로 뜬다. */
export function Sheet(props: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const { open, onClose } = props;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      document.documentElement.classList.add("is-locked");
    } else if (!open && dialog.open) {
      dialog.close();
    }
    if (!open) document.documentElement.classList.remove("is-locked");
  }, [open]);

  useEffect(() => () => document.documentElement.classList.remove("is-locked"), []);

  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-label={props.title}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        // 바깥 어두운 곳을 누르면 닫는다.
        if (e.target === ref.current) onClose();
      }}
    >
      {open && (
        <>
          <div className="sheet-head">
            <h2>{props.title}</h2>
            <button type="button" className="icon-btn" onClick={onClose} aria-label="닫기">
              <X />
            </button>
          </div>
          <div className="sheet-content">{props.children}</div>
          {props.footer && <div className="sheet-foot">{props.footer}</div>}
        </>
      )}
    </dialog>
  );
}
