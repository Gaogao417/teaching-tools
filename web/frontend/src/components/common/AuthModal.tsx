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
          <h2 id="workspace-auth-title">填写姓名以解锁训练记录</h2>
          <p className="text-muted">
            导航树和任务概览会保持可见。输入姓名后，系统才会开始或恢复你的训练并读取个人历史。
          </p>
        </div>

        <div className="workspace-auth-form">
          <input
            autoFocus
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="请输入学生姓名后按回车"
          />
          <div className="action-row">
            <button className="btn btn-primary" type="button" onClick={onSubmit} disabled={!value.trim()}>
              解锁工作区
            </button>
            {canDismiss && (
              <button className="btn btn-ghost" type="button" onClick={onDismiss}>
                先看看任务
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
