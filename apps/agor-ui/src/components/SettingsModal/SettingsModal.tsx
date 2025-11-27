import type { AgorClient } from '@agor/core/api';
import type {
  Board,
  BoardEntityObject,
  CreateMCPServerInput,
  CreateUserInput,
  MCPServer,
  Repo,
  Session,
  UpdateMCPServerInput,
  UpdateUserInput,
  User,
  Worktree,
} from '@agor/core/types';
import { Modal, Tabs } from 'antd';
import { useState } from 'react';
import { WorktreeModal } from '../WorktreeModal';
import type { WorktreeUpdate } from '../WorktreeModal/tabs/GeneralTab';
import { AboutTab } from './AboutTab';
import { AgenticToolsSection } from './AgenticToolsSection';
import { BoardsTable } from './BoardsTable';
import { MCPServersTable } from './MCPServersTable';
import { ReposTable } from './ReposTable';
import { UsersTable } from './UsersTable';
import { WorktreesTable } from './WorktreesTable';

export interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  client: AgorClient | null; // Still needed for WorktreeModal
  currentUser?: User | null; // Current logged-in user
  boardById: Map<string, Board>;
  boardObjects: BoardEntityObject[];
  repoById: Map<string, Repo>;
  worktreeById: Map<string, Worktree>;
  sessionById: Map<string, Session>; // O(1) ID lookups - efficient, stable references
  sessionsByWorktree: Map<string, Session[]>; // O(1) worktree filtering
  userById: Map<string, User>;
  mcpServerById: Map<string, MCPServer>;
  activeTab?: string; // Control which tab is shown when modal opens
  onTabChange?: (tabKey: string) => void;
  onCreateBoard?: (board: Partial<Board>) => void;
  onUpdateBoard?: (boardId: string, updates: Partial<Board>) => void;
  onDeleteBoard?: (boardId: string) => void;
  onCreateRepo?: (data: { url: string; slug: string; default_branch: string }) => void;
  onCreateLocalRepo?: (data: { path: string; slug?: string }) => void;
  onUpdateRepo?: (repoId: string, updates: Partial<Repo>) => void;
  onDeleteRepo?: (repoId: string, cleanup: boolean) => void;
  onArchiveOrDeleteWorktree?: (
    worktreeId: string,
    options: {
      metadataAction: 'archive' | 'delete';
      filesystemAction: 'preserved' | 'cleaned' | 'deleted';
    }
  ) => void;
  onUnarchiveWorktree?: (worktreeId: string, options?: { boardId?: string }) => void;
  onUpdateWorktree?: (worktreeId: string, updates: WorktreeUpdate) => void;
  onCreateWorktree?: (
    repoId: string,
    data: {
      name: string;
      ref: string;
      createBranch: boolean;
      sourceBranch: string;
      pullLatest: boolean;
      issue_url?: string;
      pull_request_url?: string;
    }
  ) => Promise<Worktree | null>;
  onStartEnvironment?: (worktreeId: string) => void;
  onStopEnvironment?: (worktreeId: string) => void;
  onCreateUser?: (data: CreateUserInput) => void;
  onUpdateUser?: (userId: string, updates: UpdateUserInput) => void;
  onDeleteUser?: (userId: string) => void;
  onCreateMCPServer?: (data: CreateMCPServerInput) => void;
  onUpdateMCPServer?: (serverId: string, updates: UpdateMCPServerInput) => void;
  onDeleteMCPServer?: (serverId: string) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  open,
  onClose,
  client,
  currentUser,
  boardById,
  boardObjects,
  repoById,
  worktreeById,
  sessionsByWorktree,
  userById,
  mcpServerById,
  activeTab = 'boards',
  onTabChange,
  onCreateBoard,
  onUpdateBoard,
  onDeleteBoard,
  onCreateRepo,
  onCreateLocalRepo,
  onUpdateRepo,
  onDeleteRepo,
  onArchiveOrDeleteWorktree,
  onUnarchiveWorktree,
  onUpdateWorktree,
  onCreateWorktree,
  onStartEnvironment,
  onStopEnvironment,
  onCreateUser,
  onUpdateUser,
  onDeleteUser,
  onCreateMCPServer,
  onUpdateMCPServer,
  onDeleteMCPServer,
}) => {
  const [selectedWorktree, setSelectedWorktree] = useState<Worktree | null>(null);
  const [selectedRepo, setSelectedRepo] = useState<Repo | null>(null);
  const [worktreeSessions, setWorktreeSessions] = useState<Session[]>([]);
  const [worktreeModalOpen, setWorktreeModalOpen] = useState(false);

  const handleWorktreeRowClick = (worktree: Worktree) => {
    // Snapshot the data when opening modal
    setSelectedWorktree(worktree);
    setSelectedRepo(repoById.get(worktree.repo_id) || null);
    setWorktreeSessions(sessionsByWorktree.get(worktree.worktree_id) || []);
    setWorktreeModalOpen(true);
  };

  const handleWorktreeModalClose = () => {
    setWorktreeModalOpen(false);
    // Clear after modal closes
    setSelectedWorktree(null);
    setSelectedRepo(null);
    setWorktreeSessions([]);
  };

  // Wrapper to close modal after archive/delete
  const handleArchiveOrDeleteWorktreeWithClose = async (
    worktreeId: string,
    options: {
      metadataAction: 'archive' | 'delete';
      filesystemAction: 'preserved' | 'cleaned' | 'deleted';
    }
  ) => {
    await onArchiveOrDeleteWorktree?.(worktreeId, options);
    handleWorktreeModalClose();
  };
  return (
    <Modal
      title="Settings"
      open={open}
      onCancel={onClose}
      footer={null}
      width={1200}
      styles={{
        body: {
          height: '75vh',
          display: 'flex',
          flexDirection: 'column',
          padding: 0,
        },
      }}
    >
      <Tabs
        activeKey={activeTab}
        onChange={onTabChange}
        style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
        tabBarStyle={{ paddingLeft: 24, paddingRight: 24, marginBottom: 0, flex: '0 0 auto' }}
        items={[
          {
            key: 'boards',
            label: 'Boards',
            children: (
              <div style={{ flex: 1, overflow: 'auto', padding: '16px 24px' }}>
                <BoardsTable
                  client={client}
                  boardById={boardById}
                  sessionsByWorktree={sessionsByWorktree}
                  worktreeById={worktreeById}
                  onCreate={onCreateBoard}
                  onUpdate={onUpdateBoard}
                  onDelete={onDeleteBoard}
                />
              </div>
            ),
          },
          {
            key: 'repos',
            label: 'Repositories',
            children: (
              <div style={{ flex: 1, overflow: 'auto', padding: '16px 24px' }}>
                <ReposTable
                  repoById={repoById}
                  onCreate={onCreateRepo}
                  onCreateLocal={onCreateLocalRepo}
                  onUpdate={onUpdateRepo}
                  onDelete={onDeleteRepo}
                />
              </div>
            ),
          },
          {
            key: 'worktrees',
            label: 'Worktrees & Environments',
            children: (
              <div style={{ flex: 1, overflow: 'auto', padding: '16px 24px' }}>
                <WorktreesTable
                  worktreeById={worktreeById}
                  repoById={repoById}
                  boardById={boardById}
                  sessionsByWorktree={sessionsByWorktree}
                  onArchiveOrDelete={onArchiveOrDeleteWorktree}
                  onUnarchive={onUnarchiveWorktree}
                  onCreate={onCreateWorktree}
                  onRowClick={handleWorktreeRowClick}
                  onStartEnvironment={onStartEnvironment}
                  onStopEnvironment={onStopEnvironment}
                />
              </div>
            ),
          },
          {
            key: 'mcp',
            label: 'MCP Servers',
            children: (
              <div style={{ flex: 1, overflow: 'auto', padding: '16px 24px' }}>
                <MCPServersTable
                  mcpServerById={mcpServerById}
                  onCreate={onCreateMCPServer}
                  onUpdate={onUpdateMCPServer}
                  onDelete={onDeleteMCPServer}
                />
              </div>
            ),
          },
          {
            key: 'agentic-tools',
            label: 'Agentic Tools',
            children: (
              <div style={{ flex: 1, overflow: 'auto', padding: '16px 24px' }}>
                <AgenticToolsSection client={client} />
              </div>
            ),
          },
          {
            key: 'users',
            label: 'Users',
            children: (
              <div style={{ flex: 1, overflow: 'auto', padding: '16px 24px' }}>
                <UsersTable
                  userById={userById}
                  mcpServerById={mcpServerById}
                  currentUser={currentUser}
                  onCreate={onCreateUser}
                  onUpdate={onUpdateUser}
                  onDelete={onDeleteUser}
                />
              </div>
            ),
          },
          {
            key: 'about',
            label: 'About',
            children: (
              <div style={{ flex: 1, overflow: 'auto', padding: '16px 24px' }}>
                <AboutTab
                  client={client}
                  connected={client?.io?.connected ?? false}
                  connectionError={undefined}
                  isAdmin={currentUser?.role === 'admin'}
                />
              </div>
            ),
          },
        ]}
      />
      <WorktreeModal
        open={worktreeModalOpen}
        onClose={handleWorktreeModalClose}
        worktree={selectedWorktree}
        repo={selectedRepo}
        sessions={worktreeSessions}
        boardById={boardById}
        boardObjects={boardObjects}
        mcpServerById={mcpServerById}
        client={client}
        onUpdateWorktree={onUpdateWorktree}
        onUpdateRepo={onUpdateRepo}
        onArchiveOrDelete={handleArchiveOrDeleteWorktreeWithClose}
        onOpenSettings={onClose} // Close worktree modal and keep settings modal open
      />
    </Modal>
  );
};
