import type { PermissionMode } from '@agor/core/types';
import {
  EditOutlined,
  ExperimentOutlined,
  LockOutlined,
  SafetyOutlined,
  UnlockOutlined,
} from '@ant-design/icons';
import { Radio, Select, Space, Typography } from 'antd';

const { Text } = Typography;

export interface PermissionModeSelectorProps {
  value?: PermissionMode;
  onChange?: (value: PermissionMode) => void;
  agentic_tool?: 'claude-code' | 'cursor' | 'codex' | 'gemini';
  /** If true, renders as a compact Select dropdown instead of Radio buttons */
  compact?: boolean;
  /** Size for compact mode */
  size?: 'small' | 'middle' | 'large';
  /** Width for compact mode */
  width?: number;
}

// Claude Code permission modes (Claude Agent SDK)
const CLAUDE_CODE_MODES: {
  mode: PermissionMode;
  label: string;
  description: string;
  icon: React.ReactNode;
  color: string;
}[] = [
  {
    mode: 'default',
    label: 'Ask',
    description: 'Prompt for each tool use (most restrictive)',
    icon: <LockOutlined />,
    color: '#f5222d', // Red
  },
  {
    mode: 'acceptEdits',
    label: 'Auto-accept edits',
    description: 'Auto-accept file edits, ask for other tools (recommended)',
    icon: <EditOutlined />,
    color: '#52c41a', // Green
  },
  {
    mode: 'bypassPermissions',
    label: 'Allow all',
    description: 'Allow all operations without prompting',
    icon: <UnlockOutlined />,
    color: '#faad14', // Orange/yellow
  },
  {
    mode: 'plan',
    label: 'Plan mode',
    description: 'Generate plan without executing',
    icon: <ExperimentOutlined />,
    color: '#1890ff', // Blue
  },
];

// Codex permission modes (OpenAI Codex SDK)
const CODEX_MODES: {
  mode: PermissionMode;
  label: string;
  description: string;
  icon: React.ReactNode;
  color: string;
}[] = [
  {
    mode: 'ask',
    label: 'Untrusted',
    description: 'Read-only mode: View code and suggest changes only',
    icon: <LockOutlined />,
    color: '#f5222d', // Red
  },
  {
    mode: 'auto',
    label: 'On Request',
    description: 'Auto-edit mode: Create/edit files, ask for shell commands',
    icon: <SafetyOutlined />,
    color: '#52c41a', // Green
  },
  {
    mode: 'on-failure',
    label: 'On Failure',
    description: 'Auto-approve all, ask only when commands fail',
    icon: <EditOutlined />,
    color: '#faad14', // Orange/yellow
  },
  {
    mode: 'allow-all',
    label: 'Never',
    description: 'Full-auto mode: No approval needed',
    icon: <UnlockOutlined />,
    color: '#722ed1', // Purple
  },
];

export const PermissionModeSelector: React.FC<PermissionModeSelectorProps> = ({
  value = 'auto',
  onChange,
  agentic_tool = 'claude-code',
  compact = false,
  size = 'middle',
  width = 200,
}) => {
  // Select modes based on agentic tool type
  const modes = agentic_tool === 'codex' ? CODEX_MODES : CLAUDE_CODE_MODES;

  // Get default value based on agentic tool type
  const defaultValue = agentic_tool === 'codex' ? 'auto' : 'acceptEdits';
  const effectiveValue = value || defaultValue;

  // Compact mode: render as Select dropdown
  if (compact) {
    return (
      <Select
        value={effectiveValue}
        onChange={onChange}
        style={{ width }}
        size={size}
        suffixIcon={<SafetyOutlined />}
        options={modes.map(({ mode, label, description }) => ({
          label,
          value: mode,
          title: description,
        }))}
      />
    );
  }

  // Full mode: render as Radio group with descriptions
  return (
    <Radio.Group value={effectiveValue} onChange={e => onChange?.(e.target.value)}>
      <Space direction="vertical" style={{ width: '100%' }}>
        {modes.map(({ mode, label, description, icon, color }) => (
          <Radio key={mode} value={mode}>
            <Space>
              <span style={{ color }}>{icon}</span>
              <div>
                <Text strong>{label}</Text>
                <br />
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {description}
                </Text>
              </div>
            </Space>
          </Radio>
        ))}
      </Space>
    </Radio.Group>
  );
};
