# Isolated Terminal Containers: Docker Container Per Worktree

**Status:** Exploration
**Created:** 2025-01-22
**Related:** executor-isolation.md, unix-user-modes.md, rbac-and-unix-isolation.md

---

## Table of Contents

1. [Overview](#overview)
2. [Goals & Requirements](#goals--requirements)
3. [Architecture](#architecture)
4. [Container Lifecycle](#container-lifecycle)
5. [User Access Model](#user-access-model)
6. [SSH Access](#ssh-access)
7. [Docker/Podman Inside Container](#dockerpodman-inside-container)
8. [Terminal & SDK Execution](#terminal--sdk-execution)
9. [Credential Handling](#credential-handling)
10. [Network Model](#network-model)
11. [Container Image Specification](#container-image-specification)
12. [Implementation Plan](#implementation-plan)
13. [Configuration](#configuration)
14. [Migration from Current Model](#migration-from-current-model)
15. [Trade-offs](#trade-offs)
16. [Open Questions](#open-questions)

---

## Overview

This document describes an OS-level isolation model where **each worktree gets its own Docker container**. All execution (terminals, AI SDK, docker-compose environments) happens inside this container, providing strong isolation between worktrees.

### Key Insight

Instead of Unix groups and filesystem ACLs for isolation, we use **container boundaries**. Each worktree is a self-contained execution environment that:

- Lives as long as the worktree exists
- Contains all users who own that worktree
- Runs docker-compose environments via Podman (isolated from other worktrees)
- Provides familiar Docker CLI experience to users

---

## Goals & Requirements

### Must Have

1. **Container per worktree** - One container created when worktree created, destroyed when worktree deleted
2. **Multi-user access** - All worktree owners can access the same container
3. **Isolated environments** - docker-compose in worktree A cannot see containers from worktree B
4. **Web terminal access** - Users connect via browser (xterm.js)
5. **SSH access** - Users can SSH into their worktree containers (for IDE integration, etc.)
6. **SDK execution inside container** - Claude/Codex/Gemini runs inside the container
7. **Docker CLI compatibility** - Users can use `docker ps`, `docker-compose up`, etc.
8. **Git credential injection** - Via environment variables

### Nice to Have

1. Shared image cache across worktrees (reduce disk usage)
2. Resource limits (CPU, memory) per container
3. Custom base images per worktree

### Non-Goals

1. Direct host filesystem access from containers
2. Cross-worktree container visibility

---

## Architecture

### High-Level Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Host OS                                                                    │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  Agor Daemon                                                          │  │
│  │  - Manages container lifecycle (create/destroy with worktree)         │  │
│  │  - Enforces access control (only owners can exec)                     │  │
│  │  - Routes WebSocket terminal I/O to containers                        │  │
│  │  - Orchestrates SDK execution inside containers                       │  │
│  │  - Provides SSH connection info API                                   │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  ┌─────────────────────────────┐    ┌─────────────────────────────┐        │
│  │ Container: agor-wt-abc123  │    │ Container: agor-wt-def456  │        │
│  │ SSH Port: 2223              │    │ SSH Port: 2224              │        │
│  │                             │    │                             │        │
│  │ Users: alice, bob           │    │ Users: carol                │        │
│  │ (UID/GID preserved)         │    │ (UID/GID preserved)         │        │
│  │ (SSH keys from GitHub)      │    │ (SSH keys from GitHub)      │        │
│  │                             │    │                             │        │
│  │ /workspace (rw)             │    │ /workspace (rw)             │        │
│  │   └─ worktree files         │    │   └─ worktree files         │        │
│  │                             │    │                             │        │
│  │ sshd (port 22 internal)     │    │ sshd (port 22 internal)     │        │
│  │ Podman (docker CLI compat)  │    │ Podman (docker CLI compat)  │        │
│  │   └─ docker-compose envs    │    │   └─ docker-compose envs    │        │
│  │                             │    │                             │        │
│  │ Zellij (terminal mux)       │    │ Zellij (terminal mux)       │        │
│  │ Claude SDK / Executor       │    │ Claude SDK / Executor       │        │
│  └─────────────────────────────┘    └─────────────────────────────┘        │
│              ↑                                   ↑                          │
│              │ docker exec                       │ docker exec              │
│              │ SSH (port 2223)                   │ SSH (port 2224)          │
│              │                                   │                          │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  /var/agor/worktrees/                                                 │  │
│  │    wt-abc123/  (mounted into container abc)                           │  │
│  │    wt-def456/  (mounted into container def)                           │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
        ↑                              ↑
        │ WebSocket                    │ SSH (direct)
        │ (terminal:input/output)      │ (IDE, local terminal)
        │                              │
┌───────────────────────────┐    ┌───────────────────────────┐
│  Browser                  │    │  Local Terminal / IDE     │
│  └─ xterm.js              │    │  └─ ssh alice@host -p 2223│
└───────────────────────────┘    └───────────────────────────┘
```

### Why This Architecture?

| Concern | Previous Approach (Unix Groups) | Container Approach |
|---------|--------------------------------|-------------------|
| Filesystem isolation | ACLs, chmod, setgid | Container mount namespace |
| Process isolation | Same host, different users | Separate PID namespace |
| Network isolation | None | Separate network namespace |
| docker-compose isolation | Shared host daemon | Podman per container |
| Credential isolation | User home directories | Injected env vars |

---

## Container Lifecycle

### Creation (When Worktree Created)

```typescript
// apps/agor-daemon/src/services/worktree-containers.ts

async function createWorktreeContainer(worktreeId: WorktreeID): Promise<void> {
  const worktree = await worktreesRepo.findById(worktreeId);
  const containerName = `agor-wt-${formatShortId(worktreeId)}`;

  // Get all owners to create users inside container
  const owners = await worktreeOwnersRepo.findByWorktree(worktreeId);

  // Create container
  await docker.createContainer({
    name: containerName,
    image: config.containers.image || 'agor/workspace:latest',

    // Mount worktree files
    volumes: [
      {
        source: worktree.path,
        target: '/workspace',
        mode: 'rw',
      },
      {
        source: `${worktree.repo.local_path}/.git`,
        target: '/workspace/.git',
        mode: 'rw',
      },
    ],

    // Keep container running
    command: ['sleep', 'infinity'],

    // Restart policy
    restartPolicy: { name: 'unless-stopped' },

    // Labels for identification
    labels: {
      'agor.worktree_id': worktreeId,
      'agor.managed': 'true',
    },
  });

  await docker.startContainer(containerName);

  // Create users inside container for each owner
  for (const owner of owners) {
    await createUserInContainer(containerName, owner);
  }

  // Update worktree record
  await worktreesRepo.update(worktreeId, {
    container_name: containerName,
    container_status: 'running',
  });
}
```

### Destruction (When Worktree Deleted)

```typescript
async function destroyWorktreeContainer(worktreeId: WorktreeID): Promise<void> {
  const worktree = await worktreesRepo.findById(worktreeId);
  const containerName = worktree.container_name;

  if (!containerName) return;

  // Stop and remove container
  await docker.stopContainer(containerName, { timeout: 30 });
  await docker.removeContainer(containerName, { force: true });

  // Update worktree record
  await worktreesRepo.update(worktreeId, {
    container_name: null,
    container_status: null,
  });
}
```

### Container States

```typescript
type ContainerStatus =
  | 'creating'    // Container being created
  | 'running'     // Container running, ready for exec
  | 'stopped'     // Container stopped (can be restarted)
  | 'removing'    // Container being removed
  | 'error';      // Container in error state
```

---

## User Access Model

### Creating Users Inside Container

When a user becomes a worktree owner, create their user inside the container:

```typescript
async function createUserInContainer(
  containerName: string,
  user: User
): Promise<void> {
  const { unix_username, unix_uid, unix_gid } = user;

  if (!unix_username) {
    // User doesn't have Unix identity, skip
    return;
  }

  // Create group if GID specified
  if (unix_gid) {
    await dockerExec(containerName, [
      'groupadd', '-g', String(unix_gid), unix_username,
    ]).catch(() => {}); // Ignore if exists
  }

  // Create user with matching UID/GID
  await dockerExec(containerName, [
    'useradd',
    '-m',                              // Create home directory
    '-u', String(unix_uid),            // Match host UID
    '-g', String(unix_gid || unix_uid), // Match host GID
    '-s', '/bin/bash',                 // Default shell
    unix_username,
  ]).catch(() => {}); // Ignore if exists

  // Create agor directory structure in user's home
  await dockerExec(containerName, [
    'mkdir', '-p', `/home/${unix_username}/agor/worktrees`,
  ]);

  // Symlink workspace
  await dockerExec(containerName, [
    'ln', '-sf', '/workspace', `/home/${unix_username}/agor/worktrees/current`,
  ]);

  // Set ownership
  await dockerExec(containerName, [
    'chown', '-R', `${unix_username}:${unix_username}`, `/home/${unix_username}`,
  ]);
}
```

### Removing Users from Container

When a user is removed as worktree owner:

```typescript
async function removeUserFromContainer(
  containerName: string,
  user: User
): Promise<void> {
  const { unix_username } = user;

  if (!unix_username) return;

  // Remove user (keep home for potential audit)
  await dockerExec(containerName, [
    'userdel', unix_username,
  ]).catch(() => {});
}
```

### Access Control Enforcement

```typescript
// In TerminalsService or WorktreeContainersService

async function execIntoContainer(
  userId: UserID,
  worktreeId: WorktreeID
): Promise<void> {
  // Check ownership
  const owners = await worktreeOwnersRepo.findByWorktree(worktreeId);
  const isOwner = owners.some(o => o.user_id === userId);

  if (!isOwner) {
    throw new Forbidden('Only worktree owners can access the terminal');
  }

  const user = await usersRepo.findById(userId);
  const worktree = await worktreesRepo.findById(worktreeId);

  // User is owner, allow exec
  // ... proceed with docker exec
}
```

---

## SSH Access

### Overview

Users can SSH directly into their worktree containers for:
- IDE integration (VS Code Remote, JetBrains Gateway)
- Command-line access from local terminal
- SCP/SFTP file transfers
- Git operations with local SSH agent

### Port Allocation

Each worktree container gets a unique SSH port:

```typescript
// Port allocation: base_port + worktree.unique_id
const SSH_BASE_PORT = 2222;

async function allocateSSHPort(worktreeId: WorktreeID): Promise<number> {
  const worktree = await worktreesRepo.findById(worktreeId);
  return SSH_BASE_PORT + worktree.unique_id;
}

// Example:
// worktree unique_id=1  → port 2223
// worktree unique_id=2  → port 2224
// worktree unique_id=47 → port 2269
```

### Container Creation with SSH Port

```typescript
async function createWorktreeContainer(worktreeId: WorktreeID): Promise<void> {
  const worktree = await worktreesRepo.findById(worktreeId);
  const containerName = `agor-wt-${formatShortId(worktreeId)}`;
  const sshPort = await allocateSSHPort(worktreeId);

  await docker.createContainer({
    name: containerName,
    image: config.containers.image || 'agor/workspace:latest',

    // Expose SSH port
    exposedPorts: { '22/tcp': {} },
    hostConfig: {
      portBindings: {
        '22/tcp': [{ HostPort: String(sshPort) }],
      },
      // ... other config
    },

    // ... volumes, labels, etc.
  });

  // Update worktree with SSH port
  await worktreesRepo.update(worktreeId, {
    container_name: containerName,
    container_status: 'running',
    ssh_port: sshPort,
  });
}
```

### SSH Key Management via GitHub

User's SSH public keys are fetched from GitHub (already public):

```typescript
/**
 * Fetch user's SSH public keys from GitHub
 * GitHub exposes public keys at: https://github.com/{username}.keys
 */
async function fetchGitHubSSHKeys(githubUsername: string): Promise<string[]> {
  const response = await fetch(`https://github.com/${githubUsername}.keys`);

  if (!response.ok) {
    logger.warn(`Failed to fetch SSH keys for ${githubUsername}`);
    return [];
  }

  const keys = await response.text();
  return keys.split('\n').filter(line => line.trim().length > 0);
}

/**
 * Setup SSH access for a user in a container
 */
async function setupUserSSHAccess(
  containerName: string,
  user: User
): Promise<void> {
  if (!user.unix_username || !user.github_username) {
    return;
  }

  // Fetch public keys from GitHub
  const keys = await fetchGitHubSSHKeys(user.github_username);

  if (keys.length === 0) {
    logger.info(`No SSH keys found for ${user.github_username}`);
    return;
  }

  const sshDir = `/home/${user.unix_username}/.ssh`;
  const authorizedKeysPath = `${sshDir}/authorized_keys`;

  // Create .ssh directory
  await dockerExec(containerName, [
    'mkdir', '-p', sshDir,
  ]);

  // Write authorized_keys
  const authorizedKeysContent = keys.join('\n') + '\n';
  await dockerExec(containerName, [
    'bash', '-c', `echo '${authorizedKeysContent}' > ${authorizedKeysPath}`,
  ]);

  // Set correct permissions
  await dockerExec(containerName, [
    'chmod', '700', sshDir,
  ]);
  await dockerExec(containerName, [
    'chmod', '600', authorizedKeysPath,
  ]);
  await dockerExec(containerName, [
    'chown', '-R', `${user.unix_username}:${user.unix_username}`, sshDir,
  ]);
}
```

### Updated User Creation Flow

```typescript
async function createUserInContainer(
  containerName: string,
  user: User
): Promise<void> {
  const { unix_username, unix_uid, unix_gid } = user;

  if (!unix_username) return;

  // Create group and user (existing code)
  // ...

  // Setup SSH access (NEW)
  await setupUserSSHAccess(containerName, user);
}
```

### Refreshing SSH Keys

Keys can be refreshed when user requests or periodically:

```typescript
async function refreshUserSSHKeys(
  worktreeId: WorktreeID,
  userId: UserID
): Promise<void> {
  const worktree = await worktreesRepo.findById(worktreeId);
  const user = await usersRepo.findById(userId);

  if (!worktree.container_name) {
    throw new Error('Worktree container not running');
  }

  await setupUserSSHAccess(worktree.container_name, user);
}
```

### SSH Connection Info API

```typescript
// GET /worktrees/:id/ssh-info
interface SSHConnectionInfo {
  host: string;           // e.g., "agor.example.com"
  port: number;           // e.g., 2247
  username: string;       // User's unix_username
  connection_string: string; // e.g., "ssh alice@agor.example.com -p 2247"
}

app.use('/worktrees/:id/ssh-info', {
  async get(id: WorktreeID, params: AuthenticatedParams): Promise<SSHConnectionInfo> {
    const worktree = await worktreesRepo.findById(id);
    const user = await usersRepo.findById(params.user.user_id);

    // Check user is owner
    const owners = await worktreeOwnersRepo.findByWorktree(id);
    if (!owners.some(o => o.user_id === user.user_id)) {
      throw new Forbidden('Not a worktree owner');
    }

    if (!user.unix_username) {
      throw new BadRequest('User does not have unix_username configured');
    }

    const host = config.ssh?.host || 'localhost';

    return {
      host,
      port: worktree.ssh_port,
      username: user.unix_username,
      connection_string: `ssh ${user.unix_username}@${host} -p ${worktree.ssh_port}`,
    };
  },
});
```

### UI: SSH Connection Display

Show SSH connection info in WorktreeModal:

```tsx
// In WorktreeModal or WorktreeCard
function SSHConnectionInfo({ worktree, user }: Props) {
  const { data: sshInfo } = useQuery(
    ['worktree-ssh-info', worktree.worktree_id],
    () => client.service('worktrees').get(worktree.worktree_id, {
      query: { $select: ['ssh_port'] }
    })
  );

  if (!sshInfo?.ssh_port || !user.unix_username) return null;

  const connectionString = `ssh ${user.unix_username}@${window.location.hostname} -p ${sshInfo.ssh_port}`;

  return (
    <div className="ssh-info">
      <Typography.Text code copyable>
        {connectionString}
      </Typography.Text>
    </div>
  );
}
```

### Security Considerations

1. **Public keys only** - Private keys never leave user's machine
2. **GitHub as source of truth** - Keys always current with user's GitHub
3. **Per-container isolation** - SSH into container A cannot access container B
4. **Owner-only access** - Only worktree owners have their keys added
5. **Port per worktree** - No port conflicts between worktrees

---

## Docker/Podman Inside Container

### Why Podman?

Using Podman inside the worktree container provides:

1. **Complete isolation** - Podman is daemonless, each container has its own instance
2. **No visibility across worktrees** - No shared daemon means no `docker ps` showing other worktrees' containers
3. **Docker CLI compatibility** - `podman-docker` package provides `docker` command
4. **Rootless operation** - Can run without privileged mode

### Docker CLI Compatibility

Users interact with familiar Docker commands, backed by Podman:

```bash
# Inside worktree container - all these work:
docker ps
docker-compose up -d
docker-compose down
docker logs myservice
docker exec -it myservice bash
docker build -t myimage .
```

### How It Works

```
User runs: docker ps
    ↓
/usr/bin/docker (symlink to podman)
    ↓
podman ps
    ↓
Queries Podman's local storage (inside this container only)
    ↓
Returns only this worktree's containers
```

### docker-compose Support

Two options for docker-compose compatibility:

**Option A: podman-compose (Recommended)**
```bash
# Install in container image
pip install podman-compose

# Symlink for compatibility
ln -s /usr/bin/podman-compose /usr/local/bin/docker-compose
```

**Option B: docker-compose with Podman socket**
```bash
# Start Podman socket service
podman system service -t 0 &

# Set Docker host to Podman socket
export DOCKER_HOST=unix:///run/user/$(id -u)/podman/podman.sock

# docker-compose now uses Podman
docker-compose up -d
```

---

## Terminal & SDK Execution

### Terminal Flow (Updated)

```
Browser (xterm.js)
    ↓ WebSocket: terminal:input
Agor Daemon
    ↓ Validates user is worktree owner
    ↓ docker exec -it -u <username> agor-wt-abc123 zellij ...
Container (agor-wt-abc123)
    ↓ Zellij spawns shell as user
PTY inside container
    ↓ Output captured
Agor Daemon
    ↓ WebSocket: terminal:output
Browser (xterm.js renders)
```

### Executor Changes

The executor now runs **inside the container**, not on the host:

```typescript
// apps/agor-daemon/src/services/terminals.ts

async function createTerminalInContainer(
  worktreeId: WorktreeID,
  userId: UserID,
  params: CreateTerminalParams
): Promise<TerminalSession> {
  const worktree = await worktreesRepo.findById(worktreeId);
  const user = await usersRepo.findById(userId);
  const containerName = worktree.container_name;

  // Build docker exec command
  const execCommand = [
    'docker', 'exec', '-it',
    '-u', user.unix_username,
    '-e', `HOME=/home/${user.unix_username}`,
    '-e', 'TERM=xterm-256color',
    '-w', '/workspace',
    containerName,
    'zellij', 'attach', `agor-${formatShortId(userId)}`, '--create',
  ];

  // Spawn PTY running docker exec
  const ptyProcess = pty.spawn(execCommand[0], execCommand.slice(1), {
    cols: params.cols || 160,
    rows: params.rows || 40,
  });

  // ... rest of terminal setup (WebSocket streaming)
}
```

### SDK Execution Inside Container

```typescript
// Modified executor spawning

async function executeSDKInContainer(
  worktreeId: WorktreeID,
  sessionId: SessionID,
  prompt: string
): Promise<void> {
  const worktree = await worktreesRepo.findById(worktreeId);
  const session = await sessionsRepo.findById(sessionId);
  const user = await usersRepo.findById(session.created_by);
  const containerName = worktree.container_name;

  // Prepare environment variables (credentials injected here)
  const envVars = await buildExecutorEnv(user, session);
  const envFlags = Object.entries(envVars)
    .map(([k, v]) => ['-e', `${k}=${v}`])
    .flat();

  // Execute SDK inside container
  const execCommand = [
    'docker', 'exec',
    '-u', user.unix_username,
    '-w', '/workspace',
    ...envFlags,
    containerName,
    'node', '/opt/agor/executor.js', '--stdin',
  ];

  const process = spawn(execCommand[0], execCommand.slice(1), {
    stdio: ['pipe', 'inherit', 'inherit'],
  });

  // Send payload via stdin
  process.stdin.write(JSON.stringify({
    command: 'sdk.query',
    sessionToken,
    params: { prompt, sessionId },
  }));
  process.stdin.end();
}
```

---

## Credential Handling

### Git Credentials via Environment Variables

```typescript
async function buildExecutorEnv(
  user: User,
  session: Session
): Promise<Record<string, string>> {
  const env: Record<string, string> = {};

  // Git credentials
  if (user.github_token) {
    env.GITHUB_TOKEN = user.github_token;
    env.GH_TOKEN = user.github_token;
  }

  // API keys (for SDK)
  const apiKeys = await getApiKeysForUser(user.user_id);
  if (apiKeys.anthropic) {
    env.ANTHROPIC_API_KEY = apiKeys.anthropic;
  }
  if (apiKeys.openai) {
    env.OPENAI_API_KEY = apiKeys.openai;
  }

  // Daemon URL (for executor to connect back)
  env.DAEMON_URL = getDaemonUrl();

  // Session token (for authentication)
  env.AGOR_SESSION_TOKEN = await generateSessionToken(session.session_id);

  return env;
}
```

### Git Configuration Inside Container

```bash
# Inside container, git uses credential helper
git config --global credential.helper '!f() { echo "password=$GITHUB_TOKEN"; }; f'

# Or use GH CLI if installed
gh auth setup-git
```

---

## Network Model

### Default: Full Internet Access

Containers have unrestricted network access for:
- `npm install`, `pip install`, etc.
- API calls (Anthropic, OpenAI, etc.)
- Git operations (clone, fetch, push)

### Isolation Between Worktrees

Each worktree container has its own network namespace:

```yaml
# Containers on default bridge network but isolated by namespace
networks:
  default:
    driver: bridge
```

### docker-compose Networking Inside Container

When user runs `docker-compose up` inside the worktree container:

```
Worktree Container (agor-wt-abc)
└─ Podman network namespace
   └─ Compose services (web, db, redis)
      └─ Can communicate with each other
      └─ Cannot see other worktrees' compose services
```

---

## Container Image Specification

### Base Image: `agor/workspace`

```dockerfile
# Dockerfile for agor/workspace

FROM ubuntu:24.04

# System packages
RUN apt-get update && apt-get install -y \
    # Shell & terminal
    bash \
    zsh \
    zellij \
    tmux \
    # SSH server
    openssh-server \
    # Development tools
    git \
    curl \
    wget \
    vim \
    nano \
    # Build essentials
    build-essential \
    # Node.js (for executor)
    nodejs \
    npm \
    # Python
    python3 \
    python3-pip \
    # Container runtime (Podman + Docker CLI compat)
    podman \
    podman-docker \
    # Networking tools
    iputils-ping \
    dnsutils \
    # Misc
    sudo \
    locales \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Configure SSH server
RUN mkdir -p /run/sshd && \
    # Disable root login
    sed -i 's/#PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config && \
    # Allow pubkey auth
    sed -i 's/#PubkeyAuthentication.*/PubkeyAuthentication yes/' /etc/ssh/sshd_config && \
    # Disable password auth (pubkey only)
    sed -i 's/#PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config

# Install podman-compose
RUN pip3 install podman-compose

# Symlink for docker-compose compatibility
RUN ln -sf /usr/bin/podman-compose /usr/local/bin/docker-compose

# Configure Podman for rootless operation
RUN echo 'unqualified-search-registries = ["docker.io"]' >> /etc/containers/registries.conf

# Install Agor executor
COPY packages/executor/dist /opt/agor/
RUN chmod +x /opt/agor/executor.js

# Set locale
RUN locale-gen en_US.UTF-8
ENV LANG=en_US.UTF-8
ENV LC_ALL=en_US.UTF-8

# Working directory
WORKDIR /workspace

# Expose SSH port
EXPOSE 22

# Start SSH daemon and keep container running
CMD ["/bin/bash", "-c", "/usr/sbin/sshd && sleep infinity"]
```

### Building and Publishing

```bash
# Build
docker build -t agor/workspace:latest -f docker/Dockerfile.workspace .

# Tag versions
docker tag agor/workspace:latest agor/workspace:v0.5.0

# Push to registry (for cloud deployments)
docker push agor/workspace:latest
```

---

## Implementation Plan

### Phase 1: Container Lifecycle Management

**Files to create/modify:**

- `apps/agor-daemon/src/services/worktree-containers.ts` (new)
- `apps/agor-daemon/src/services/worktrees.ts` (modify)
- `packages/core/src/types/worktree.ts` (add container fields)
- `packages/core/src/db/schema.ts` (add container columns)

**Tasks:**

- [ ] Add `container_name`, `container_status` columns to worktrees table
- [ ] Create `WorktreeContainersService` with create/destroy methods
- [ ] Hook into worktree creation/deletion lifecycle
- [ ] Handle container startup on daemon restart (ensure containers running)

### Phase 2: User Management Inside Containers

**Tasks:**

- [ ] Create users inside container when owner added
- [ ] Remove users when owner removed
- [ ] Preserve UID/GID from host user records
- [ ] Create home directory structure inside container

### Phase 2.5: SSH Access

**Files to create/modify:**

- `apps/agor-daemon/src/services/worktree-containers.ts` (add SSH key setup)
- `apps/agor-daemon/src/services/worktrees.ts` (add ssh-info endpoint)
- `packages/core/src/types/worktree.ts` (add ssh_port field)
- `packages/core/src/db/schema.ts` (add ssh_port column)
- `apps/agor-ui/src/components/WorktreeModal.tsx` (show SSH connection)

**Tasks:**

- [ ] Add `ssh_port` column to worktrees table
- [ ] Implement port allocation (base_port + unique_id)
- [ ] Expose SSH port when creating container
- [ ] Implement `fetchGitHubSSHKeys()` helper
- [ ] Add SSH key setup in `createUserInContainer()`
- [ ] Add `GET /worktrees/:id/ssh-info` endpoint
- [ ] Add SSH connection string display in UI
- [ ] Add key refresh endpoint `POST /worktrees/:id/refresh-ssh-keys`

### Phase 3: Terminal Execution in Container

**Files to modify:**

- `apps/agor-daemon/src/services/terminals.ts`
- `packages/executor/src/commands/zellij.ts`

**Tasks:**

- [ ] Modify terminal spawning to use `docker exec`
- [ ] Pass environment variables via `-e` flags
- [ ] Handle user context (`-u` flag)
- [ ] Update Zellij session naming for container context

### Phase 4: SDK Execution in Container

**Files to modify:**

- `apps/agor-daemon/src/utils/spawn-executor.ts`
- `packages/executor/src/commands/sdk.ts`

**Tasks:**

- [ ] Modify executor spawning to use `docker exec`
- [ ] Inject credentials via environment variables
- [ ] Ensure executor can connect back to daemon (DAEMON_URL)
- [ ] Test Claude/Codex/Gemini execution inside container

### Phase 5: Container Image

**Files to create:**

- `docker/Dockerfile.workspace`
- `docker/docker-compose.workspace.yml` (for local dev)

**Tasks:**

- [ ] Create base image with all required tools
- [ ] Install and configure Podman + podman-docker
- [ ] Install executor
- [ ] Test docker/docker-compose commands inside container
- [ ] Set up image build in CI/CD

### Phase 6: Testing & Migration

**Tasks:**

- [ ] Integration tests for container lifecycle
- [ ] Test multi-user access to same container
- [ ] Test docker-compose isolation between worktrees
- [ ] Performance testing (container startup time)
- [ ] Migration guide for existing worktrees

---

## Configuration

### New Config Schema

```yaml
# ~/.agor/config.yaml

execution:
  # Enable container isolation (default: false for backward compat)
  container_isolation: true

  # Container settings
  containers:
    # Base image for worktree containers
    image: agor/workspace:latest

    # Container runtime (docker or podman)
    runtime: docker

    # Restart policy
    restart_policy: unless-stopped

    # Resource limits (optional)
    resources:
      memory: 4g
      cpus: 2

    # Additional volumes to mount (optional)
    extra_volumes: []

    # Additional environment variables (optional)
    extra_env: {}

  # SSH settings
  ssh:
    # Enable SSH access to containers
    enabled: true

    # Base port for SSH (worktree gets base_port + unique_id)
    base_port: 2222

    # Host to display in connection strings (defaults to daemon host)
    host: agor.example.com

    # Auto-refresh keys from GitHub (interval in hours, 0 = disabled)
    key_refresh_interval: 24
```

### Feature Flag

```typescript
function isContainerIsolationEnabled(): boolean {
  return config.execution?.container_isolation === true;
}

// In worktree creation
if (isContainerIsolationEnabled()) {
  await createWorktreeContainer(worktreeId);
} else {
  // Fall back to current Unix groups model
  await initializeWorktreeGroup(worktreeId, ...);
}
```

---

## Migration from Current Model

### For Existing Worktrees

When container isolation is enabled, existing worktrees need containers created:

```typescript
async function migrateExistingWorktrees(): Promise<void> {
  const worktrees = await worktreesRepo.findAll();

  for (const worktree of worktrees) {
    if (!worktree.container_name) {
      logger.info(`Migrating worktree ${worktree.name} to container model`);
      await createWorktreeContainer(worktree.worktree_id);
    }
  }
}

// Run on daemon startup if container isolation enabled
if (isContainerIsolationEnabled()) {
  await migrateExistingWorktrees();
}
```

### Rollback

If issues arise, can disable container isolation:

```yaml
execution:
  container_isolation: false
```

Containers will remain but won't be used. Can clean up manually:

```bash
docker ps -a --filter "label=agor.managed=true" -q | xargs docker rm -f
```

---

## Trade-offs

### Benefits

| Aspect | Benefit |
|--------|---------|
| **Isolation** | Complete namespace isolation (PID, network, mount) |
| **docker-compose** | Per-worktree isolation via Podman |
| **Security** | Container escape required to access other worktrees |
| **Consistency** | Same environment across all users/worktrees |
| **Simplicity** | No Unix groups, ACLs, or custom proxies |

### Costs

| Aspect | Cost |
|--------|------|
| **Resources** | Container overhead (~50-100MB per container) |
| **Startup** | Container creation adds ~2-5 seconds to worktree creation |
| **Disk** | Podman image cache per container (mitigatable) |
| **Complexity** | Docker dependency on host |

### Comparison with Alternatives

| Approach | Isolation | Complexity | Resource Usage |
|----------|-----------|------------|----------------|
| Unix Groups (current) | Filesystem only | Medium | Low |
| Docker + Socket Proxy | Filtered daemon | High (custom proxy) | Low |
| Rootless Docker per worktree | Complete | Medium | High (N daemons) |
| **Docker + Podman inside (chosen)** | Complete | Low | Medium |

---

## Open Questions

### Q1: Shared Podman Image Cache?

**Problem:** Each container has its own Podman image cache, duplicating storage.

**Potential solutions:**
- Mount shared volume for Podman storage (risk: conflicts)
- Use registry mirror on host
- Accept duplication (simplest)

**Recommendation:** Start with duplication, optimize later if disk becomes an issue.

### Q2: Container Resource Limits?

**Decision:** Make configurable but optional.

```yaml
containers:
  resources:
    memory: 4g  # Optional
    cpus: 2     # Optional
```

### Q3: Custom Images Per Worktree?

**Scenario:** Team wants Node 18 in one worktree, Node 20 in another.

**Options:**
- Allow `container_image` field on worktree model
- Use `.agor/Dockerfile` in worktree to customize
- Provide image variants (agor/workspace:node18, agor/workspace:node20)

**Recommendation:** Start with single image, add customization in v2.

### Q4: What Happens When Container Dies?

**Scenario:** Container crashes or is manually stopped.

**Solution:**
- Daemon detects on next terminal/exec request
- Auto-restart container
- Health check endpoint for monitoring

```typescript
async function ensureContainerRunning(containerName: string): Promise<void> {
  const info = await docker.inspectContainer(containerName);

  if (info.State.Status !== 'running') {
    await docker.startContainer(containerName);
  }
}
```

---

## Summary

**Isolated Terminal Containers** provides OS-level isolation by running each worktree in its own Docker container. Key features:

- **One container per worktree** - Lives as long as worktree exists
- **Multi-user support** - All owners share container with separate user accounts
- **Podman inside** - Docker CLI compatible, isolated from other worktrees
- **Dual access** - Web terminal (xterm.js) AND SSH access
- **SSH keys from GitHub** - Public keys fetched automatically, no database storage
- **Per-worktree SSH ports** - Unique port per container (2222 + unique_id)
- **Credentials via env vars** - Git tokens, API keys injected at exec time

This approach provides stronger isolation than Unix groups while remaining simpler than custom proxy solutions.

---

## References

- [Podman Documentation](https://podman.io/docs)
- [podman-docker compatibility](https://podman.io/docs/installation)
- [Docker SDK for Node.js](https://github.com/apocas/dockerode)
- Related: `executor-isolation.md`, `unix-user-modes.md`
