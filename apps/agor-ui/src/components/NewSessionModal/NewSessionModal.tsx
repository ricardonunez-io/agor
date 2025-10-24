import type {
  AgenticTool,
  AgenticToolName,
  MCPServer,
  PermissionMode,
  Repo,
  Worktree,
} from '@agor/core/types';
import { getDefaultPermissionMode } from '@agor/core/types';
import { DownOutlined, SettingOutlined } from '@ant-design/icons';
import {
  Alert,
  Button,
  Collapse,
  Form,
  Input,
  Modal,
  Radio,
  Select,
  Space,
  Typography,
} from 'antd';
import { useEffect, useState } from 'react';
import { AgenticToolConfigForm } from '../AgenticToolConfigForm';
import { AgentSelectionCard } from '../AgentSelectionCard';
import type { ModelConfig } from '../ModelSelector';
import { WorktreeFormFields } from '../WorktreeFormFields';

const { TextArea } = Input;
const { Text } = Typography;

export interface RepoReferenceOption {
  label: string;
  value: string;
  type: 'managed' | 'managed-worktree';
  description?: string;
}

export interface NewSessionConfig {
  agent: string;
  title?: string;
  initialPrompt?: string;

  // Worktree configuration
  worktreeMode: 'existing' | 'new';
  worktree_id?: string; // For existing worktrees (resolved from selection)

  // For new worktree creation
  newWorktree?: {
    repoId: string;
    name: string;
    ref: string;
    createBranch: boolean;
    sourceBranch: string;
    pullLatest: boolean;
    issue_url?: string;
    pull_request_url?: string;
  };

  // Advanced configuration
  modelConfig?: ModelConfig;
  mcpServerIds?: string[];
  permissionMode?: PermissionMode;
}

export interface NewSessionModalProps {
  open: boolean;
  onClose: () => void;
  onCreate: (config: NewSessionConfig) => void;
  onOpenSettings?: () => void; // Callback to open settings modal
  availableAgents: AgenticTool[];

  // Worktree options (from backend)
  worktreeOptions?: RepoReferenceOption[];
  worktrees?: Worktree[]; // Full worktree objects for resolving IDs

  // Repo options (from backend) - for creating new worktrees
  repoOptions?: RepoReferenceOption[];
  repos?: Repo[]; // Full repo objects for resolving IDs and default branches

  // MCP servers (from backend)
  mcpServers?: MCPServer[];
}

