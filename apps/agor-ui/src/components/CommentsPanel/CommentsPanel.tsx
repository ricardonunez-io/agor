import type { AgorClient } from '@agor/core/api';
import type { BoardComment, CommentReaction, ReactionSummary, User } from '@agor/core/types';
import { groupReactions, isThreadRoot } from '@agor/core/types';
import {
  CheckOutlined,
  CloseOutlined,
  CommentOutlined,
  DeleteOutlined,
  SendOutlined,
  SmileOutlined,
  UndoOutlined,
} from '@ant-design/icons';
import {
  Avatar,
  Badge,
  Button,
  Input,
  List,
  Popover,
  Space,
  Spin,
  Tag,
  Typography,
  theme,
} from 'antd';
import EmojiPicker, { Theme } from 'emoji-picker-react';
import React, { useEffect, useMemo, useState } from 'react';

const { Text, Title } = Typography;

export interface CommentsPanelProps {
  client: AgorClient | null;
  boardId: string;
  comments: BoardComment[];
  users: User[];
  currentUserId: string;
  loading?: boolean;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  onSendComment: (content: string) => void;
  onReplyComment?: (parentId: string, content: string) => void;
  onResolveComment?: (commentId: string) => void;
  onToggleReaction?: (commentId: string, emoji: string) => void;
  onDeleteComment?: (commentId: string) => void;
  hoveredCommentId?: string | null;
  selectedCommentId?: string | null;
}

type FilterMode = 'all' | 'active';

/**
 * Reaction display component - shows existing reactions as pills
 */
const ReactionDisplay: React.FC<{
  reactions: CommentReaction[];
  currentUserId: string;
  onToggle: (emoji: string) => void;
}> = ({ reactions, currentUserId, onToggle }) => {
  const grouped: ReactionSummary = groupReactions(reactions);

  if (Object.keys(grouped).length === 0) {
    return null;
  }

  return (
    <>
      {Object.entries(grouped).map(([emoji, userIds]) => {
        const hasReacted = userIds.includes(currentUserId);
        return (
          <Button
            key={emoji}
            size="small"
            type={hasReacted ? 'primary' : 'default'}
            onClick={() => onToggle(emoji)}
            style={{
              borderRadius: 12,
              height: 24,
              padding: '0 8px',
              fontSize: 12,
            }}
          >
            {emoji} {userIds.length}
          </Button>
        );
      })}
    </>
  );
};

/**
 * Emoji picker button component
 */
const EmojiPickerButton: React.FC<{
  onToggle: (emoji: string) => void;
}> = ({ onToggle }) => {
  const { token } = theme.useToken();
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <Popover
      content={
        <EmojiPicker
          onEmojiClick={(emojiData) => {
            onToggle(emojiData.emoji);
            setPickerOpen(false);
          }}
          theme={Theme.DARK}
          width={350}
          height={400}
        />
      }
      trigger="click"
      open={pickerOpen}
      onOpenChange={setPickerOpen}
      placement="topLeft"
    >
      <Button
        type="text"
        size="small"
        icon={<SmileOutlined />}
        title="Add reaction"
        style={{ color: token.colorTextSecondary }}
      />
    </Popover>
  );
};

/**
 * Individual reply component
 */
