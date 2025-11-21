import type { AgenticToolName, MCPServer, UpdateUserInput, User } from '@agor/core/types';
import {
  Button,
  Flex,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Switch,
  Tabs,
  Tag,
  Typography,
} from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { AgenticToolConfigForm } from '../AgenticToolConfigForm';
import { ApiKeyFields, type ApiKeyStatus } from '../ApiKeyFields';
import { FormEmojiPickerInput } from '../EmojiPickerInput';
import { EnvVarEditor } from '../EnvVarEditor';
import { AudioSettingsTab } from '../SettingsModal/AudioSettingsTab';

export interface UserSettingsModalProps {
  open: boolean;
  onClose: () => void;
  user: User | null;
  mcpServerById: Map<string, MCPServer>;
  onUpdate?: (userId: string, updates: UpdateUserInput) => void;
}

export const UserSettingsModal: React.FC<UserSettingsModalProps> = ({
  open,
  onClose,
  user,
  mcpServerById,
  onUpdate,
}) => {
  const [form] = Form.useForm();
  const [activeTab, setActiveTab] = useState<string>('general');

  // Separate forms for each agentic tool tab
  const [claudeForm] = Form.useForm();
  const [codexForm] = Form.useForm();
  const [geminiForm] = Form.useForm();
  const [opencodeForm] = Form.useForm();
  const [audioForm] = Form.useForm();

  // API key management state
  const [apiKeyStatus, setApiKeyStatus] = useState<ApiKeyStatus>({
    ANTHROPIC_API_KEY: false,
    OPENAI_API_KEY: false,
    GEMINI_API_KEY: false,
  });
  const [savingApiKeys, setSavingApiKeys] = useState<Record<string, boolean>>({});

  // Environment variable management state
  const [envVars, setEnvVars] = useState<Record<string, boolean>>({});
  const [savingEnvVars, setSavingEnvVars] = useState<Record<string, boolean>>({});

  // Saving state for agentic tool tabs
  const [savingAgenticConfig, setSavingAgenticConfig] = useState<Record<AgenticToolName, boolean>>({
    'claude-code': false,
    codex: false,
    gemini: false,
    opencode: false,
  });

  // Load user data into form when user changes or modal opens
  useEffect(() => {
    if (user && open) {
      form.setFieldsValue({
        email: user.email,
        name: user.name,
        emoji: user.emoji,
        role: user.role,
        eventStreamEnabled: user.preferences?.eventStreamEnabled ?? false,
      });

      // Load API keys status
      if (user.api_keys) {
        setApiKeyStatus({
          ANTHROPIC_API_KEY: !!user.api_keys.ANTHROPIC_API_KEY,
          OPENAI_API_KEY: !!user.api_keys.OPENAI_API_KEY,
          GEMINI_API_KEY: !!user.api_keys.GEMINI_API_KEY,
        });
      }

      // Load env vars
      if (user.env_vars) {
        const vars: Record<string, boolean> = {};
        for (const key of Object.keys(user.env_vars)) {
          vars[key] = true;
        }
        setEnvVars(vars);
      }

      // Load agentic tool configs
      if (user.preferences?.agenticTools) {
        const tools = user.preferences.agenticTools;
        if (tools['claude-code']) {
          claudeForm.setFieldsValue(tools['claude-code']);
        }
        if (tools.codex) {
          codexForm.setFieldsValue(tools.codex);
        }
        if (tools.gemini) {
          geminiForm.setFieldsValue(tools.gemini);
        }
        if (tools.opencode) {
          opencodeForm.setFieldsValue(tools.opencode);
        }
      }

      // Load audio settings
      if (user.preferences?.audioSettings) {
        audioForm.setFieldsValue(user.preferences.audioSettings);
      }
    }
  }, [user, open, form, claudeForm, codexForm, geminiForm, opencodeForm, audioForm]);

  const handleApiKeySave = useCallback(
    async (keyName: string, value: string) => {
      if (!user) return;
      setSavingApiKeys((prev) => ({ ...prev, [keyName]: true }));
      try {
        onUpdate?.(user.user_id, {
          api_keys: { ...user.api_keys, [keyName]: value },
        });
        setApiKeyStatus((prev) => ({ ...prev, [keyName]: true }));
      } finally {
        setSavingApiKeys((prev) => ({ ...prev, [keyName]: false }));
      }
    },
    [user, onUpdate]
  );

  const handleApiKeyClear = useCallback(
    async (keyName: string) => {
      if (!user) return;
      const updatedKeys = { ...user.api_keys };
      delete updatedKeys[keyName];
      onUpdate?.(user.user_id, {
        api_keys: updatedKeys,
      });
      setApiKeyStatus((prev) => ({ ...prev, [keyName]: false }));
    },
    [user, onUpdate]
  );

  const handleEnvVarSave = useCallback(
    async (key: string, value: string) => {
      if (!user) return;
      setSavingEnvVars((prev) => ({ ...prev, [key]: true }));
      try {
        onUpdate?.(user.user_id, {
          env_vars: { ...user.env_vars, [key]: value },
        });
        setEnvVars((prev) => ({ ...prev, [key]: true }));
      } finally {
        setSavingEnvVars((prev) => ({ ...prev, [key]: false }));
      }
    },
    [user, onUpdate]
  );

  const handleEnvVarDelete = useCallback(
    async (key: string) => {
      if (!user) return;
      const updatedVars = { ...user.env_vars };
      delete updatedVars[key];
      onUpdate?.(user.user_id, {
        env_vars: updatedVars,
      });
      setEnvVars((prev) => {
        const updated = { ...prev };
        delete updated[key];
        return updated;
      });
    },
    [user, onUpdate]
  );

  const handleAgenticConfigClear = useCallback(
    (tool: AgenticToolName) => {
      if (!user) return;
      const updatedAgenticTools = { ...user.preferences?.agenticTools };
      delete updatedAgenticTools[tool];
      onUpdate?.(user.user_id, {
        preferences: {
          ...user.preferences,
          agenticTools: updatedAgenticTools,
        },
      });
      // Clear the form
      if (tool === 'claude-code') claudeForm.resetFields();
      else if (tool === 'codex') codexForm.resetFields();
      else if (tool === 'gemini') geminiForm.resetFields();
      else if (tool === 'opencode') opencodeForm.resetFields();
    },
    [user, onUpdate, claudeForm, codexForm, geminiForm, opencodeForm]
  );

  const handleAgenticConfigSave = useCallback(
    async (tool: AgenticToolName) => {
      if (!user) return;
      setSavingAgenticConfig((prev) => ({ ...prev, [tool]: true }));
      try {
        let values = {};
        if (tool === 'claude-code') {
          values = await claudeForm.validateFields();
        } else if (tool === 'codex') {
          values = await codexForm.validateFields();
        } else if (tool === 'gemini') {
          values = await geminiForm.validateFields();
        } else if (tool === 'opencode') {
          values = await opencodeForm.validateFields();
        }

        onUpdate?.(user.user_id, {
          preferences: {
            ...user.preferences,
            agenticTools: {
              ...user.preferences?.agenticTools,
              [tool]: values,
            },
          },
        });
      } catch (err) {
        console.error(`Failed to save ${tool} config:`, err);
        throw err;
      } finally {
        setSavingAgenticConfig((prev) => ({ ...prev, [tool]: false }));
      }
    },
    [user, onUpdate, claudeForm, codexForm, geminiForm, opencodeForm]
  );

  const handleAudioSave = useCallback(async () => {
    if (!user) return;
    try {
      const values = await audioForm.validateFields();
      const updatedPreferences = {
        ...user.preferences,
        audioSettings: values,
      };

      onUpdate?.(user.user_id, {
        preferences: updatedPreferences,
      });
    } catch (error) {
      console.error('Failed to save audio settings:', error);
    }
  }, [user, onUpdate, audioForm]);

  const handleModalSave = async () => {
    if (!user) return;

    switch (activeTab) {
      case 'general':
        form
          .validateFields()
          .then((values) => {
            const updates: UpdateUserInput = {
              name: values.name,
              email: values.email,
              emoji: values.emoji,
              role: values.role,
              preferences: {
                ...user.preferences,
                eventStreamEnabled: values.eventStreamEnabled,
              },
            };
            if (values.password) {
              updates.password = values.password;
            }
            onUpdate?.(user.user_id, updates);
            form.resetFields();
            onClose();
          })
          .catch((err) => {
            console.error('Validation failed:', err);
          });
        break;
      case 'api-keys':
        // API Keys tab - nothing to save (keys save individually)
        onClose();
        break;
      case 'env-vars':
        // Env Vars tab - nothing to save (vars save individually)
        onClose();
        break;
      case 'audio':
        await handleAudioSave();
        onClose();
        break;
      case 'claude-code':
        await handleAgenticConfigSave('claude-code');
        onClose();
        break;
      case 'codex':
        await handleAgenticConfigSave('codex');
        onClose();
        break;
      case 'gemini':
        await handleAgenticConfigSave('gemini');
        onClose();
        break;
      case 'opencode':
        await handleAgenticConfigSave('opencode');
        onClose();
        break;
    }
  };

  const handleCancel = () => {
    form.resetFields();
    setActiveTab('general');
    onClose();
  };

  if (!user) return null;

  return (
    <Modal
      title="User Settings"
      open={open}
      onOk={handleModalSave}
      onCancel={handleCancel}
      okText="Save"
      cancelText="Close"
      confirmLoading={
        activeTab === 'claude-code'
          ? savingAgenticConfig['claude-code']
          : activeTab === 'codex'
            ? savingAgenticConfig.codex
            : activeTab === 'gemini'
              ? savingAgenticConfig.gemini
              : false
      }
      width={900}
      styles={{
        body: {
          height: '500px',
          overflowY: 'auto',
        },
      }}
    >
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        style={{ marginTop: 16 }}
        items={[
          {
            key: 'general',
            label: 'General',
            children: (
              <Form form={form} layout="vertical" style={{ paddingTop: 8 }}>
                <Form.Item label="Name" style={{ marginBottom: 24 }}>
                  <Flex gap={8}>
                    <Form.Item name="emoji" noStyle>
                      <FormEmojiPickerInput form={form} fieldName="emoji" defaultEmoji="👤" />
                    </Form.Item>
                    <Form.Item name="name" noStyle style={{ flex: 1 }}>
                      <Input placeholder="John Doe" style={{ flex: 1 }} />
                    </Form.Item>
                  </Flex>
                </Form.Item>

                <Form.Item
                  label="Email"
                  name="email"
                  rules={[
                    { required: true, message: 'Please enter an email' },
                    { type: 'email', message: 'Please enter a valid email' },
                  ]}
                >
                  <Input placeholder="user@example.com" />
                </Form.Item>

                <Form.Item
                  label="Password"
                  name="password"
                  help="Leave blank to keep current password"
                >
                  <Input.Password placeholder="••••••••" />
                </Form.Item>

                <Form.Item
                  label={
                    <Space size={4}>
                      Enable Live Event Stream
                      <Tag color="blue" style={{ fontSize: 10, marginLeft: 4 }}>
                        BETA
                      </Tag>
                    </Space>
                  }
                  name="eventStreamEnabled"
                  valuePropName="checked"
                  tooltip="Show/hide the event stream icon in the navbar. When enabled, you can view live WebSocket events for debugging."
                >
                  <Switch />
                </Form.Item>

                <Form.Item
                  label="Role"
                  name="role"
                  rules={[{ required: true, message: 'Please select a role' }]}
                >
                  <Select>
                    <Select.Option value="owner">Owner</Select.Option>
                    <Select.Option value="admin">Admin</Select.Option>
                    <Select.Option value="member">Member</Select.Option>
                    <Select.Option value="viewer">Viewer</Select.Option>
                  </Select>
                </Form.Item>
              </Form>
            ),
          },
          {
            key: 'api-keys',
            label: 'API Keys',
            children: (
              <div style={{ paddingTop: 8 }}>
                <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
                  Per-user API keys take precedence over global settings. These keys are encrypted
                  at rest.
                </Typography.Paragraph>
                <ApiKeyFields
                  keyStatus={apiKeyStatus}
                  onSave={handleApiKeySave}
                  onClear={handleApiKeyClear}
                  saving={savingApiKeys}
                />
              </div>
            ),
          },
          {
            key: 'env-vars',
            label: 'Env Vars',
            children: (
              <div style={{ paddingTop: 8 }}>
                <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
                  Environment variables are encrypted at rest and available to all sessions for this
                  user.
                </Typography.Paragraph>
                <EnvVarEditor
                  envVars={envVars}
                  onSave={handleEnvVarSave}
                  onDelete={handleEnvVarDelete}
                  loading={savingEnvVars}
                />
              </div>
            ),
          },
          {
            key: 'audio',
            label: 'Audio',
            children: (
              <div style={{ paddingTop: 8 }}>
                <AudioSettingsTab user={user} form={audioForm} />
              </div>
            ),
          },
          {
            key: 'claude-code',
            label: 'Claude Code',
            children: (
              <div style={{ paddingTop: 8 }}>
                <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
                  Configure default settings for Claude Code. These will prepopulate session
                  creation forms.
                </Typography.Paragraph>
                <Form form={claudeForm} layout="vertical">
                  <AgenticToolConfigForm
                    agenticTool="claude-code"
                    mcpServerById={mcpServerById}
                    showHelpText={false}
                  />
                </Form>
                <div style={{ marginTop: 16 }}>
                  <Button onClick={() => handleAgenticConfigClear('claude-code')}>
                    Clear Defaults
                  </Button>
                </div>
              </div>
            ),
          },
          {
            key: 'codex',
            label: 'Codex',
            children: (
              <div style={{ paddingTop: 8 }}>
                <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
                  Configure default settings for Codex. These will prepopulate session creation
                  forms.
                </Typography.Paragraph>
                <Form form={codexForm} layout="vertical">
                  <AgenticToolConfigForm
                    agenticTool="codex"
                    mcpServerById={mcpServerById}
                    showHelpText={false}
                  />
                </Form>
                <div style={{ marginTop: 16 }}>
                  <Button onClick={() => handleAgenticConfigClear('codex')}>Clear Defaults</Button>
                </div>
              </div>
            ),
          },
          {
            key: 'gemini',
            label: 'Gemini',
            children: (
              <div style={{ paddingTop: 8 }}>
                <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
                  Configure default settings for Gemini. These will prepopulate session creation
                  forms.
                </Typography.Paragraph>
                <Form form={geminiForm} layout="vertical">
                  <AgenticToolConfigForm
                    agenticTool="gemini"
                    mcpServerById={mcpServerById}
                    showHelpText={false}
                  />
                </Form>
                <div style={{ marginTop: 16 }}>
                  <Button onClick={() => handleAgenticConfigClear('gemini')}>Clear Defaults</Button>
                </div>
              </div>
            ),
          },
        ]}
      />
    </Modal>
  );
};
