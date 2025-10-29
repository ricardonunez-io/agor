/**
 * Welcome Modal - Onboarding flow for new users
 *
 * Shows different content based on system state:
 * - Empty: Guide user to add first repo/worktree/session
 * - Active: Welcome message showing existing resources
 * - Partial: Show what's done + what's next
 */

import {
  BorderOutlined,
  CheckCircleOutlined,
  InfoCircleOutlined,
  PlusOutlined,
  RocketOutlined,
} from '@ant-design/icons';
import { Button, Modal, Space, Typography } from 'antd';

const { Title, Text, Paragraph } = Typography;

export interface SystemStats {
  repoCount: number;
  worktreeCount: number;
  sessionCount: number;
}

export interface WelcomeModalProps {
  open: boolean;
  onClose: () => void;
  stats: SystemStats;
  onAddRepo: () => void;
  onCreateWorktree: () => void;
  onNewSession: () => void;
  onDismiss: () => void; // Mark onboarding as completed
}

export const WelcomeModal: React.FC<WelcomeModalProps> = ({
  open,
  onClose,
  stats,
  onAddRepo,
  onCreateWorktree,
  onNewSession,
  onDismiss,
}) => {
  const isEmpty = stats.repoCount === 0 && stats.worktreeCount === 0 && stats.sessionCount === 0;
  const isActive = stats.sessionCount > 0;
  const _isPartial = !isEmpty && !isActive;

  const handleDismiss = () => {
    onDismiss();
    onClose();
  };

  // Empty system - first user experience
  if (isEmpty) {
    return (
      <Modal open={open} onCancel={onClose} footer={null} width={600} centered closable={true}>
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <Title level={3}>
            <RocketOutlined /> Welcome to Agor!
          </Title>

          <Paragraph>Let's get you started in 3 steps:</Paragraph>

          {/* Step 1: Add Repository */}
          <Space direction="vertical" size="small" style={{ width: '100%' }}>
            <Space>
              <div
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: '50%',
                  border: '2px solid #1890ff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 12,
                  fontWeight: 'bold',
                }}
              >
                1
              </div>
              <Text strong>Add your first repository</Text>
            </Space>
            <Paragraph type="secondary" style={{ marginLeft: 32, marginBottom: 8 }}>
              Connect a git repo to track AI coding work
            </Paragraph>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => {
                onClose();
                onAddRepo();
              }}
              style={{ marginLeft: 32 }}
            >
              Add Repository
            </Button>
          </Space>

          {/* Step 2: Create Worktree */}
          <Space direction="vertical" size="small" style={{ width: '100%' }}>
            <Space>
              <div
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: '50%',
                  border: '2px solid rgba(255,255,255,0.3)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 12,
                  color: 'rgba(255,255,255,0.5)',
                }}
              >
                2
              </div>
              <Text type="secondary">Create a worktree</Text>
            </Space>
            <Paragraph type="secondary" style={{ marginLeft: 32, marginBottom: 0 }}>
              Isolated workspace for parallel development.{' '}
              <a
                href="https://agor.live/guide/concepts#-worktrees"
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontSize: 12 }}
              >
                Learn more
              </a>
            </Paragraph>
            <Text type="secondary" style={{ marginLeft: 32, fontSize: 12 }}>
              (Available after adding a repo)
            </Text>
          </Space>

          {/* Step 3: Start Session */}
          <Space direction="vertical" size="small" style={{ width: '100%' }}>
            <Space>
              <div
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: '50%',
                  border: '2px solid rgba(255,255,255,0.3)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 12,
                  color: 'rgba(255,255,255,0.5)',
                }}
              >
                3
              </div>
              <Text type="secondary">Start your first session</Text>
            </Space>
            <Paragraph type="secondary" style={{ marginLeft: 32, marginBottom: 0 }}>
              Begin an AI coding session on your board
            </Paragraph>
            <Text type="secondary" style={{ marginLeft: 32, fontSize: 12 }}>
              (Available after creating a worktree)
            </Text>
          </Space>

          {/* Configure Integrations - Informational step */}
          <Space
            direction="vertical"
            size="small"
            style={{
              width: '100%',
              borderTop: '1px solid rgba(255, 255, 255, 0.1)',
              paddingTop: 16,
              marginTop: 8,
            }}
          >
            <Space>
              <InfoCircleOutlined style={{ color: '#1890ff', fontSize: 20 }} />
              <Text strong>Configure Integrations</Text>
            </Space>
            <Paragraph type="secondary" style={{ marginLeft: 32, marginBottom: 0 }}>
              Set up API keys for Claude Code, Codex, or Gemini:
              <br />• Settings → API Keys
              <br />• Or use <Text code>agor config set</Text> in your terminal
            </Paragraph>
          </Space>

          <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
            <Button type="primary" onClick={handleDismiss}>
              Get Started
            </Button>
          </Space>
        </Space>
      </Modal>
    );
  }

  // Active team - has existing sessions
  if (isActive) {
    return (
      <Modal open={open} onCancel={onClose} footer={null} width={500} centered closable={true}>
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <Title level={3}>
            <RocketOutlined /> Welcome to Agor!
          </Title>

          <Paragraph>Your team is already set up:</Paragraph>

          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <Space align="start">
              <CheckCircleOutlined style={{ color: '#52c41a', fontSize: 20 }} />
              <div>
                <Text strong>{stats.repoCount} repositories configured</Text>
                <br />
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Browse available repos in the sidebar
                </Text>
              </div>
            </Space>

            <Space align="start">
              <CheckCircleOutlined style={{ color: '#52c41a', fontSize: 20 }} />
              <div>
                <Text strong>{stats.worktreeCount} worktrees active</Text>
                <br />
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Isolated workspaces for different features
                </Text>
              </div>
            </Space>

            <Space align="start">
              <CheckCircleOutlined style={{ color: '#52c41a', fontSize: 20 }} />
              <div>
                <Text strong>{stats.sessionCount} sessions running</Text>
                <br />
                <Text type="secondary" style={{ fontSize: 12 }}>
                  AI coding sessions on the board
                </Text>
              </div>
            </Space>
          </Space>

          <Paragraph type="secondary" style={{ marginTop: 8 }}>
            You can start using existing resources or create your own!
          </Paragraph>

          <Space style={{ width: '100%', justifyContent: 'space-between' }}>
            <Button type="link" href="https://agor.live/guide/getting-started" target="_blank">
              View Documentation
            </Button>
            <Button type="primary" onClick={handleDismiss}>
              Get Started
            </Button>
          </Space>
        </Space>
      </Modal>
    );
  }

  // Partial setup - has repos/worktrees but no sessions
  return (
    <Modal open={open} onCancel={onClose} footer={null} width={550} centered closable={true}>
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <Title level={3}>
          <RocketOutlined /> Welcome to Agor!
        </Title>

        <Paragraph>Your workspace:</Paragraph>

        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          {stats.repoCount > 0 && (
            <Space align="start">
              <CheckCircleOutlined style={{ color: '#52c41a', fontSize: 20 }} />
              <div>
                <Text strong>{stats.repoCount} repositories configured</Text>
                <br />
                <Text type="secondary" style={{ fontSize: 12 }}>
                  You have repos ready to work with
                </Text>
              </div>
            </Space>
          )}

          {stats.worktreeCount > 0 ? (
            <Space align="start">
              <CheckCircleOutlined style={{ color: '#52c41a', fontSize: 20 }} />
              <div>
                <Text strong>{stats.worktreeCount} worktrees active</Text>
                <br />
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Isolated workspaces ready for sessions
                </Text>
              </div>
            </Space>
          ) : (
            <Space direction="vertical" size="small" style={{ width: '100%' }}>
              <Space>
                <BorderOutlined style={{ color: '#ff4d4f', fontSize: 20 }} />
                <Text strong>Create a worktree</Text>
              </Space>
              <Paragraph type="secondary" style={{ marginLeft: 32, marginBottom: 8 }}>
                Isolated workspace for features
              </Paragraph>
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => {
                  onClose();
                  onCreateWorktree();
                }}
                style={{ marginLeft: 32 }}
              >
                Create Worktree
              </Button>
            </Space>
          )}

          {stats.sessionCount === 0 && (
            <Space direction="vertical" size="small" style={{ width: '100%' }}>
              <Space>
                <BorderOutlined style={{ color: '#ff4d4f', fontSize: 20 }} />
                <Text strong>Start your first session</Text>
              </Space>
              {stats.worktreeCount > 0 ? (
                <Paragraph type="secondary" style={{ marginLeft: 32, marginBottom: 8 }}>
                  Click the <Text strong>"Create Session"</Text> button on your worktree card on the
                  board
                </Paragraph>
              ) : (
                <Paragraph type="secondary" style={{ marginLeft: 32, marginBottom: 8 }}>
                  Available after creating a worktree
                </Paragraph>
              )}
            </Space>
          )}
        </Space>

        <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
          <Button type="primary" onClick={handleDismiss}>
            Get Started
          </Button>
        </Space>
      </Space>
    </Modal>
  );
};