const ReplyItem: React.FC<{
  reply: BoardComment;
  users: User[];
  currentUserId: string;
  onToggleReaction?: (commentId: string, emoji: string) => void;
  onDelete?: (commentId: string) => void;
}> = ({ reply, users, currentUserId, onToggleReaction, onDelete }) => {
  const { token } = theme.useToken();
  const [replyHovered, setReplyHovered] = useState(false);
  const replyUser = users.find((u) => u.user_id === reply.created_by);
  const isReplyCurrentUser = reply.created_by === currentUserId;

  return (
    <List.Item
      style={{
        borderBottom: 'none',
        padding: '4px 0',
      }}
    >
      <div
        style={{ width: '100%', position: 'relative' }}
        onMouseEnter={() => setReplyHovered(true)}
        onMouseLeave={() => setReplyHovered(false)}
      >
        <List.Item.Meta
          avatar={
            <Avatar size="small" style={{ backgroundColor: token.colorPrimary }}>
              {replyUser?.emoji || '👤'}
            </Avatar>
          }
          title={
            <Space size={4}>
              <Text strong style={{ fontSize: token.fontSizeSM }}>
                {replyUser?.name || 'Anonymous'}
              </Text>
              <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                {new Date(reply.created_at).toLocaleTimeString()}
              </Text>
            </Space>
          }
          description={
            <div style={{ marginTop: 2 }}>
              <Text style={{ fontSize: token.fontSizeSM }}>{reply.content}</Text>
            </div>
          }
        />

        {/* Reactions Row (always visible if reactions exist) */}
        {onToggleReaction && (reply.reactions || []).length > 0 && (
          <div style={{ marginTop: 2 }}>
            <Space size="small">
              <ReactionDisplay
                reactions={reply.reactions || []}
                currentUserId={currentUserId}
                onToggle={(emoji) => onToggleReaction(reply.comment_id, emoji)}
              />
            </Space>
          </div>
        )}

        {/* Action buttons overlay (visible on hover) */}
        {replyHovered && (
          <div
            style={{
              position: 'absolute',
              top: 4,
              right: 0,
              backgroundColor: token.colorBgContainer,
              borderRadius: 4,
              padding: '2px',
              boxShadow: '0 2px 8px rgba(0, 0, 0, 0.15)',
            }}
          >
            <Space size="small">
              {onToggleReaction && (
                <EmojiPickerButton
                  onToggle={(emoji) => onToggleReaction(reply.comment_id, emoji)}
                />
              )}
              {onDelete && isReplyCurrentUser && (
                <Button
                  type="text"
                  size="small"
                  icon={<DeleteOutlined />}
                  onClick={() => onDelete(reply.comment_id)}
                  title="Delete"
                  danger
                  style={{ color: token.colorTextSecondary }}
                />
              )}
            </Space>
          </div>
        )}
      </div>
    </List.Item>
  );
};

/**
 * Individual comment thread component (root + nested replies)
 */
