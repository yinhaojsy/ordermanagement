import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

const SIZE_CLASS = {
  md: "max-w-md",
  xl: "max-w-2xl",
  wide: "max-w-4xl",
} as const;

interface RightSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  headerActions?: ReactNode;
  size?: keyof typeof SIZE_CLASS;
}

export function RightSidebar({
  isOpen,
  onClose,
  title,
  children,
  headerActions,
  size = "md",
}: RightSidebarProps) {
  useEffect(() => {
    if (!isOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex justify-end">
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/45 backdrop-blur-[1px]"
        onClick={onClose}
        aria-label="Close"
      />
      <aside
        className={`relative z-10 flex h-full w-full ${SIZE_CLASS[size]} flex-col bg-white shadow-2xl`}
      >
        <header className="flex shrink-0 items-center gap-2 border-b border-slate-200 px-4 py-3">
          <h2 className="min-w-0 flex-1 truncate pr-2 text-lg font-semibold text-slate-900">
            {title}
          </h2>
          {headerActions ? (
            <div className="flex shrink-0 items-center gap-1">{headerActions}</div>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
            aria-label="Close"
          >
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path
                fillRule="evenodd"
                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </aside>
    </div>,
    document.body,
  );
}
