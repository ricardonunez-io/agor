import type { Session, Task, User, Worktree } from '@agor/core/types';
import { TaskStatus } from '@agor/core/types';
import {
  BranchesOutlined,
  CloseOutlined,
  DeleteOutlined,
  DragOutlined,
  EditOutlined,
  ExpandOutlined,
  FolderOpenOutlined,
  LinkOutlined,
  PlusOutlined,
  PushpinFilled,
} from '@ant-design/icons';
import { Badge, Button, Card, Collapse, Space, Spin, Tag, Typography, theme } from 'antd';
import { DeleteWorktreePopconfirm } from '../DeleteWorktreePopconfirm';
import { CreatedByTag } from '../metadata';
import { IssuePill, PullRequestPill } from '../Pill';
import { ToolIcon } from '../ToolIcon';

const WORKTREE_CARD_MAX_WIDTH = 600;

interface WorktreeCardProps {
  worktree: Worktree;
  sessions: Session[];
  tasks: Record<string, Task[]>;
  users: User[];
  currentUserId?: string;
  onTaskClick?: (taskId: string) => void;
  onSessionClick?: (sessionId: string) => void;
  onCreateSession?: (worktreeId: string) => void;
  onDelete?: (worktreeId: string, deleteFromFilesystem: boolean) => void;
  onOpenSettings?: (worktreeId: string) => void;
  onUnpin?: (worktreeId: string) => void;
  isPinned?: boolean;
  zoneName?: string;
  zoneColor?: string;
  defaultExpanded?: boolean;
}

