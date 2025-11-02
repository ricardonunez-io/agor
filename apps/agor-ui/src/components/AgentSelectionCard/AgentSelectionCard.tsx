import { CheckCircleOutlined, DownloadOutlined } from '@ant-design/icons';
import { Button, Card, Space, Tag, Typography } from 'antd';
import { ToolIcon } from '../ToolIcon';

// UI-only type for agent selection (different from AgenticTool which has UUIDv7 ID)
interface AgenticToolOption {
  id: string; // AgenticToolName as string
  name: string;
  icon: string;
  installed?: boolean;
  installable?: boolean;
  version?: string;
  description?: string;
}

export interface AgentSelectionCardProps {
  agent: AgenticToolOption;
  selected?: boolean;
  onClick?: () => void;
  onInstall?: () => void;
}

export const AgentSelectionCard: React.FC<AgentSelectionCardProps> = ({
  agent,
  selected = false,
  onClick,
  onInstall,
}) => {
  // Treat agents as available by default unless explicitly marked as not installed
  const isDisabled = agent.installed === false;

  return (
    <Card
      hoverable={!isDisabled}
      onClick={isDisabled ? undefined : onClick}
      style={{
        borderColor: selected ? '#1890ff' : undefined,
        borderWidth: selected ? 2 : 1,
        cursor: isDisabled ? 'not-allowed' : 'pointer',
        opacity: isDisabled ? 0.6 : 1,
      }}
      styles={{
        body: { padding: 12 },
      }}
    >
      <Space direction="vertical" style={{ width: '100%' }} size={4}>
        <Space style={{ width: '100%', justifyContent: 'space-between' }} size={8}>
          <Space size={8}>
            <ToolIcon tool={agent.id} size={24} />
            <Typography.Text strong style={{ fontSize: '14px' }}>
              {agent.name}
            </Typography.Text>
            {agent.installed === false && (
              <Tag color="orange" style={{ fontSize: '11px', padding: '0 6px' }}>
                COMING SOON
              </Tag>
            )}
          </Space>
          {!agent.installed && agent.installable && (
            <Button
              type="text"
              size="small"
              icon={<DownloadOutlined />}
              onClick={e => {
                e.stopPropagation();
                onInstall?.();
              }}
            >
              Install
            </Button>
          )}
        </Space>

        {agent.version && (
          <Typography.Text type="secondary" style={{ fontSize: '11px' }}>
            Version: {agent.version}
          </Typography.Text>
        )}

        {agent.description && (
          <Typography.Text type="secondary" style={{ fontSize: '12px' }}>
            {agent.description}
          </Typography.Text>
        )}
      </Space>
    </Card>
  );
};
