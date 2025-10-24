/**
 * Modal for handling zone triggers on worktree drops
 * Two-step flow:
 * 1. Select session (existing or create new)
 * 2. Choose action (Prompt/Fork/Spawn)
 */

import type { Session, Worktree, WorktreeID, ZoneTrigger } from '@agor/core/types';
import { PlusCircleOutlined } from '@ant-design/icons';
import { Alert, Button, Modal, Radio, Select, Space, Typography } from 'antd';
import Handlebars from 'handlebars';
import { useEffect, useMemo, useState } from 'react';

const { Paragraph, Text } = Typography;

interface ZoneTriggerModalProps {
  open: boolean;
  onCancel: () => void;
  worktreeId: WorktreeID;
  worktree: Worktree | undefined;
  sessions: Session[];
  zoneName: string;
  trigger: ZoneTrigger;
  boardName?: string;
  boardDescription?: string;
  boardCustomContext?: Record<string, unknown>;
  onExecute: (params: {
    sessionId: string | 'new';
    action: 'prompt' | 'fork' | 'spawn';
    renderedTemplate: string;
  }) => Promise<void>;
}

export const ZoneTriggerModal = ({
  open,
  onCancel,
  worktreeId,
  worktree,
  sessions,
  zoneName,
  trigger,
  boardName,
  boardDescription,
  boardCustomContext,
  onExecute,
}: ZoneTriggerModalProps) => {
  // Step 1: Session selection
  const [selectedSessionId, setSelectedSessionId] = useState<string | 'new'>('new');

  // Step 2: Action selection
  const [selectedAction, setSelectedAction] = useState<'prompt' | 'fork' | 'spawn'>('prompt');

  // Filter sessions for this worktree
  const worktreeSessions = useMemo(() => {
    return sessions.filter(s => s.worktree_id === worktreeId);
  }, [sessions, worktreeId]);

  // Smart default: Most recent active/completed session
  const smartDefaultSession = useMemo(() => {
    if (worktreeSessions.length === 0) return 'new';

    // Prioritize running sessions
    const runningSessions = worktreeSessions.filter(s => s.status === 'running');
    if (runningSessions.length > 0) {
      // Most recently updated running session
      return runningSessions.sort(
        (a, b) =>
          new Date(b.updated_at || b.created_at).getTime() -
          new Date(a.updated_at || a.created_at).getTime()
      )[0].session_id;
    }

    // Otherwise most recent session
    return worktreeSessions.sort(
      (a, b) =>
        new Date(b.updated_at || b.created_at).getTime() -
        new Date(a.updated_at || a.created_at).getTime()
    )[0].session_id;
  }, [worktreeSessions]);

  // Reset to smart default when modal opens
  useEffect(() => {
    if (open) {
      setSelectedSessionId(smartDefaultSession);
      setSelectedAction('prompt');
    }
  }, [open, smartDefaultSession]);

  // Render template preview
  const renderedTemplate = useMemo(() => {
    try {
      const context = {
        worktree: worktree
          ? {
              name: worktree.name || '',
              ref: worktree.ref || '',
              issue_url: worktree.issue_url || '',
              pull_request_url: worktree.pull_request_url || '',
              notes: worktree.notes || '',
              path: worktree.path || '',
              context: worktree.custom_context || {},
            }
          : {
              name: '',
              ref: '',
              issue_url: '',
              pull_request_url: '',
              notes: '',
              path: '',
              context: {},
            },
        board: {
          name: boardName || '',
          description: boardDescription || '',
          context: boardCustomContext || {},
        },
        session:
          selectedSessionId !== 'new'
            ? {
                description:
                  worktreeSessions.find(s => s.session_id === selectedSessionId)?.description || '',
                context:
                  worktreeSessions.find(s => s.session_id === selectedSessionId)?.custom_context ||
                  {},
              }
            : {
                description: '',
                context: {},
              },
      };

      const template = Handlebars.compile(trigger.template);
      return template(context);
    } catch (error) {
      console.error('Handlebars template error:', error);
      return trigger.template; // Fallback to raw template
    }
  }, [
    trigger.template,
    worktree,
    boardName,
    boardDescription,
    boardCustomContext,
    selectedSessionId,
    worktreeSessions,
  ]);

  const handleExecute = async () => {
    await onExecute({
      sessionId: selectedSessionId,
      action: selectedAction,
      renderedTemplate,
    });
  };

  return (
    <Modal
      title={`Zone Trigger: ${zoneName}`}
      open={open}
      onCancel={onCancel}
      onOk={handleExecute}
      okText="Execute Trigger"
      cancelText="Cancel"
      width={700}
    >
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        {/* Step 1: Session Selection */}
        <div>
          <Text strong style={{ display: 'block', marginBottom: 8 }}>
            Step 1: Select Session
          </Text>
          <Select
            value={selectedSessionId}
            onChange={setSelectedSessionId}
            style={{ width: '100%' }}
            size="large"
            options={[
              {
                value: 'new',
                label: (
                  <span>
                    <PlusCircleOutlined /> Create New Root Session
                  </span>
                ),
              },
              ...worktreeSessions.map(session => ({
                value: session.session_id,
                label: (
                  <span>
                    {session.description || session.session_id.substring(0, 8)} ({session.status})
                  </span>
                ),
              })),
            ]}
          />
          {worktreeSessions.length === 0 && (
            <Alert
              message="No existing sessions in this worktree"
              type="info"
              showIcon
              style={{ marginTop: 8 }}
            />
          )}
        </div>

        {/* Step 2: Action Selection */}
        <div>
          <Text strong style={{ display: 'block', marginBottom: 8 }}>
            Step 2: Choose Action
          </Text>
          <Radio.Group
            value={selectedAction}
            onChange={e => setSelectedAction(e.target.value)}
            style={{ width: '100%' }}
          >
            <Space direction="vertical" style={{ width: '100%' }}>
              <Radio value="prompt">
                <strong>Prompt</strong> - Send message to selected session
              </Radio>
              <Radio value="fork" disabled={selectedSessionId === 'new'}>
                <strong>Fork</strong> - Fork selected session and send message
              </Radio>
              <Radio value="spawn" disabled={selectedSessionId === 'new'}>
                <strong>Spawn</strong> - Spawn child session and send message
              </Radio>
            </Space>
          </Radio.Group>
        </div>

        {/* Template Preview */}
        <div>
          <Text strong style={{ display: 'block', marginBottom: 8 }}>
            Rendered Prompt
          </Text>
          <Paragraph
            code
            style={{
              whiteSpace: 'pre-wrap',
              background: '#1f1f1f',
              padding: '12px',
              borderRadius: '4px',
              marginBottom: 0,
            }}
          >
            {renderedTemplate}
          </Paragraph>
        </div>

        {/* Help Text */}
        <Alert
          message="What happens when you execute?"
          description={
            selectedSessionId === 'new'
              ? 'A new root session will be created in this worktree, and the rendered prompt will be sent to it.'
              : selectedAction === 'prompt'
                ? 'The rendered prompt will be sent as a message to the selected session.'
                : selectedAction === 'fork'
                  ? 'The selected session will be forked at its current state, and the rendered prompt will be sent to the new fork.'
                  : 'A new child session will be spawned from the selected session, and the rendered prompt will be sent to it.'
          }
          type="info"
          showIcon
        />
      </Space>
    </Modal>
  );
};
