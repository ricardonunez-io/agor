/**
 * Container user utilities
 *
 * Handles mapping Agor users to Unix users inside containers.
 */

/**
 * Derive a Unix username from an Agor user identifier.
 *
 * Rules:
 * - Strip @domain part (e.g., jose.garcia@company.com → jose.garcia)
 * - Replace . with _ (e.g., jose.garcia → jose_garcia)
 * - Lowercase the result
 * - Truncate to 32 chars (Unix username limit)
 *
 * @param agorUsername - The Agor username or email
 * @returns A valid Unix username
 */
export function deriveUnixUsername(agorUsername: string): string {
  // Strip @domain part
  let username = agorUsername.split('@')[0];

  // Replace . with _
  username = username.replace(/\./g, '_');

  // Lowercase
  username = username.toLowerCase();

  // Remove any invalid characters (only allow a-z, 0-9, _, -)
  username = username.replace(/[^a-z0-9_-]/g, '_');

  // Ensure it doesn't start with a number or dash
  if (/^[0-9-]/.test(username)) {
    username = 'u_' + username;
  }

  // Truncate to 32 chars (Unix limit)
  username = username.slice(0, 32);

  // Fallback if empty
  if (!username) {
    username = 'agor_user';
  }

  return username;
}

/**
 * Generate a command to ensure a user exists in the container.
 * Creates the user if they don't exist, does nothing if they do.
 *
 * @param username - Unix username to create
 * @param uid - Optional specific UID to use
 * @returns Shell command string
 */
export function createUserCommand(username: string, uid?: number): string {
  if (uid !== undefined) {
    // Create user with specific UID if it doesn't exist
    return `id -u ${username} >/dev/null 2>&1 || useradd -m -s /bin/bash -u ${uid} ${username}`;
  } else {
    // Create user with auto-assigned UID if it doesn't exist
    return `id -u ${username} >/dev/null 2>&1 || useradd -m -s /bin/bash ${username}`;
  }
}

/**
 * Generate a command to ensure a user exists and add them to the docker group.
 * This allows the user to access the Podman socket.
 *
 * Also sets up shared AI session directories:
 * - Creates /workspace/.agor/claude/ (shared Claude session data)
 * - Symlinks ~/.claude -> /workspace/.agor/claude/ (so all users share sessions)
 *
 * This allows multiple users to collaborate on the same AI sessions while
 * keeping other user data (SSH keys, credentials) isolated in their home dirs.
 *
 * @param username - Unix username to create
 * @param uid - Optional specific UID to use
 * @returns Shell command string
 */
export function ensureContainerUser(username: string, uid?: number): string {
  const createCmd = createUserCommand(username, uid);

  // Commands to set up shared AI session directories
  // 1. Create shared claude directory (world-writable so all users can access)
  // 2. Symlink user's ~/.claude to the shared directory
  const sharedClaudeDir = '/workspace/.agor/claude';
  const userHome = username === 'root' ? '/root' : `/home/${username}`;
  const setupSharedSessions = `
    mkdir -p ${sharedClaudeDir} && chmod 777 ${sharedClaudeDir} && \
    rm -rf ${userHome}/.claude && \
    ln -sf ${sharedClaudeDir} ${userHome}/.claude && \
    chown -h ${username}:${username} ${userHome}/.claude
  `.replace(/\n\s+/g, ' ').trim();

  // Combine: create user, add to docker group, setup shared sessions
  return `${createCmd} && (getent group docker && usermod -aG docker ${username} || true) && (${setupSharedSessions})`;
}
