import { createContext, useContext, type ReactNode } from "react";

type FocusWorkspaceContextValue = {
  actionBarLeftRef: React.RefObject<HTMLDivElement | null>;
};

const FocusWorkspaceContext = createContext<FocusWorkspaceContextValue | null>(null);

export function useFocusWorkspace() {
  const ctx = useContext(FocusWorkspaceContext);
  if (!ctx) throw new Error("useFocusWorkspace must be used within FocusWorkspace");
  return ctx;
}

type FocusWorkspaceProps = {
  ariaLabel: string;
  prompt: ReactNode;
  rail: ReactNode;
  actionEnd?: ReactNode;
  children: ReactNode;
  className?: string;
  actionBarLeft?: ReactNode;
};

export function FocusWorkspace({
  ariaLabel,
  prompt,
  rail,
  actionEnd,
  children,
  className,
  actionBarLeft,
}: FocusWorkspaceProps) {
  return (
    <div className={`ks-focus-workspace ${className || ""}`} role="region" aria-label={ariaLabel}>
      <header className="ks-focus-prompt">
        {prompt}
      </header>

      <div className="ks-focus-canvas">
        {children}
      </div>

      <aside className="ks-focus-rail" aria-label="指导栏">
        {rail}
      </aside>

      <footer className="ks-focus-action-bar">
        <div className="ks-focus-action-bar-left">
          {actionBarLeft}
        </div>
        <div className="ks-focus-action-bar-right">
          {actionEnd}
        </div>
      </footer>
    </div>
  );
}
