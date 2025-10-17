import type { MCPServer } from '@agor/core/types';
import { Divider, Form, Input, Modal } from 'antd';
import React from 'react';
import type { Session } from '../../types';
import { JSONEditor, validateJSON } from '../JSONEditor';
import { MCPServerSelect } from '../MCPServerSelect';
import type { ModelConfig } from '../ModelSelector';
import { ModelSelector } from '../ModelSelector';
import { PermissionModeSelector } from '../PermissionModeSelector';

export interface SessionSettingsModalProps {
  open: boolean;
  onClose: () => void;
  session: Session;
  mcpServers: MCPServer[];
  sessionMcpServerIds: string[];
  onUpdate?: (sessionId: string, updates: Partial<Session>) => void;
  onUpdateSessionMcpServers?: (sessionId: string, mcpServerIds: string[]) => void;
  onUpdateModelConfig?: (sessionId: string, modelConfig: ModelConfig) => void;
}

/**
 * Session Settings Modal
 *
 * Unified settings modal for sessions (used from both SessionCard and SessionDrawer)
 * Allows editing:
 * - Session title
 * - Claude model configuration
 * - MCP Server attachments
 */
export const SessionSettingsModal: React.FC<SessionSettingsModalProps> = ({
  open,
  onClose,
  session,
  mcpServers,
  sessionMcpServerIds,
  onUpdate,
  onUpdateSessionMcpServers,
  onUpdateModelConfig,
}) => {
  const [form] = Form.useForm();

  // Reset form values when modal opens or props change
  React.useEffect(() => {
    if (open) {
      // Get default permission mode based on agentic tool type
      const defaultPermissionMode = session.agentic_tool === 'codex' ? 'auto' : 'acceptEdits';

      form.setFieldsValue({
        title: session.description || '',
        mcpServerIds: sessionMcpServerIds,
        modelConfig: session.model_config,
        permissionMode: session.permission_config?.mode || defaultPermissionMode,
        issue_url: session.issue_url || '',
        pull_request_url: session.pull_request_url || '',
        custom_context: session.custom_context
          ? JSON.stringify(session.custom_context, null, 2)
          : '',
      });
    }
  }, [
    open,
    session.description,
    session.agentic_tool,
    sessionMcpServerIds,
    session.model_config,
    session.permission_config?.mode,
    session.issue_url,
    session.pull_request_url,
    session.custom_context,
    form,
  ]);

  const handleOk = () => {
    form.validateFields().then(values => {
      // Collect all updates
      const updates: Partial<Session> = {};

      // Update session title/description
      if (values.title !== session.description) {
        updates.description = values.title;
      }

      // Update model config
      if (values.modelConfig) {
        updates.model_config = {
          ...values.modelConfig,
          updated_at: new Date().toISOString(),
        };
      }

      // Update permission config
      if (values.permissionMode) {
        updates.permission_config = {
          ...session.permission_config,
          mode: values.permissionMode,
        };
      }

      // Update URLs
      if (values.issue_url !== session.issue_url) {
        updates.issue_url = values.issue_url || undefined;
      }
      if (values.pull_request_url !== session.pull_request_url) {
        updates.pull_request_url = values.pull_request_url || undefined;
      }

      // Update custom context (parse JSON)
      if (values.custom_context) {
        try {
          const parsedContext = JSON.parse(values.custom_context);
          updates.custom_context = parsedContext;
        } catch (error) {
          console.error('Failed to parse custom context JSON:', error);
          // Don't update if JSON is invalid
        }
      } else if (values.custom_context === '') {
        // Empty string = remove custom context
        updates.custom_context = undefined;
      }

      // Apply session updates if any
      if (Object.keys(updates).length > 0 && onUpdate) {
        onUpdate(session.session_id, updates);
      }

      // Backward compatibility: also call onUpdateModelConfig if provided
      if (values.modelConfig && onUpdateModelConfig) {
        onUpdateModelConfig(session.session_id, values.modelConfig);
      }

      // Update MCP server attachments
      if (onUpdateSessionMcpServers) {
        onUpdateSessionMcpServers(session.session_id, values.mcpServerIds || []);
      }

      onClose();
    });
  };

  const handleCancel = () => {
    form.resetFields();
    onClose();
  };

  return (
    <Modal
      title="Session Settings"
      open={open}
      onOk={handleOk}
      onCancel={handleCancel}
      okText="Save"
      cancelText="Cancel"
      width={600}
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          title: session.description || '',
          mcpServerIds: sessionMcpServerIds,
          modelConfig: session.model_config,
          permissionMode:
            session.permission_config?.mode ||
            (session.agentic_tool === 'codex' ? 'auto' : 'acceptEdits'),
          issue_url: session.issue_url || '',
          pull_request_url: session.pull_request_url || '',
          custom_context: session.custom_context
            ? JSON.stringify(session.custom_context, null, 2)
            : '',
        }}
      >
        <Form.Item
          label="Title"
          name="title"
          rules={[{ required: false, message: 'Please enter a session title' }]}
        >
          <Input placeholder="Enter session title" />
        </Form.Item>

        <Form.Item
          label="Issue URL"
          name="issue_url"
          rules={[{ type: 'url', message: 'Please enter a valid URL' }]}
        >
          <Input placeholder="https://github.com/org/repo/issues/123" />
        </Form.Item>

        <Form.Item
          label="Pull Request URL"
          name="pull_request_url"
          rules={[{ type: 'url', message: 'Please enter a valid URL' }]}
        >
          <Input placeholder="https://github.com/org/repo/pull/456" />
        </Form.Item>

        <Form.Item
          label="Custom Context (JSON)"
          name="custom_context"
          help="Add custom fields for use in zone trigger templates (e.g., {{ session.context.yourField }})"
          rules={[{ validator: validateJSON }]}
        >
          <JSONEditor placeholder='{"teamName": "Backend", "sprintNumber": 42}' rows={4} />
        </Form.Item>

        <Form.Item
          name="modelConfig"
          label={session.agentic_tool === 'codex' ? 'Codex Model' : 'Claude Model'}
        >
          <ModelSelector agentic_tool={session.agentic_tool} />
        </Form.Item>

        <Form.Item
          name="permissionMode"
          label="Permission Mode"
          help="Control how the agentic tool handles tool execution approvals"
        >
          <PermissionModeSelector agentic_tool={session.agentic_tool} />
        </Form.Item>

        <Divider />

        <Form.Item name="mcpServerIds" label="MCP Servers">
          <MCPServerSelect mcpServers={mcpServers} placeholder="No MCP servers attached" />
        </Form.Item>
      </Form>
    </Modal>
  );
};