const CommentThread: React.FC<{
  comment: BoardComment;
  replies: BoardComment[];
  users: User[];
  currentUserId: string;
  onReply?: (parentId: string, content: string) => void;
  onResolve?: (commentId: string) => void;
  onToggleReaction?: (commentId: string, emoji: string) => void;
  onDelete?: (commentId: string) => void;
  isHighlighted?: boolean;
  scrollRef?: React.RefObject<HTMLDivElement>;
}> = ({
  comment,
  replies,
  users,
  currentUserId,
  onReply,
  onResolve,
  onToggleReaction,
  onDelete,
  isHighlighted,
  scrollRef,
}) => {
  const { token } = theme.useToken();
  const [showReplyInput, setShowReplyInput] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const user = users.find((u) => u.user_id === comment.created_by);
  const isCurrentUser = comment.created_by === currentUserId;

  return (
    <List.Item
      ref={scrollRef}
      style={{
        borderBottom: `1px solid ${token.colorBorder}`,
        padding: isHighlighted ? `${token.paddingXS}px` : '8px 0',
        border: `2px solid ${isHighlighted ? token.colorPrimary : 'transparent'}`,
        borderRadius: token.borderRadiusLG,
        marginBottom: '4px',
        transition: 'all 0.2s ease',
      }}
    >
      <div
        style={{ width: '100%', position: 'relative' }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {/* Thread Root */}
        <List.Item.Meta
          avatar={
            <Avatar size="small" style={{ backgroundColor: token.colorPrimary }}>
              {user?.emoji || '👤'}
            </Avatar>
          }
          title={
            <Space size={4}>
              <Text strong style={{ fontSize: token.fontSizeSM }}>
                {user?.name || 'Anonymous'}
              </Text>
              <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                {new Date(comment.created_at).toLocaleTimeString()}
              </Text>
              {comment.edited && (
                <Text type="secondary" style={{ fontSize: token.fontSizeSM, fontStyle: 'italic' }}>
                  (edited)
                </Text>
              )}
              {comment.resolved && (
                <Tag
                  color="success"
                  style={{ fontSize: token.fontSizeSM, lineHeight: '16px', margin: 0 }}
                >
                  Resolved
                </Tag>
              )}
            </Space>
          }
          description={
            <div style={{ marginTop: 4 }}>
              <Text style={{ fontSize: token.fontSizeSM }}>{comment.content}</Text>
            </div>
          }
        />

        {/* Reactions Row (always visible if reactions exist) */}
        {onToggleReaction && (comment.reactions || []).length > 0 && (
          <div style={{ marginTop: 4 }}>
            <Space size="small">
              <ReactionDisplay
                reactions={comment.reactions || []}
                currentUserId={currentUserId}
                onToggle={(emoji) => onToggleReaction(comment.comment_id, emoji)}
              />
            </Space>
          </div>
        )}

        {/* Action buttons overlay (visible on hover) */}
        {isHovered && (
          <div
            style={{
              position: 'absolute',
              top: 4,
              right: 0,
              backgroundColor: token.colorBgContainer,
              borderRadius: 4,
              padding: '2px',
              boxShadow: '0 2px 8px rgba(0, 0, 0, 0.15)',
            }}
          >
            <Space size="small">
              {onToggleReaction && (
                <EmojiPickerButton
                  onToggle={(emoji) => onToggleReaction(comment.comment_id, emoji)}
                />
              )}
              {onReply && (
                <Button
                  type="text"
                  size="small"
                  icon={<CommentOutlined />}
                  onClick={() => setShowReplyInput(!showReplyInput)}
                  title="Reply"
                  style={{ color: token.colorTextSecondary }}
                />
              )}
              {onResolve && !comment.resolved && (
                <Button
                  type="text"
                  size="small"
                  icon={<CheckOutlined />}
                  onClick={() => onResolve(comment.comment_id)}
                  title="Resolve"
                  style={{ color: token.colorTextSecondary }}
                />
              )}
              {onResolve && comment.resolved && (
                <Button
                  type="text"
                  size="small"
                  icon={<UndoOutlined />}
                  onClick={() => onResolve(comment.comment_id)}
                  title="Reopen"
                  style={{ color: token.colorTextSecondary }}
                />
              )}
              {onDelete && isCurrentUser && (
                <Button
                  type="text"
                  size="small"
                  icon={<DeleteOutlined />}
                  onClick={() => onDelete(comment.comment_id)}
                  title="Delete"
                  danger
                  style={{ color: token.colorTextSecondary }}
                />
              )}
            </Space>
          </div>
        )}

        {/* Nested Replies (1 level deep) */}
        {replies.length > 0 && (
          <div
            style={{
              marginLeft: 16,
              marginTop: 8,
              borderLeft: `2px solid ${token.colorBorder}`,
              paddingLeft: 8,
            }}
          >
            <List
              dataSource={replies}
              renderItem={(reply) => (
                <ReplyItem
                  reply={reply}
                  users={users}
                  currentUserId={currentUserId}
                  onToggleReaction={onToggleReaction}
                  onDelete={onDelete}
                />
              )}
            />
          </div>
        )}

        {/* Reply Input */}
        {showReplyInput && onReply && (
          <div style={{ marginLeft: 32, marginTop: 4 }}>
            <Input.Search
              placeholder="Reply..."
              enterButton={<SendOutlined />}
              onSearch={(value) => {
                if (value.trim()) {
                  onReply(comment.comment_id, value);
                  setShowReplyInput(false);
                }
              }}
              autoFocus
            />
          </div>
        )}
      </div>
    </List.Item>
  );
};

/**
 * Main CommentsPanel component - permanent left sidebar with threading and reactions
 */
export const CommentsPanel: React.FC<CommentsPanelProps> = ({
  boardId,
  comments,
  users,
  currentUserId,
  loading = false,
  collapsed = false,
  onToggleCollapse,
  onSendComment,
  onReplyComment,
  onResolveComment,
  onToggleReaction,
  onDeleteComment,
  hoveredCommentId,
  selectedCommentId,
}) => {
  const { token } = theme.useToken();
  const [filter, setFilter] = useState<FilterMode>('active');
  const [commentInputValue, setCommentInputValue] = useState('');

  // Create refs for scroll-to-view
  const commentRefs = React.useRef<Record<string, React.RefObject<HTMLDivElement>>>({});

  // Separate thread roots from replies
  const threadRoots = useMemo(() => comments.filter((c) => isThreadRoot(c)), [comments]);

  const allReplies = useMemo(() => comments.filter((c) => !isThreadRoot(c)), [comments]);

  // Group replies by parent
  const repliesByParent = useMemo(() => {
    const grouped: Record<string, BoardComment[]> = {};
    for (const reply of allReplies) {
      if (reply.parent_comment_id) {
        if (!grouped[reply.parent_comment_id]) {
          grouped[reply.parent_comment_id] = [];
        }
        grouped[reply.parent_comment_id].push(reply);
      }
    }
    return grouped;
  }, [allReplies]);

  // Apply filters to thread roots only
  const filteredThreads = useMemo(() => {
    return threadRoots
      .filter((thread) => {
        if (filter === 'active' && thread.resolved) return false;
        return true;
      })
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  }, [threadRoots, filter]);

  // Scroll to selected comment when it changes
  useEffect(() => {
    if (selectedCommentId && commentRefs.current[selectedCommentId]) {
      commentRefs.current[selectedCommentId]?.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }
  }, [selectedCommentId]);

  // When collapsed, don't render anything
  if (collapsed) {
    return null;
  }

  // Expanded state - full panel
  return (
    <div
      style={{
        width: 400,
        height: '100%',
        backgroundColor: token.colorBgContainer,
        borderRight: `1px solid ${token.colorBorder}`,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: 12,
          borderBottom: `1px solid ${token.colorBorder}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Space>
          <CommentOutlined />
          <Title level={5} style={{ margin: 0 }}>
            Comments
          </Title>
          <Badge
            count={filteredThreads.length}
            showZero={false}
            style={{ backgroundColor: token.colorPrimaryBgHover }}
          />
        </Space>
        {onToggleCollapse && (
          <Button
            type="text"
            size="small"
            icon={<CloseOutlined />}
            onClick={onToggleCollapse}
            danger
          />
        )}
      </div>

      {/* Filter Tabs */}
      <div
        style={{
          padding: 12,
          borderBottom: `1px solid ${token.colorBorder}`,
          backgroundColor: token.colorBgContainer,
        }}
      >
        <Space>
          <Button
            type={filter === 'active' ? 'primary' : 'default'}
            size="small"
            onClick={() => setFilter('active')}
          >
            Active
          </Button>
          <Button
            type={filter === 'all' ? 'primary' : 'default'}
            size="small"
            onClick={() => setFilter('all')}
          >
            All
          </Button>
        </Space>
      </div>

      {/* Thread List */}
      <div
        style={{
          flex: 1,
          overflow: 'auto',
          padding: '0 12px',
          backgroundColor: token.colorBgLayout,
        }}
      >
        {loading ? (
          <div style={{ textAlign: 'center', padding: 32 }}>
            <Spin tip="Loading comments..." />
          </div>
        ) : filteredThreads.length === 0 ? (
          <div
            style={{
              textAlign: 'center',
              padding: 32,
              color: token.colorTextSecondary,
            }}
          >
            <CommentOutlined style={{ fontSize: 48, marginBottom: 16, opacity: 0.3 }} />
            <div>No comments yet</div>
            <div style={{ fontSize: 12, marginTop: 8 }}>Start a conversation about this board</div>
          </div>
        ) : (
          <List
            dataSource={filteredThreads}
            renderItem={(thread) => {
              // Create or get ref for this thread
              if (!commentRefs.current[thread.comment_id]) {
                commentRefs.current[thread.comment_id] = React.createRef<HTMLDivElement>();
              }

              const isHighlighted =
                thread.comment_id === hoveredCommentId || thread.comment_id === selectedCommentId;

              return (
                <CommentThread
                  comment={thread}
                  replies={repliesByParent[thread.comment_id] || []}
                  users={users}
                  currentUserId={currentUserId}
                  onReply={onReplyComment}
                  onResolve={onResolveComment}
                  onToggleReaction={onToggleReaction}
                  onDelete={onDeleteComment}
                  isHighlighted={isHighlighted}
                  scrollRef={commentRefs.current[thread.comment_id]}
                />
              );
            }}
          />
        )}
      </div>

      {/* Input Box for new top-level comment */}
      <div
        style={{
          padding: 12,
          borderTop: `1px solid ${token.colorBorder}`,
          backgroundColor: token.colorBgContainer,
        }}
      >
        <Input.Search
          placeholder="Add a comment..."
          enterButton={<SendOutlined />}
          value={commentInputValue}
          onChange={(e) => setCommentInputValue(e.target.value)}
          onSearch={(value) => {
            if (value.trim()) {
              onSendComment(value);
              setCommentInputValue('');
            }
          }}
        />
      </div>
    </div>
  );
};
