import type { KeyboardEvent } from "react";

type Props = {
  open: boolean;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  canDismiss: boolean;
  onDismiss: () => void;
};

export function AuthModal({ open, value, onChange, onSubmit, canDismiss, onDismiss }: Props) {
  if (!open) return null;

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    onSubmit();
  };

  return (
    <div className="workspace-auth-layer" role="presentation">
      <div className="workspace-auth-card panel" role="dialog" aria-modal="true" aria-labelledby="workspace-auth-title">
        <div className="workspace-auth-copy">
          <div className="eyebrow">Workspace Access</div>
          <h2 id="workspace-auth-title">Set a student name to save progress</h2>
          <p className="text-muted">
            The learning map stays visible either way. Adding a name lets the app restore unfinished sessions and attach history to the current student.
          </p>
        </div>

        <div className="workspace-auth-form">
          <input
            autoFocus
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Enter a student name and press Enter"
          />
          <div className="action-row">
            <button className="btn btn-primary" type="button" onClick={onSubmit} disabled={!value.trim()}>
              Unlock Workspace
            </button>
            {canDismiss && (
              <button className="btn btn-ghost" type="button" onClick={onDismiss}>
                Preview Tasks
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