export const NewSessionModal: React.FC<NewSessionModalProps> = ({
  open,
  onClose,
  onCreate,
  onOpenSettings,
  availableAgents,
  worktreeOptions = [],
  worktrees = [],
  repoOptions = [],
  repos = [],
  mcpServers = [],
}) => {
  const [form] = Form.useForm();
  const [selectedAgent, setSelectedAgent] = useState<string | null>('claude-code');
  const [isFormValid, setIsFormValid] = useState(false);
  const [worktreeMode, setWorktreeMode] = useState<'existing' | 'new'>('existing');
  const [selectedRepoId, setSelectedRepoId] = useState<string | null>(null);
  const [useSameBranchName, setUseSameBranchName] = useState(true);

  const hasWorktrees = worktreeOptions.length > 0;
  const hasRepos = repoOptions.length > 0;

  // Get selected repo's default branch
  const selectedRepo = repos.find(r => r.repo_id === selectedRepoId);
  const defaultBranch = selectedRepo?.default_branch || 'main';

  // Update source branch when repo changes
  const handleRepoChange = (repoId: string) => {
    setSelectedRepoId(repoId);
    const repo = repos.find(r => r.repo_id === repoId);
    const branch = repo?.default_branch || 'main';
    form.setFieldValue('newWorktree_sourceBranch', branch);
    handleFormChange();
  };

  // Remember last used worktree and repo
  useEffect(() => {
    if (!open) return;

    const lastWorktreeId = localStorage.getItem('agor-last-worktree-id');
    const lastRepoId = localStorage.getItem('agor-last-repo-id');

    // Default to existing worktree if we have worktrees, otherwise new
    const defaultMode: 'existing' | 'new' = hasWorktrees ? 'existing' : 'new';
    setWorktreeMode(defaultMode);

    // Set default values
    const initialValues: Record<string, unknown> = {
      worktreeMode: defaultMode,
      permissionMode: getDefaultPermissionMode((selectedAgent as AgenticToolName) || 'claude-code'),
    };

    // If we have a last used worktree ID and it still exists, use it
    if (lastWorktreeId && worktreeOptions.some(opt => opt.value === lastWorktreeId)) {
      initialValues.worktreeId = lastWorktreeId;
    }

    // If we have a last used repo and it still exists, use it
    if (lastRepoId && repoOptions.some(opt => opt.value === lastRepoId)) {
      initialValues.newWorktree_repoId = lastRepoId;
      setSelectedRepoId(lastRepoId); // Update state so default branch hint shows
    }

    form.setFieldsValue(initialValues);
  }, [open, worktreeOptions, repoOptions, hasWorktrees, selectedAgent, form]);

  const handleCreate = () => {
    form
      .validateFields()
      .then(values => {
        if (!selectedAgent) {
          return;
        }

        const config: NewSessionConfig = {
          agent: selectedAgent || 'claude-code',
          title: values.title,
          initialPrompt: values.initialPrompt,
          worktreeMode: values.worktreeMode || worktreeMode,
          modelConfig: values.modelConfig,
          mcpServerIds: values.mcpServerIds,
          permissionMode: values.permissionMode,
        };

        if (values.worktreeMode === 'existing') {
          // Use worktree_id directly from form (no parsing needed!)
          config.worktree_id = values.worktreeId;

          // Remember last used worktree
          if (values.worktreeId) {
            localStorage.setItem('agor-last-worktree-id', values.worktreeId);

            // Also remember the repo this worktree belongs to
            const worktree = worktrees.find(w => w.worktree_id === values.worktreeId);
            if (worktree) {
              localStorage.setItem('agor-last-repo-id', worktree.repo_id);
            }
          }
        } else {
          // New worktree mode
          // Get default_branch from selected repo
          const selectedRepo = repos.find(r => r.repo_id === values.newWorktree_repoId);
          const defaultBranch = selectedRepo?.default_branch || 'main';

          // Calculate branch name based on checkbox state
          const branchName = useSameBranchName
            ? values.newWorktree_name
            : values.newWorktree_branchName;

          config.newWorktree = {
            repoId: values.newWorktree_repoId,
            name: values.newWorktree_name,
            ref: branchName,
            createBranch: true,
            sourceBranch: values.newWorktree_sourceBranch || defaultBranch,
            pullLatest: true,
            issue_url: values.newWorktree_issue_url,
            pull_request_url: values.newWorktree_pull_request_url,
          };
          // Remember last used repo
          if (values.newWorktree_repoId) {
            localStorage.setItem('agor-last-repo-id', values.newWorktree_repoId);
          }
        }

        onCreate(config);

        form.resetFields();
        setSelectedAgent('claude-code');
        onClose();
      })
      .catch(errorInfo => {
        // Validation failed - form will show errors automatically
        console.log('Validation failed:', errorInfo);
      });
  };

  const handleCancel = () => {
    form.resetFields();
    setSelectedAgent('claude-code');
    onClose();
  };

  const handleInstall = (agentId: string) => {
    console.log(`Installing agent: ${agentId}`);
    // TODO: Implement installation flow
  };

  // Check form validity without triggering error display
  const handleFormChange = () => {
    // Use setTimeout to debounce and avoid blocking the UI
    setTimeout(() => {
      // Get current form values
      const values = form.getFieldsValue();
      const mode = values.worktreeMode || worktreeMode;

      // Check if required fields are filled based on mode
      let isValid = false;
      if (mode === 'existing') {
        isValid = !!values.worktreeId;
      } else {
        // For new worktree, check repo, name, source branch, and branch name (if checkbox unchecked)
        const hasBranchName = useSameBranchName || !!values.newWorktree_branchName;
        isValid = !!(
          values.newWorktree_repoId &&
          values.newWorktree_name &&
          values.newWorktree_sourceBranch &&
          hasBranchName
        );
      }

      setIsFormValid(isValid);
    }, 0);
  };

  return (
    <Modal
      title="Create New Session"
      open={open}
      onOk={handleCreate}
      onCancel={handleCancel}
      okText="Create Session"
      cancelText="Cancel"
      width={600}
      okButtonProps={{
        disabled:
          !selectedAgent ||
          !isFormValid ||
          (worktreeMode === 'existing' && !hasWorktrees) ||
          (worktreeMode === 'new' && !hasRepos),
        title:
          worktreeMode === 'existing' && !hasWorktrees
            ? 'Create a worktree first in Settings → Worktrees'
            : worktreeMode === 'new' && !hasRepos
              ? 'Create a repo first in Settings → Repos'
              : !selectedAgent
                ? 'Please select an agent to continue'
                : !isFormValid
                  ? worktreeMode === 'existing'
                    ? 'Please select a worktree'
                    : 'Please fill in required worktree fields'
                  : undefined,
      }}
    >
      <Form
        form={form}
        layout="vertical"
        style={{ marginTop: 16 }}
        onFieldsChange={handleFormChange}
        preserve={false}
      >
        <Form.Item label="Select Coding Agent" required>
          <Space direction="vertical" style={{ width: '100%' }} size="small">
            {!selectedAgent && (
              <Text type="secondary" style={{ fontSize: 12, marginBottom: 4 }}>
                Click on an agent card to select it
              </Text>
            )}
            {availableAgents.map(agent => (
              <AgentSelectionCard
                key={agent.id}
                agent={agent}
                selected={selectedAgent === agent.id}
                onClick={() => setSelectedAgent(agent.id)}
                onInstall={() => handleInstall(agent.id)}
              />
            ))}
          </Space>
        </Form.Item>

        {/* Worktree selection mode */}
        <Form.Item name="worktreeMode" label="Worktree" required>
          <Radio.Group
            onChange={e => setWorktreeMode(e.target.value)}
            value={worktreeMode}
            style={{ width: '100%' }}
          >
            <Space direction="vertical" style={{ width: '100%' }}>
              <Radio value="existing" disabled={!hasWorktrees}>
                Use existing worktree
                {!hasWorktrees && (
                  <Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>
                    (none available)
                  </Text>
                )}
              </Radio>
              <Radio value="new" disabled={!hasRepos}>
                Create new worktree
                {!hasRepos && (
                  <Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>
                    (no repos available)
                  </Text>
                )}
              </Radio>
            </Space>
          </Radio.Group>
        </Form.Item>

        {/* Existing worktree selection */}
        {worktreeMode === 'existing' && (
          <>
            {!hasWorktrees && (
              <Alert
                type="warning"
                message="No worktrees available"
                description={
                  <Space direction="vertical" size="small">
                    <Text>You need to create a worktree before creating a session.</Text>
                    <Button
                      type="primary"
                      icon={<SettingOutlined />}
                      onClick={() => {
                        handleCancel();
                        onOpenSettings?.();
                      }}
                    >
                      Go to Settings → Worktrees
                    </Button>
                  </Space>
                }
                showIcon
                style={{ marginBottom: 16 }}
              />
            )}

            {hasWorktrees && (
              <Form.Item
                name="worktreeId"
                label="Select Worktree"
                rules={[
                  { required: worktreeMode === 'existing', message: 'Please select a worktree' },
                ]}
                validateTrigger={['onBlur', 'onChange']}
                help="Sessions run in isolated git worktrees"
              >
                <Select
                  placeholder="Select worktree..."
                  options={worktreeOptions}
                  showSearch
                  optionFilterProp="label"
                />
              </Form.Item>
            )}
          </>
        )}

        {/* New worktree creation */}
        {worktreeMode === 'new' && (
          <>
            {!hasRepos && (
              <Alert
                type="warning"
                message="No repositories available"
                description={
                  <Space direction="vertical" size="small">
                    <Text>You need to add a repository before creating a worktree.</Text>
                    <Button
                      type="primary"
                      icon={<SettingOutlined />}
                      onClick={() => {
                        handleCancel();
                        onOpenSettings?.();
                      }}
                    >
                      Go to Settings → Repos
                    </Button>
                  </Space>
                }
                showIcon
                style={{ marginBottom: 16 }}
              />
            )}

            {hasRepos && (
              <>
                <WorktreeFormFields
                  repos={repos}
                  selectedRepoId={selectedRepoId}
                  onRepoChange={handleRepoChange}
                  defaultBranch={defaultBranch}
                  fieldPrefix="newWorktree_"
                  showUrlFields={false}
                  onFormChange={handleFormChange}
                  useSameBranchName={useSameBranchName}
                  onUseSameBranchNameChange={setUseSameBranchName}
                />

                <Collapse
                  ghost
                  expandIcon={({ isActive }) => <DownOutlined rotate={isActive ? 180 : 0} />}
                  items={[
                    {
                      key: 'worktree-details',
                      label: <Text strong>Details (optional)</Text>,
                      children: (
                        <Space direction="vertical" style={{ width: '100%' }}>
                          <Form.Item
                            name="newWorktree_issue_url"
                            label="Issue URL"
                            rules={[
                              {
                                type: 'url',
                                message: 'Please enter a valid URL',
                              },
                            ]}
                            validateTrigger={['onBlur', 'onChange']}
                          >
                            <Input placeholder="https://github.com/org/repo/issues/123" />
                          </Form.Item>

                          <Form.Item
                            name="newWorktree_pull_request_url"
                            label="Pull Request URL"
                            rules={[
                              {
                                type: 'url',
                                message: 'Please enter a valid URL',
                              },
                            ]}
                            validateTrigger={['onBlur', 'onChange']}
                          >
                            <Input placeholder="https://github.com/org/repo/pull/123" />
                          </Form.Item>
                        </Space>
                      ),
                    },
                  ]}
                  style={{ marginBottom: 16 }}
                />
              </>
            )}
          </>
        )}

        <Form.Item
          name="title"
          label="Session Title (optional)"
          help="A short descriptive name for this session"
        >
          <Input placeholder="e.g., Auth System Implementation" />
        </Form.Item>

        <Form.Item
          name="initialPrompt"
          label="Initial Prompt (optional)"
          help="What should this session work on?"
        >
          <TextArea
            rows={4}
            placeholder="e.g., Build a JWT authentication system with secure password storage..."
          />
        </Form.Item>

        <Collapse
          ghost
          expandIcon={({ isActive }) => <DownOutlined rotate={isActive ? 180 : 0} />}
          items={[
            {
              key: 'agentic-tool-config',
              label: <Text strong>Agentic Tool Configuration</Text>,
              children: (
                <AgenticToolConfigForm
                  agenticTool={(selectedAgent as AgenticToolName) || 'claude-code'}
                  mcpServers={mcpServers}
                  showHelpText={true}
                />
              ),
            },
          ]}
          style={{ marginTop: 16 }}
        />
      </Form>
    </Modal>
  );
};
