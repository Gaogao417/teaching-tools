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
  /** Provide a trigger node to switch the rail into "dock" mode: the rail becomes
   *  a right-side overlay drawer that the trigger toggles, so the primary workspace
   *  (children) never re-layouts. Omit to keep the legacy always-open grid rail. */
  railOpen?: boolean;
  railTrigger?: ReactNode;
  actionEnd?: ReactNode;
  children: ReactNode;
  className?: string;
  actionBarLeft?: ReactNode;
};

export function FocusWorkspace({
  ariaLabel,
  prompt,
  rail,
  railOpen = true,
  railTrigger,
  actionEnd,
  children,
  className,
  actionBarLeft,
}: FocusWorkspaceProps) {
  const dock = Boolean(railTrigger);
  const workspaceClass = [
    "ks-focus-workspace",
    dock ? "ks-focus-workspace--dock" : "",
    dock ? (railOpen ? "is-rail-open" : "is-rail-closed") : "",
    className || "",
  ].filter(Boolean).join(" ");

  const actionBar = (
    <footer className="ks-focus-action-bar">
      <div className="ks-focus-action-bar-left">
        {actionBarLeft}
      </div>
      <div className="ks-focus-action-bar-right">
        {actionEnd}
      </div>
    </footer>
  );

  if (dock) {
    return (
      <div className={workspaceClass} role="region" aria-label={ariaLabel}>
        <header className="ks-focus-prompt">
          {prompt}
        </header>

        <div className="ks-focus-canvas">
          {children}
          <aside
            className={`ks-focus-rail-drawer ${railOpen ? "is-open" : "is-closed"}`}
            aria-label="陪练老师"
            aria-hidden={!railOpen}
            inert={!railOpen || undefined}
          >
            {rail}
          </aside>
          <div className="ks-focus-rail-trigger">
            {railTrigger}
          </div>
        </div>

        {actionBar}
      </div>
    );
  }

  return (
    <div className={workspaceClass} role="region" aria-label={ariaLabel}>
      <header className="ks-focus-prompt">
        {prompt}
      </header>

      <div className="ks-focus-canvas">
        {children}
      </div>

      <aside className="ks-focus-rail" aria-label="指导栏">
        {rail}
      </aside>

      {actionBar}
    </div>
  );
}
