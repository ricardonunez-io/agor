import type { AgorClient } from '@agor/core/api';
import type { Worktree } from '@agor/core/types';
import { ReloadOutlined } from '@ant-design/icons';
import Ansi from 'ansi-to-react';
import { Alert, Button, Checkbox, Modal, Space, Typography, theme } from 'antd';
import { useCallback, useEffect, useRef, useState } from 'react';

const { Text } = Typography;

interface BuildLogsModalProps {
  open: boolean;
  onClose: () => void;
  worktree: Worktree;
  client: AgorClient | null;
}

interface BuildLogsResponse {
  logs: string;
  exists: boolean;
  path: string;
}

export const BuildLogsModal: React.FC<BuildLogsModalProps> = ({
  open,
  onClose,
  worktree,
  client,
}) => {
  const { token } = theme.useToken();
  const [logs, setLogs] = useState<BuildLogsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const logsContainerRef = useRef<HTMLDivElement>(null);
  const logsRef = useRef<BuildLogsResponse | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchLogs = useCallback(
    async (autoScroll = true) => {
      if (!client) return;

      setLoading(true);
      setError(null);

      try {
        const data = (await client.service('worktrees/build-logs').find({
          query: {
            worktree_id: worktree.worktree_id,
          },
        })) as unknown as BuildLogsResponse;

        // Only update and scroll if logs changed
        const logsChanged = data.logs !== logsRef.current?.logs;
        logsRef.current = data;
        setLogs(data);

        // Scroll to bottom after fetching (only if logs changed and autoScroll enabled)
        if (autoScroll && logsChanged) {
          setTimeout(() => {
            logsContainerRef.current?.scrollTo({
              top: logsContainerRef.current.scrollHeight,
              behavior: 'smooth',
            });
          }, 100);
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to fetch build logs');
      } finally {
        setLoading(false);
      }
    },
    [client, worktree.worktree_id]
  );

  // Fetch logs when modal opens
  useEffect(() => {
    if (open) {
      fetchLogs();
    } else {
      setLogs(null);
      setError(null);
      logsRef.current = null;
    }
  }, [open, fetchLogs]);

  // Auto-refresh interval
  useEffect(() => {
    // Clear any existing interval
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    // Set up new interval if auto-refresh is enabled and modal is open
    if (autoRefresh && open) {
      intervalRef.current = setInterval(() => {
        fetchLogs(true);
      }, 3000); // 3 seconds
    }

    // Cleanup on unmount
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [autoRefresh, open, fetchLogs]);

  return (
    <Modal
      title={`Build Logs - ${worktree.name}`}
      open={open}
      onCancel={onClose}
      width={900}
      style={{ top: 20 }}
      footer={[
        <Checkbox
          key="auto-refresh"
          checked={autoRefresh}
          onChange={(e) => setAutoRefresh(e.target.checked)}
        >
          Auto-refresh
        </Checkbox>,
        <Button key="refresh" icon={<ReloadOutlined />} onClick={() => fetchLogs()} loading={loading}>
          Refresh
        </Button>,
        <Button key="close" onClick={onClose}>
          Close
        </Button>,
      ]}
    >
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        {/* Path info */}
        {logs && (
          <Text type="secondary" style={{ fontSize: 12 }}>
            Log file: {logs.path}
          </Text>
        )}

        {/* Error state */}
        {error && <Alert message="Error fetching build logs" description={error} type="error" showIcon />}

        {/* No logs yet */}
        {logs && !logs.exists && (
          <Alert
            message="No build logs yet"
            description="Build logs will appear here after you start, stop, or nuke the environment."
            type="info"
            showIcon
          />
        )}

        {/* Logs display */}
        {logs && logs.exists && logs.logs && (
          <div
            ref={logsContainerRef}
            style={{
              backgroundColor: '#000',
              border: `1px solid ${token.colorBorder}`,
              borderRadius: token.borderRadius,
              padding: 16,
              height: '60vh',
              overflowY: 'auto',
              fontFamily: 'monospace',
              fontSize: 12,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              color: '#fff',
            }}
          >
            <Ansi>{logs.logs}</Ansi>
          </div>
        )}

        {/* Loading state */}
        {loading && !logs && (
          <div
            style={{
              textAlign: 'center',
              padding: 40,
              color: token.colorTextSecondary,
              height: '60vh',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            Loading build logs...
          </div>
        )}
      </Space>
    </Modal>
  );
};
