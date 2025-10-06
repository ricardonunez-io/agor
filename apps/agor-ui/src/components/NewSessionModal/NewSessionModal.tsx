import { Collapse, Form, Input, Modal, Space, Typography } from 'antd';
import { useState } from 'react';
import type { Agent } from '../../types';
import { AgentSelectionCard } from '../AgentSelectionCard';

const { TextArea } = Input;
const { Text } = Typography;

export interface NewSessionConfig {
  agent: string;
  title?: string;
  initialPrompt?: string;
  gitBranch?: string;
  createWorktree?: boolean;
}

export interface NewSessionModalProps {
  open: boolean;
  onClose: () => void;
  onCreate: (config: NewSessionConfig) => void;
  availableAgents: Agent[];
}

export const NewSessionModal: React.FC<NewSessionModalProps> = ({
  open,
  onClose,
  onCreate,
  availableAgents,
}) => {
  const [form] = Form.useForm();
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);

  const handleCreate = () => {
    form.validateFields().then(values => {
      if (!selectedAgent) {
        return;
      }

      onCreate({
        agent: selectedAgent,
        title: values.title,
        initialPrompt: values.initialPrompt,
        gitBranch: values.gitBranch,
        createWorktree: values.createWorktree,
      });

      form.resetFields();
      setSelectedAgent(null);
      onClose();
    });
  };

  const handleCancel = () => {
    form.resetFields();
    setSelectedAgent(null);
    onClose();
  };

  const handleInstall = (agentId: string) => {
    console.log(`Installing agent: ${agentId}`);
    // TODO: Implement installation flow
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
      okButtonProps={{ disabled: !selectedAgent }}
    >
      <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
        <Form.Item label="Select Coding Agent" required>
          <Space direction="vertical" style={{ width: '100%' }} size="middle">
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
          items={[
            {
              key: 'advanced',
              label: <Text type="secondary">Advanced Options</Text>,
              children: (
                <Space direction="vertical" style={{ width: '100%' }}>
                  <Form.Item
                    name="gitBranch"
                    label="Git Branch"
                    help="Branch to use for this session (optional)"
                  >
                    <Input placeholder="e.g., feature/auth" />
                  </Form.Item>

                  <Form.Item
                    name="createWorktree"
                    label="Create Worktree"
                    help="Create an isolated git worktree for this session"
                  >
                    <Input placeholder="Enable worktree management" disabled />
                  </Form.Item>
                </Space>
              ),
            },
          ]}
        />
      </Form>
    </Modal>
  );
};
