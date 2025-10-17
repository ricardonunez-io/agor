import {
  BranchesOutlined,
  ForkOutlined,
  LoadingOutlined,
  MessageOutlined,
  ToolOutlined,
} from '@ant-design/icons';
import { Badge, Space, Spin, Tag, Typography, theme } from 'antd';
import type { Session } from '../../types';

const { Text } = Typography;

interface SessionHeaderProps {
  session: Session;
  onClick?: () => void;
  showCounts?: boolean;
}

const SessionHeader = ({ session, onClick, showCounts = true }: SessionHeaderProps) => {
  const { token } = theme.useToken();

  const getStatusColor = () => {
    switch (session.status) {
      case 'running':
        return 'processing';
      case 'completed':
        return 'success';
      case 'failed':
        return 'error';
      default:
        return 'default';
    }
  };

  const getAgentIcon = () => {
    const agentIcons: Record<string, string> = {
      'claude-code': '🤖',
      cursor: '✏️',
      codex: '💻',
      gemini: '💎',
    };
    return agentIcons[session.agentic_tool] || '🤖';
  };

  const isForked = !!session.genealogy.forked_from_session_id;
  const isSpawned = !!session.genealogy.parent_session_id;

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: UI prototype - keyboard events will be added in production
    // biome-ignore lint/a11y/noStaticElementInteractions: UI prototype - proper semantics will be added in production
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: token.sizeUnit,
        padding: token.sizeUnit * 1.5,
        borderRadius: token.borderRadius,
        background: token.colorBgContainer,
        transition: 'all 0.2s',
        cursor: onClick ? 'pointer' : 'default',
      }}
      onMouseEnter={e => {
        if (onClick) {
          e.currentTarget.style.background = token.colorBgElevated;
          e.currentTarget.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.08)';
        }
      }}
      onMouseLeave={e => {
        if (onClick) {
          e.currentTarget.style.background = token.colorBgContainer;
          e.currentTarget.style.boxShadow = 'none';
        }
      }}
      onClick={onClick}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Space size={token.sizeUnit} align="center">
          <span style={{ fontSize: 20, lineHeight: 1 }}>{getAgentIcon()}</span>
          <Text strong style={{ textTransform: 'capitalize' }}>
            {session.agentic_tool}
          </Text>
          {session.status === 'running' ? (
            <Spin indicator={<LoadingOutlined spin style={{ fontSize: 12 }} />} />
          ) : (
            <Badge status={getStatusColor()} text={session.status.toUpperCase()} />
          )}
        </Space>

        <Space size={token.sizeUnit / 2}>
          {isForked && (
            <Tag
              icon={<ForkOutlined />}
              color="cyan"
              style={{ fontSize: 10, padding: '0 6px', lineHeight: '18px' }}
            >
              FORK
            </Tag>
          )}
          {isSpawned && (
            <Tag
              icon={<BranchesOutlined />}
              color="purple"
              style={{ fontSize: 10, padding: '0 6px', lineHeight: '18px' }}
            >
              SPAWN
            </Tag>
          )}
        </Space>
      </div>

      {session.description && (
        <Text style={{ fontSize: 14, fontWeight: 500 }} ellipsis={{ tooltip: session.description }}>
          {session.description}
        </Text>
      )}

      {showCounts && (
        <Space size={token.sizeUnit * 1.5} style={{ marginTop: token.sizeUnit / 2 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            📋 {session.tasks.length}
          </Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            <MessageOutlined /> {session.message_count}
          </Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            <ToolOutlined /> {session.tool_use_count}
          </Text>
        </Space>
      )}
    </div>
  );
};

export default SessionHeader;
