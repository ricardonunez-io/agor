/**
 * Modal for forking or spawning sessions from WorktreeCard
 *
 * Prompts user for initial prompt text and calls fork/spawn action
 */

import type { Session } from '@agor/core/types';
import { Input, Modal, Typography } from 'antd';
import { useState } from 'react';

const { TextArea } = Input;

export type ForkSpawnAction = 'fork' | 'spawn';

export interface ForkSpawnModalProps {
  open: boolean;
  action: ForkSpawnAction;
  session: Session | null;
  onConfirm: (prompt: string) => Promise<void>;
  onCancel: () => void;
}

export const ForkSpawnModal: React.FC<ForkSpawnModalProps> = ({
  open,
  action,
  session,
  onConfirm,
  onCancel,
}) => {
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);

  const handleOk = async () => {
    if (!prompt.trim()) {
      return;
    }

    setLoading(true);
    try {
      await onConfirm(prompt.trim());
      setPrompt('');
      onCancel();
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    setPrompt('');
    onCancel();
  };

  const actionLabel = action === 'fork' ? 'Fork' : 'Spawn';
  const actionDescription =
    action === 'fork'
      ? 'Create a sibling session to explore an alternative approach'
      : 'Create a child session to work on a focused subsession';

  return (
    <Modal
      title={
        <div>
          <Typography.Text strong>
            {actionLabel} Session: {session?.title || session?.description || 'Untitled'}
          </Typography.Text>
        </div>
      }
      open={open}
      onOk={handleOk}
      onCancel={handleCancel}
      okText={`${actionLabel} Session`}
      confirmLoading={loading}
      okButtonProps={{ disabled: !prompt.trim() }}
      width={600}
    >
      <div style={{ marginBottom: 16 }}>
        <Typography.Text type="secondary" style={{ fontSize: 13 }}>
          {actionDescription}
        </Typography.Text>
      </div>

      <div>
        <Typography.Text strong style={{ marginBottom: 8, display: 'block' }}>
          Prompt for {action === 'fork' ? 'forked' : 'spawned'} session:
        </Typography.Text>
        <TextArea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={
            action === 'fork' ? 'Try a different approach by...' : 'Work on this subsession...'
          }
          autoSize={{ minRows: 4, maxRows: 12 }}
          autoFocus
        />
      </div>
    </Modal>
  );
};
