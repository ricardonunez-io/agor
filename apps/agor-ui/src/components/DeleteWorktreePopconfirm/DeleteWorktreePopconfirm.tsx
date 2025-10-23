import type { Worktree } from '@agor/core/types';
import { Checkbox, Popconfirm, theme } from 'antd';
import { type ReactNode, useState } from 'react';

interface DeleteWorktreePopconfirmProps {
  worktree: Worktree;
  sessionCount?: number;
  onConfirm: (deleteFromFilesystem: boolean) => void;
  children: ReactNode;
}

export const DeleteWorktreePopconfirm: React.FC<DeleteWorktreePopconfirmProps> = ({
  worktree,
  sessionCount = 0,
  onConfirm,
  children,
}) => {
  const { token } = theme.useToken();
  const [deleteFromFilesystem, setDeleteFromFilesystem] = useState(true);

  const handleConfirm = () => {
    onConfirm(deleteFromFilesystem);
  };

  return (
    <Popconfirm
      title="Delete worktree?"
      description={
        <div style={{ maxWidth: 400 }}>
          <p>Are you sure you want to delete worktree "{worktree.name}"?</p>
          {sessionCount > 0 && (
            <p style={{ color: '#ff4d4f' }}>
              ⚠️ {sessionCount} session(s) reference this worktree.
            </p>
          )}
          <Checkbox
            checked={deleteFromFilesystem}
            onChange={e => setDeleteFromFilesystem(e.target.checked)}
            style={{ marginTop: 8 }}
          >
            Also delete worktree from filesystem
          </Checkbox>
          <p style={{ color: token.colorTextSecondary, marginTop: 4, marginBottom: 0 }}>
            Path: {worktree.path}
          </p>
        </div>
      }
      onConfirm={handleConfirm}
      okText="Delete"
      cancelText="Cancel"
      okButtonProps={{ danger: true }}
    >
      {children}
    </Popconfirm>
  );
};
