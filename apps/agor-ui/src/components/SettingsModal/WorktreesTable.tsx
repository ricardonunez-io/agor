import { renderTemplate } from '@agor/core/templates/handlebars-helpers';
import type { Repo, Session, Worktree } from '@agor/core/types';
import {
  BranchesOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  DeleteOutlined,
  EditOutlined,
  FolderOutlined,
  GlobalOutlined,
  LoadingOutlined,
  MinusCircleOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  PoweroffOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { Badge, Button, Empty, Form, Modal, Space, Table, Tooltip, Typography, theme } from 'antd';
import { useState } from 'react';
import { DeleteWorktreePopconfirm } from '../DeleteWorktreePopconfirm';
import { WorktreeFormFields } from '../WorktreeFormFields';

interface WorktreesTableProps {
  worktrees: Worktree[];
  repos: Repo[];
  boards: import('@agor/core/types').Board[];
  sessions: Session[];
  onDelete?: (worktreeId: string, deleteFromFilesystem: boolean) => void;
  onCreate?: (
    repoId: string,
    data: {
      name: string;
      ref: string;
      createBranch: boolean;
      sourceBranch: string;
      pullLatest: boolean;
      boardId?: string;
    }
  ) => void;
  onRowClick?: (worktree: Worktree) => void;
  onStartEnvironment?: (worktreeId: string) => void;
  onStopEnvironment?: (worktreeId: string) => void;
}

export const WorktreesTable: React.FC<WorktreesTableProps> = ({
  worktrees,
  repos,
  boards,
  sessions,
  onDelete,
  onCreate,
  onRowClick,
  onStartEnvironment,
  onStopEnvironment,
}) => {
  const { token } = theme.useToken();
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [form] = Form.useForm();
  const [useSameBranchName, setUseSameBranchName] = useState(true);
  const [selectedRepoId, setSelectedRepoId] = useState<string | null>(null);
  const [isFormValid, setIsFormValid] = useState(false);

  // Helper to get repo name from repo_id
  const getRepoName = (repoId: string): string => {
    const repo = repos.find((r) => r.repo_id === repoId);
    return repo?.name || 'Unknown Repo';
  };

  // Helper to get environment status icon
  const getEnvStatusIcon = (worktree: Worktree) => {
    const status = worktree.environment_instance?.status;
    const healthStatus = worktree.environment_instance?.last_health_check?.status;

    if (!status || status === 'stopped') {
      return (
        <Tooltip title="Environment stopped">
          <MinusCircleOutlined style={{ color: token.colorTextDisabled }} />
        </Tooltip>
      );
    }

    if (status === 'starting' || status === 'stopping') {
      return (
        <Tooltip title={`Environment ${status}`}>
          <LoadingOutlined style={{ color: token.colorPrimary }} />
        </Tooltip>
      );
    }

    if (status === 'error') {
      return (
        <Tooltip
          title={`Error: ${worktree.environment_instance?.last_health_check?.message || 'Unknown'}`}
        >
          <CloseCircleOutlined style={{ color: token.colorError }} />
        </Tooltip>
      );
    }

    if (status === 'running') {
      // Show health status if available
      if (healthStatus === 'healthy') {
        return (
          <Tooltip title="Running (healthy)">
            <CheckCircleOutlined style={{ color: token.colorSuccess }} />
          </Tooltip>
        );
      }
      if (healthStatus === 'unhealthy') {
        return (
          <Tooltip
            title={`Running (unhealthy): ${worktree.environment_instance?.last_health_check?.message || ''}`}
          >
            <WarningOutlined style={{ color: token.colorWarning }} />
          </Tooltip>
        );
      }
      // Running but no health check yet
      return (
        <Tooltip title="Running">
          <Badge status="processing" />
        </Tooltip>
      );
    }

    return null;
  };

  // Get selected repo's default branch
  const getDefaultBranch = (): string => {
    if (!selectedRepoId) return 'main';
    const repo = repos.find((r) => r.repo_id === selectedRepoId);
    return repo?.default_branch || 'main';
  };

  // Update source branch when repo changes
  const handleRepoChange = (repoId: string) => {
    setSelectedRepoId(repoId);
    const repo = repos.find((r) => r.repo_id === repoId);
    const defaultBranch = repo?.default_branch || 'main';
    form.setFieldValue('sourceBranch', defaultBranch);
  };

  const handleDelete = (worktreeId: string, deleteFromFilesystem: boolean) => {
    onDelete?.(worktreeId, deleteFromFilesystem);
  };

  const handleCreate = async () => {
    try {
      const values = await form.validateFields();
      const branchName = useSameBranchName ? values.name : values.branchName;

      onCreate?.(values.repoId, {
        name: values.name,
        ref: branchName,
        createBranch: true, // Always create new branch based on source branch
        sourceBranch: values.sourceBranch,
        pullLatest: true, // Always fetch latest before creating worktree
        boardId: values.boardId, // Optional: add to board
      });
      setCreateModalOpen(false);
      form.resetFields();
      setUseSameBranchName(true);
      setSelectedRepoId(null);
    } catch (error) {
      console.error('Validation failed:', error);
    }
  };

  const handleCancel = () => {
    setCreateModalOpen(false);
    form.resetFields();
    setUseSameBranchName(true);
    setSelectedRepoId(null);
    setIsFormValid(false);
  };

  // Validate form fields to enable/disable Create button
  const validateForm = () => {
    const values = form.getFieldsValue();
    const hasRepo = !!values.repoId;
    const hasSourceBranch = !!values.sourceBranch;
    const hasName = !!values.name && /^[a-z0-9-]+$/.test(values.name);
    const hasBranchName = useSameBranchName || !!values.branchName;

    setIsFormValid(hasRepo && hasSourceBranch && hasName && hasBranchName);
  };

  const columns = [
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      render: (name: string, _record: Worktree) => (
        <Space>
          <BranchesOutlined />
          <Typography.Text strong>{name}</Typography.Text>
        </Space>
      ),
    },
    {
      title: 'Env',
      key: 'env',
      width: 120,
      align: 'center' as const,
      render: (_: unknown, record: Worktree) => {
        const status = record.environment_instance?.status;
        const healthStatus = record.environment_instance?.last_health_check?.status;
        const repo = repos.find((r) => r.repo_id === record.repo_id);
        const hasEnvConfig = !!repo?.environment_config;

        const isRunningOrHealthy =
          status === 'running' || status === 'starting' || healthStatus === 'healthy';

        return (
          <Space size={4}>
            {getEnvStatusIcon(record)}
            {hasEnvConfig && (
              <>
                <Button
                  type="text"
                  size="small"
                  icon={<PlayCircleOutlined />}
                  disabled={isRunningOrHealthy}
                  onClick={(e) => {
                    e.stopPropagation();
                    onStartEnvironment?.(record.worktree_id);
                  }}
                  style={{ padding: '0 4px' }}
                />
                <Button
                  type="text"
                  size="small"
                  icon={<PoweroffOutlined />}
                  onClick={(e) => {
                    e.stopPropagation();
                    onStopEnvironment?.(record.worktree_id);
                  }}
                  style={{ padding: '0 4px' }}
                />
                {repo.environment_config?.health_check?.url_template && (
                  <Button
                    type="text"
                    size="small"
                    icon={<GlobalOutlined />}
                    onClick={(e) => {
                      e.stopPropagation();
                      // Render the URL template with worktree context
                      const templateContext = {
                        worktree: {
                          unique_id: record.worktree_unique_id,
                          name: record.name,
                          path: record.path,
                        },
                        repo: {
                          slug: repo.slug,
                        },
                      };
                      const url = renderTemplate(
                        repo.environment_config?.health_check?.url_template || '',
                        templateContext
                      );
                      if (url) {
                        window.open(url, '_blank');
                      }
                    }}
                    style={{ padding: '0 4px' }}
                  />
                )}
              </>
            )}
          </Space>
        );
      },
    },
    {
      title: 'Repo',
      dataIndex: 'repo_id',
      key: 'repo_id',
      render: (repoId: string) => (
        <Space>
          <FolderOutlined />
          <Typography.Text>{getRepoName(repoId)}</Typography.Text>
        </Space>
      ),
    },
    {
      title: 'Branch',
      dataIndex: 'ref',
      key: 'ref',
      render: (ref: string) => <Typography.Text code>{ref}</Typography.Text>,
    },
    {
      title: 'Sessions',
      dataIndex: 'sessions',
      key: 'sessions',
      width: 100,
      render: (sessions: string[]) => (
        <Typography.Text type="secondary">
          {sessions?.length || 0} {sessions?.length === 1 ? 'session' : 'sessions'}
        </Typography.Text>
      ),
    },
    {
      title: 'Path',
      dataIndex: 'path',
      key: 'path',
      render: (path: string) => (
        <Typography.Text code style={{ fontSize: 11 }}>
          {path}
        </Typography.Text>
      ),
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 100,
      render: (_: unknown, record: Worktree) => (
        <Space size="small">
          <Button
            type="text"
            size="small"
            icon={<EditOutlined />}
            onClick={(e) => {
              e.stopPropagation();
              onRowClick?.(record);
            }}
          />
          <DeleteWorktreePopconfirm
            worktree={record}
            sessionCount={sessions.filter((s) => s.worktree_id === record.worktree_id).length}
            onConfirm={(deleteFromFilesystem) =>
              handleDelete(record.worktree_id, deleteFromFilesystem)
            }
          >
            <Button
              type="text"
              size="small"
              icon={<DeleteOutlined />}
              danger
              onClick={(e) => e.stopPropagation()}
            />
          </DeleteWorktreePopconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div
        style={{
          marginBottom: 16,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <Typography.Text type="secondary">
          Manage git worktrees for isolated development contexts across sessions.
        </Typography.Text>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => setCreateModalOpen(true)}
          disabled={repos.length === 0}
        >
          Create Worktree
        </Button>
      </div>

      {!worktrees && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: 400,
          }}
        >
          <Empty description="Loading worktrees..." />
        </div>
      )}

      {worktrees && repos.length === 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: 400,
          }}
        >
          <Empty description="No repositories configured">
            <Typography.Text type="secondary">
              Create a repository first in the Repositories tab to enable worktrees.
            </Typography.Text>
          </Empty>
        </div>
      )}

      {repos.length > 0 && worktrees.length === 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: 400,
          }}
        >
          <Empty description="No worktrees yet">
            <Typography.Text type="secondary">
              Worktrees will appear here once created from sessions or the CLI.
            </Typography.Text>
          </Empty>
        </div>
      )}

      {worktrees.length > 0 && (
        <Table
          dataSource={worktrees}
          columns={columns}
          rowKey="worktree_id"
          pagination={{ pageSize: 10 }}
          size="small"
          onRow={(record) => ({
            onClick: () => onRowClick?.(record),
            style: { cursor: onRowClick ? 'pointer' : 'default' },
          })}
        />
      )}

      <Modal
        title="Create Worktree"
        open={createModalOpen}
        onOk={handleCreate}
        onCancel={handleCancel}
        okText="Create"
        okButtonProps={{
          disabled: !isFormValid,
        }}
      >
        <Form form={form} layout="vertical" onFieldsChange={validateForm}>
          <WorktreeFormFields
            repos={repos}
            boards={boards}
            selectedRepoId={selectedRepoId}
            onRepoChange={handleRepoChange}
            defaultBranch={getDefaultBranch()}
            showBoardSelector={true}
            onFormChange={validateForm}
            useSameBranchName={useSameBranchName}
            onUseSameBranchNameChange={setUseSameBranchName}
          />
        </Form>
      </Modal>
    </div>
  );
};