const WorktreeCard = ({
  worktree,
  sessions,
  tasks,
  users,
  currentUserId,
  onTaskClick,
  onSessionClick,
  onCreateSession,
  onDelete,
  onOpenSettings,
  onUnpin,
  isPinned = false,
  zoneName,
  zoneColor,
  defaultExpanded = true,
}: WorktreeCardProps) => {
  const { token } = theme.useToken();

  // Session list content (collapsible) - only used when sessions exist
  const sessionListContent = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {sessions.map(session => (
        <div
          key={session.session_id}
          style={{
            border: `1px solid rgba(255, 255, 255, 0.1)`,
            borderRadius: 4,
            padding: 8,
            background: 'rgba(0, 0, 0, 0.2)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            cursor: 'pointer',
          }}
          onClick={() => onSessionClick?.(session.session_id)}
        >
          <Space size={4} align="start" style={{ flex: 1, minWidth: 0 }}>
            <div style={{ marginTop: 2 }}>
              <ToolIcon tool={session.agentic_tool} size={20} />
            </div>
            <Typography.Text
              strong
              style={{
                fontSize: 12,
                flex: 1,
                wordBreak: 'break-word',
                overflowWrap: 'break-word',
              }}
            >
              {session.title || session.description || session.agentic_tool}
            </Typography.Text>
            <div style={{ marginTop: 2 }}>
              {session.status === TaskStatus.RUNNING ? (
                <Spin size="small" />
              ) : (
                <Badge
                  status={
                    session.status === TaskStatus.COMPLETED
                      ? 'success'
                      : session.status === TaskStatus.FAILED
                        ? 'error'
                        : 'default'
                  }
                />
              )}
            </div>
          </Space>

          <div style={{ marginTop: 2 }}>
            <Button
              type="text"
              size="small"
              icon={<ExpandOutlined />}
              onClick={e => {
                e.stopPropagation();
                onSessionClick?.(session.session_id);
              }}
              title="Open session"
            />
          </div>
        </div>
      ))}
    </div>
  );

  // Session list collapse header
  const sessionListHeader = (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        width: '100%',
      }}
    >
      <Space size={4} align="center">
        <Typography.Text strong>Sessions</Typography.Text>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          ({sessions.length})
        </Typography.Text>
      </Space>
      {sessions.length > 0 && onCreateSession && (
        <div className="nodrag">
          <Button
            type="text"
            size="small"
            icon={<PlusOutlined />}
            onClick={e => {
              e.stopPropagation();
              onCreateSession(worktree.worktree_id);
            }}
            title="Create new session"
            style={{ fontSize: 12 }}
          />
        </div>
      )}
    </div>
  );

  return (
    <Card
      style={{
        width: 400,
        ...(isPinned && zoneColor ? { borderColor: zoneColor, borderWidth: 1 } : {}),
      }}
      styles={{
        body: { padding: 16 },
      }}
    >
      {/* Worktree header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 12,
        }}
      >
        <Space size={8} align="center">
          <div className="drag-handle" style={{ display: 'flex', alignItems: 'center' }}>
            <BranchesOutlined style={{ fontSize: 32, color: token.colorPrimary }} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <Typography.Text strong className="nodrag">
              {worktree.name}
            </Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {worktree.ref}
            </Typography.Text>
          </div>
        </Space>

        <Space size={4}>
          <div className="nodrag">
            {isPinned && zoneName && (
              <Tag
                icon={<PushpinFilled />}
                color="blue"
                onClick={e => {
                  e.stopPropagation();
                  onUnpin?.(worktree.worktree_id);
                }}
                style={{ cursor: 'pointer' }}
                title={`Pinned to ${zoneName} (click to unpin)`}
              >
                {zoneName}
              </Tag>
            )}
          </div>
          <Button
            type="text"
            size="small"
            icon={<DragOutlined />}
            className="drag-handle"
            title="Drag to reposition"
          />
          <div className="nodrag">
            {onOpenSettings && (
              <Button
                type="text"
                size="small"
                icon={<EditOutlined />}
                onClick={e => {
                  e.stopPropagation();
                  onOpenSettings(worktree.worktree_id);
                }}
                title="Edit worktree"
              />
            )}
            {onDelete && (
              <DeleteWorktreePopconfirm
                worktree={worktree}
                sessionCount={sessions.length}
                onConfirm={deleteFromFilesystem =>
                  onDelete(worktree.worktree_id, deleteFromFilesystem)
                }
              >
                <Button
                  type="text"
                  size="small"
                  icon={<DeleteOutlined />}
                  onClick={e => e.stopPropagation()}
                  title="Delete worktree"
                  danger
                />
              </DeleteWorktreePopconfirm>
            )}
          </div>
        </Space>
      </div>

      {/* Worktree metadata - all pills on one row */}
      <div className="nodrag" style={{ marginBottom: 8 }}>
        <Space size={4} wrap>
          {worktree.created_by && (
            <CreatedByTag
              createdBy={worktree.created_by}
              currentUserId={currentUserId}
              users={users}
              prefix="Created by"
            />
          )}
          {worktree.issue_url && <IssuePill issueUrl={worktree.issue_url} />}
          {worktree.pull_request_url && <PullRequestPill prUrl={worktree.pull_request_url} />}
        </Space>
      </div>

      {/* Notes */}
      {worktree.notes && (
        <div className="nodrag" style={{ marginBottom: 8 }}>
          <Typography.Text type="secondary" style={{ fontSize: 12, fontStyle: 'italic' }}>
            {worktree.notes}
          </Typography.Text>
        </div>
      )}

      {/* Sessions - collapsible (only show if sessions exist, otherwise show button directly) */}
      <div className="nodrag">
        {sessions.length === 0 ? (
          // No sessions: show create button without collapse wrapper
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              alignItems: 'center',
              padding: '16px 0',
              marginTop: 8,
            }}
          >
            {onCreateSession && (
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={e => {
                  e.stopPropagation();
                  onCreateSession(worktree.worktree_id);
                }}
                size="middle"
              >
                Create Session
              </Button>
            )}
          </div>
        ) : (
          // Has sessions: show collapsible section
          <Collapse
            defaultActiveKey={defaultExpanded ? ['sessions'] : []}
            items={[
              {
                key: 'sessions',
                label: sessionListHeader,
                children: sessionListContent,
              },
            ]}
            ghost
            style={{ marginTop: 8 }}
          />
        )}
      </div>
    </Card>
  );
};

export default WorktreeCard;
