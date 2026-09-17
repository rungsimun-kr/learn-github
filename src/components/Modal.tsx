import { useEffect, useRef, type ReactNode } from 'react';

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** 'wide' for a dialog that needs more than the usual single-column form. */
  width?: 'normal' | 'wide';
}

/** Dialog shell built on <dialog> so focus trapping and Esc come for free. */
export default function Modal({ title, onClose, children, footer, width = 'normal' }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      className={`modal${width === 'wide' ? ' modal-wide' : ''}`}
      onCancel={onClose}
      onClose={onClose}
    >
      <header className="modal-header">
        <h2>{title}</h2>
        {/* "Close dialog", not "Close": a footer button may also say Close, and
            two controls with the same accessible name is a trap for anyone
            navigating by name. */}
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close dialog">
          ✕
        </button>
      </header>
      <div className="modal-body">{children}</div>
      {footer ? <footer className="modal-footer">{footer}</footer> : null}
    </dialog>
  );
}
