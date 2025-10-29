import type { AgenticToolName, MCPServer, Worktree } from '@agor/core/types';
import { getDefaultPermissionMode } from '@agor/core/types';

// UI-only type for agent selection (different from AgenticTool which has UUIDv7 ID)
interface AgenticToolOption {
  id: string; // AgenticToolName as string
  name: string;
  icon: string;
  installed: boolean;
  installable?: boolean;
  version?: string;
  description?: string;
}

import { DownOutlined } from '@ant-design/icons';
import { Alert, Collapse, Form, Input, Modal, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { AgenticToolConfigForm } from '../AgenticToolConfigForm';
import { AgentSelectionCard } from '../AgentSelectionCard';
import type { ModelConfig } from '../ModelSelector';

const { TextArea } = Input;

export interface NewSessionConfig {
  worktree_id: string; // Required - sessions are always created from a worktree
  agent: string;
  title?: string;
  initialPrompt?: string;

  // Advanced configuration
  modelConfig?: ModelConfig;
  mcpServerIds?: string[];
  permissionMode?: string;
}

export interface NewSessionModalProps {
  open: boolean;
  onClose: () => void;
  onCreate: (config: NewSessionConfig) => void;
  availableAgents: AgenticToolOption[];
  worktreeId: string; // Required - the worktree to create the session in
  worktree?: Worktree; // Optional - worktree details for display
  mcpServers?: MCPServer[];
}

export const NewSessionModal: React.FC<NewSessionModalProps> = ({
  open,
  onClose,
  onCreate,
  availableAgents,
  worktreeId,
  worktree,
  mcpServers = [],
}) => {
  const [form] = Form.useForm();
  const [selectedAgent, setSelectedAgent] = useState<string>('claude-code');
  const [isFormValid, setIsFormValid] = useState(false);

  // Reset form when modal opens
  useEffect(() => {
    if (!open) return;

    setSelectedAgent('claude-code');
    form.setFieldsValue({
      title: '',
      initialPrompt: '',
      permissionMode: getDefaultPermissionMode('claude-code'),
      mcpServerIds: [],
    });
    setIsFormValid(false);
  }, [open, form]);

  // Update permission mode when agent changes
  useEffect(() => {
    if (selectedAgent) {
      form.setFieldValue(
        'permissionMode',
        getDefaultPermissionMode((selectedAgent as AgenticToolName) || 'claude-code')
      );
    }
  }, [selectedAgent, form]);

  const handleFormChange = () => {
    const hasAgent = !!selectedAgent;
    setIsFormValid(hasAgent);
  };

  const handleInstall = (agentId: string) => {
    console.log('Install agent:', agentId);
    // TODO: Implement agent installation
  };

  const handleCreate = () => {
    form.validateFields().then((values) => {
      const config: NewSessionConfig = {
        worktree_id: worktreeId,
        agent: selectedAgent,
        title: values.title,
        initialPrompt: values.initialPrompt,
        modelConfig: values.modelConfig,
        mcpServerIds: values.mcpServerIds,
        permissionMode: values.permissionMode,
      };
      onCreate(config);
    });
  };

  const handleCancel = () => {
    form.resetFields();
    onClose();
  };

  return (
    <Modal
      title="Create New Session"
      open={open}
      onOk={handleCreate}
      onCancel={handleCancel}
      okText="Create Session"
      cancelText="Cancel"
      width={700}
      okButtonProps={{
        disabled: !isFormValid,
      }}
    >
      <Form
        form={form}
        layout="vertical"
        style={{ marginTop: 16 }}
        onFieldsChange={handleFormChange}
        preserve={false}
      >
        {/* Worktree Info */}
        {worktree && (
          <Alert
            message={
              <>
                Creating session in worktree: <strong>{worktree.name}</strong> ({worktree.ref})
              </>
            }
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
          />
        )}

        {/* Agent Selection */}
        <Form.Item label="Select Coding Agent" required>
          {!selectedAgent && (
            <Typography.Text
              type="secondary"
              style={{ fontSize: 12, marginBottom: 8, display: 'block' }}
            >
              Click on an agent card to select it
            </Typography.Text>
          )}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, 1fr)',
              gap: 8,
              marginTop: 8,
            }}
          >
            {availableAgents.map((agent) => (
              <AgentSelectionCard
                key={agent.id}
                agent={agent}
                selected={selectedAgent === agent.id}
                onClick={() => setSelectedAgent(agent.id)}
                onInstall={() => handleInstall(agent.id)}
              />
            ))}
          </div>
        </Form.Item>

        {/* Session Title */}
        <Form.Item name="title" label="Title (optional)">
          <Input placeholder="e.g., Add authentication system" />
        </Form.Item>

        {/* Initial Prompt */}
        <Form.Item
          name="initialPrompt"
          label="Initial Prompt (optional)"
          help="First message to send to the agent when session starts"
        >
          <TextArea
            rows={4}
            placeholder="e.g., Build a JWT authentication system with secure password storage..."
          />
        </Form.Item>

        {/* Advanced Configuration (Collapsible) */}
        <Collapse
          ghost
          expandIcon={({ isActive }) => <DownOutlined rotate={isActive ? 180 : 0} />}
          items={[
            {
              key: 'agentic-tool-config',
              label: <Typography.Text strong>Agentic Tool Configuration</Typography.Text>,
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
