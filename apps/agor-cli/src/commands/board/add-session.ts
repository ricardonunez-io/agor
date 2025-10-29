/**
 * Add a session's worktree to a board
 *
 * Note: Sessions are now organized through worktrees. This command adds
 * the session's worktree to the board, which will display all sessions
 * associated with that worktree.
 */

import { createClient } from '@agor/core/api';
import type { Board, BoardEntityObject, Session, Worktree } from '@agor/core/types';
import { Args, Command } from '@oclif/core';
import chalk from 'chalk';

export default class BoardAddSession extends Command {
  static override description =
    "Add a session's worktree to a board (sessions are organized through worktrees)";

  static override examples = [
    '<%= config.bin %> <%= command.id %> default 0199b86c',
    '<%= config.bin %> <%= command.id %> 0199b850 0199b86c-10ab-7409-b053-38b62327e695',
  ];

  static override args = {
    boardId: Args.string({
      description: 'Board ID or slug',
      required: true,
    }),
    sessionId: Args.string({
      description: 'Session ID (short or full)',
      required: true,
    }),
  };

  public async run(): Promise<void> {
    const { args } = await this.parse(BoardAddSession);
    const client = createClient();

    try {
      // Find board by ID or slug
      const boardsResult = await client.service('boards').find();
      const boards = (Array.isArray(boardsResult) ? boardsResult : boardsResult.data) as Board[];

      const board = boards.find(
        (b: Board) =>
          b.board_id === args.boardId ||
          b.board_id.startsWith(args.boardId) ||
          b.slug === args.boardId
      );

      if (!board) {
        this.log(chalk.red(`✗ Board not found: ${args.boardId}`));
        await this.cleanup(client);
        process.exit(1);
      }

      // Find session by short or full ID
      const sessionsResult = await client.service('sessions').find();
      const sessions = (
        Array.isArray(sessionsResult) ? sessionsResult : sessionsResult.data
      ) as Session[];

      const session = sessions.find(
        (s: Session) => s.session_id === args.sessionId || s.session_id.startsWith(args.sessionId)
      );

      if (!session) {
        this.log(chalk.red(`✗ Session not found: ${args.sessionId}`));
        await this.cleanup(client);
        process.exit(1);
      }

      // Get worktree for this session
      if (!session.worktree_id) {
        this.log(chalk.red(`✗ Session has no worktree associated`));
        await this.cleanup(client);
        process.exit(1);
      }

      const worktreesResult = await client.service('worktrees').find();
      const worktrees = (
        Array.isArray(worktreesResult) ? worktreesResult : worktreesResult.data
      ) as Worktree[];

      const worktree = worktrees.find((w: Worktree) => w.worktree_id === session.worktree_id);

      if (!worktree) {
        this.log(chalk.red(`✗ Worktree not found for session`));
        await this.cleanup(client);
        process.exit(1);
      }

      // Check if worktree is already on the board
      const boardObjectsResult = await client.service('board-objects').find({
        query: {
          board_id: board.board_id,
        },
      });

      const boardObjects = (
        Array.isArray(boardObjectsResult) ? boardObjectsResult : boardObjectsResult.data
      ) as BoardEntityObject[];

      const existingObject = boardObjects.find(
        (bo: BoardEntityObject) => bo.worktree_id === worktree.worktree_id
      );

      if (existingObject) {
        this.log(chalk.yellow(`⚠ Worktree "${worktree.name}" already on board "${board.name}"`));
        await this.cleanup(client);
        return;
      }

      // Add worktree to board via board_objects
      await client.service('board-objects').create({
        board_id: board.board_id,
        worktree_id: worktree.worktree_id,
        position: { x: 100, y: 100 },
      });

      this.log(
        chalk.green(
          `✓ Added worktree "${worktree.name}" (containing session ${session.session_id.substring(0, 8)}) to board "${board.name}"`
        )
      );
    } catch (error) {
      this.log(chalk.red('✗ Failed to add session to board'));
      if (error instanceof Error) {
        this.log(chalk.red(error.message));
      }
      await this.cleanup(client);
      process.exit(1);
    }

    await this.cleanup(client);
  }

  private async cleanup(client: import('@agor/core/api').AgorClient): Promise<void> {
    await new Promise<void>((resolve) => {
      client.io.once('disconnect', () => resolve());
      client.io.close();
      setTimeout(() => resolve(), 1000);
    });
  }
}
