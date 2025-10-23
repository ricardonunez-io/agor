#!/usr/bin/env tsx

/**
 * Generate CLI documentation from oclif commands
 */

import { execSync } from 'child_process';
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CLI_DIR = join(__dirname, '../../agor-cli');
const DOCS_DIR = join(__dirname, '../pages/cli');

// Ensure docs directory exists
mkdirSync(DOCS_DIR, { recursive: true });

// List of command groups to document
const commandGroups = [
  { name: 'session', title: 'Session Commands' },
  { name: 'repo', title: 'Repository Commands' },
  { name: 'board', title: 'Board Commands' },
  { name: 'user', title: 'User Commands' },
  { name: 'config', title: 'Configuration Commands' },
];

console.log('Generating CLI documentation...');

// Generate overview page
const overviewContent = `# CLI Reference

Command-line interface for Agor.

## Installation

The CLI is included when you install Agor:

\`\`\`bash
pnpm install
pnpm agor --help
\`\`\`

## Available Commands

${commandGroups.map(group => `- [${group.title}](/cli/${group.name})`).join('\n')}

## Global Options

- \`--help\` - Show help for any command
- \`--version\` - Show CLI version

## Examples

\`\`\`bash
# List all sessions
pnpm agor session list

# Load a Claude Code session
pnpm agor session load-claude <session-id>

# Add a repository
pnpm agor repo add https://github.com/user/repo

# Show configuration
pnpm agor config
\`\`\`
`;

writeFileSync(join(DOCS_DIR, 'index.mdx'), overviewContent);
console.log('✓ Generated CLI overview');

// Generate command group pages
for (const group of commandGroups) {
  try {
    // Get help output from oclif
    const helpOutput = execSync(`cd ${CLI_DIR} && pnpm exec tsx bin/dev.ts ${group.name} --help`, {
      encoding: 'utf-8',
    });

    // Parse help output into sections
    const lines = helpOutput.split('\n');
    const commands: Array<{ name: string; description: string }> = [];

    let inCommandsSection = false;
    for (const line of lines) {
      if (line.includes('COMMANDS')) {
        inCommandsSection = true;
        continue;
      }

      if (inCommandsSection && line.trim()) {
        const match = line.match(/^\s+([a-z-]+\s+[a-z-]+)\s+(.+)$/);
        if (match) {
          commands.push({ name: match[1], description: match[2] });
        }
      }
    }

    // Generate markdown for this command group
    let markdown = `# ${group.title}

Commands for managing ${group.name}s in Agor.

## Commands

`;

    for (const cmd of commands) {
      // cmd.name already contains the full command (e.g., "session list")
      const fullCommand = cmd.name;

      // Get detailed help for each command
      try {
        const cmdHelp = execSync(
          `cd ${CLI_DIR} && pnpm exec tsx bin/dev.ts ${fullCommand} --help`,
          { encoding: 'utf-8' }
        );

        markdown += `### \`agor ${fullCommand}\`

${cmd.description}

\`\`\`bash
agor ${fullCommand}
\`\`\`

<details>
<summary>Full help output</summary>

\`\`\`
${cmdHelp.trim()}
\`\`\`

</details>

`;
      } catch (error) {
        markdown += `### \`agor ${fullCommand}\`

${cmd.description}

\`\`\`bash
agor ${fullCommand}
\`\`\`

`;
      }
    }

    writeFileSync(join(DOCS_DIR, `${group.name}.mdx`), markdown);
    console.log(`✓ Generated ${group.name} commands`);
  } catch (error) {
    console.error(`✗ Failed to generate ${group.name} docs:`, error);
  }
}

// Update _meta.ts
const metaContent = `export default {
  index: 'Overview',
${commandGroups.map(group => `  '${group.name}': '${group.title}',`).join('\n')}
};
`;

writeFileSync(join(DOCS_DIR, '_meta.ts'), metaContent);
console.log('✓ Updated CLI navigation');

console.log('\n✅ CLI documentation generated successfully!');
