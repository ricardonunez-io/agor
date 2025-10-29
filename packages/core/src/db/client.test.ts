/**
 * Tests for LibSQL Client Factory
 *
 * Tests database client creation, configuration, and error handling.
 * Does NOT test LibSQL/Drizzle internals - only our wrapper logic.
 */

import { createClient } from '@libsql/client';
import { describe, expect, it, vi } from 'vitest';
import {
  createDatabase,
  createLocalDatabase,
  DatabaseConnectionError,
  type DbConfig,
  DEFAULT_DB_PATH,
} from './client';

// Mock @libsql/client to avoid actual database connections
vi.mock('@libsql/client', () => ({
  createClient: vi.fn(() => ({
    // Mock client object
    execute: vi.fn(),
    close: vi.fn(),
  })),
}));

// Mock drizzle to avoid requiring real schema
vi.mock('drizzle-orm/libsql', () => ({
  drizzle: vi.fn((client, config) => ({
    _client: client,
    _config: config,
    // Mock Drizzle database methods
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  })),
}));

// Mock schema to avoid importing full schema
vi.mock('./schema', () => ({
  // Empty schema for testing
}));

describe('createDatabase', () => {
  it('should create database with local file URL', () => {
    const db = createDatabase({ url: 'file:/tmp/test.db' });

    expect(createClient).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'file:/tmp/test.db',
      })
    );
    expect(db).toBeDefined();
  });

  it('should create database with memory URL', () => {
    const db = createDatabase({ url: ':memory:' });

    expect(createClient).toHaveBeenCalledWith(
      expect.objectContaining({
        url: ':memory:',
      })
    );
    expect(db).toBeDefined();
  });

  it('should create database with remote Turso URL', () => {
    const config: DbConfig = {
      url: 'libsql://my-db.turso.io',
      authToken: 'test-token',
    };

    const db = createDatabase(config);

    expect(createClient).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'libsql://my-db.turso.io',
        authToken: 'test-token',
      })
    );
    expect(db).toBeDefined();
  });

  it('should include authToken when provided', () => {
    createDatabase({
      url: 'libsql://test.turso.io',
      authToken: 'secret-token',
    });

    expect(createClient).toHaveBeenCalledWith(
      expect.objectContaining({
        authToken: 'secret-token',
      })
    );
  });

  it('should omit authToken when not provided', () => {
    createDatabase({ url: 'file:/tmp/test.db' });

    expect(createClient).toHaveBeenCalledWith(
      expect.not.objectContaining({
        authToken: expect.anything(),
      })
    );
  });

  it('should configure embedded replica with sync options', () => {
    createDatabase({
      url: 'file:~/.agor/local.db',
      syncUrl: 'libsql://remote.turso.io',
      authToken: 'token',
      syncInterval: 120,
    });

    expect(createClient).toHaveBeenCalledWith(
      expect.objectContaining({
        syncUrl: 'libsql://remote.turso.io',
        syncInterval: 120,
      })
    );
  });

  it('should use default sync interval when not provided', () => {
    createDatabase({
      url: 'file:~/.agor/local.db',
      syncUrl: 'libsql://remote.turso.io',
      authToken: 'token',
    });

    expect(createClient).toHaveBeenCalledWith(
      expect.objectContaining({
        syncInterval: 60,
      })
    );
  });

  it('should omit sync config when syncUrl not provided', () => {
    createDatabase({ url: 'file:/tmp/test.db' });

    expect(createClient).toHaveBeenCalledWith(
      expect.not.objectContaining({
        syncUrl: expect.anything(),
        syncInterval: expect.anything(),
      })
    );
  });
});

describe('path expansion', () => {
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;

  // Helper to restore environment after each test
  function restoreEnv() {
    if (originalHome !== undefined) {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }
    if (originalUserProfile !== undefined) {
      process.env.USERPROFILE = originalUserProfile;
    } else {
      delete process.env.USERPROFILE;
    }
  }

  it('should expand ~ in file paths using HOME', () => {
    process.env.HOME = '/home/testuser';
    delete process.env.USERPROFILE;

    createDatabase({ url: 'file:~/.agor/test.db' });

    expect(createClient).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'file:/home/testuser/.agor/test.db',
      })
    );

    restoreEnv();
  });

  it('should expand ~ using USERPROFILE when HOME not set', () => {
    delete process.env.HOME;
    process.env.USERPROFILE = 'C:\\Users\\testuser';

    createDatabase({ url: 'file:~/.agor/test.db' });

    expect(createClient).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'file:C:\\Users\\testuser/.agor/test.db',
      })
    );

    restoreEnv();
  });

  it('should handle empty home directory gracefully', () => {
    delete process.env.HOME;
    delete process.env.USERPROFILE;

    createDatabase({ url: 'file:~/.agor/test.db' });

    expect(createClient).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'file:/.agor/test.db',
      })
    );

    restoreEnv();
  });

  it('should not expand ~ in non-file URLs', () => {
    process.env.HOME = '/home/testuser';

    createDatabase({ url: 'libsql://~/database.turso.io' });

    expect(createClient).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'libsql://~/database.turso.io',
      })
    );

    restoreEnv();
  });

  it('should not expand ~ in memory URLs', () => {
    process.env.HOME = '/home/testuser';

    createDatabase({ url: ':memory:' });

    expect(createClient).toHaveBeenCalledWith(
      expect.objectContaining({
        url: ':memory:',
      })
    );

    restoreEnv();
  });

  it('should preserve absolute paths without expansion', () => {
    process.env.HOME = '/home/testuser';

    createDatabase({ url: 'file:/absolute/path/db.sqlite' });

    expect(createClient).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'file:/absolute/path/db.sqlite',
      })
    );

    restoreEnv();
  });

  it('should only expand ~ at start of path', () => {
    process.env.HOME = '/home/testuser';

    createDatabase({ url: 'file:/path/~/db.sqlite' });

    expect(createClient).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'file:/path/~/db.sqlite',
      })
    );

    restoreEnv();
  });
});

describe('error handling', () => {
  it('should throw DatabaseConnectionError when client creation fails', () => {
    const mockError = new Error('Connection refused');
    vi.mocked(createClient).mockImplementationOnce(() => {
      throw mockError;
    });

    expect(() => createDatabase({ url: 'invalid://url' })).toThrow(DatabaseConnectionError);
  });

  it('should include original error message in DatabaseConnectionError', () => {
    const mockError = new Error('Network timeout');
    vi.mocked(createClient).mockImplementationOnce(() => {
      throw mockError;
    });

    try {
      createDatabase({ url: 'libsql://unreachable.turso.io' });
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(DatabaseConnectionError);
      expect((err as DatabaseConnectionError).message).toContain('Network timeout');
    }
  });

  it('should preserve cause in DatabaseConnectionError', () => {
    const mockError = new Error('Original error');
    vi.mocked(createClient).mockImplementationOnce(() => {
      throw mockError;
    });

    try {
      createDatabase({ url: 'file:/invalid' });
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(DatabaseConnectionError);
      expect((err as DatabaseConnectionError).cause).toBe(mockError);
    }
  });

  it('should handle non-Error objects thrown by createClient', () => {
    vi.mocked(createClient).mockImplementationOnce(() => {
      throw 'string error';
    });

    try {
      createDatabase({ url: 'file:/test.db' });
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(DatabaseConnectionError);
      expect((err as DatabaseConnectionError).message).toContain('string error');
    }
  });

  it('should set proper error name', () => {
    vi.mocked(createClient).mockImplementationOnce(() => {
      throw new Error('Test error');
    });

    try {
      createDatabase({ url: 'file:/test.db' });
      expect.fail('Should have thrown');
    } catch (err) {
      expect((err as DatabaseConnectionError).name).toBe('DatabaseConnectionError');
    }
  });
});

describe('createLocalDatabase', () => {
  it('should use DEFAULT_DB_PATH when no path provided', () => {
    createLocalDatabase();

    expect(createClient).toHaveBeenCalledWith(
      expect.objectContaining({
        url: expect.stringContaining('.agor/agor.db'),
      })
    );
  });

  it('should use custom path when provided', () => {
    createLocalDatabase('file:/custom/path/db.sqlite');

    expect(createClient).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'file:/custom/path/db.sqlite',
      })
    );
  });

  it('should expand ~ in custom path', () => {
    const originalHome = process.env.HOME;
    process.env.HOME = '/home/user';

    createLocalDatabase('file:~/custom.db');

    expect(createClient).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'file:/home/user/custom.db',
      })
    );

    if (originalHome !== undefined) {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }
  });

  it('should not include auth or sync options', () => {
    createLocalDatabase();

    expect(createClient).toHaveBeenCalledWith(
      expect.not.objectContaining({
        authToken: expect.anything(),
        syncUrl: expect.anything(),
        syncInterval: expect.anything(),
      })
    );
  });
});

describe('constants', () => {
  it('should export DEFAULT_DB_PATH', () => {
    expect(DEFAULT_DB_PATH).toBe('file:~/.agor/agor.db');
  });
});

describe('integration scenarios', () => {
  it('should handle full offline-first replica configuration', () => {
    const config: DbConfig = {
      url: 'file:~/.agor/replica.db',
      syncUrl: 'libsql://prod.turso.io',
      authToken: 'prod-token-xyz',
      syncInterval: 300,
    };

    const db = createDatabase(config);

    expect(createClient).toHaveBeenCalledWith(
      expect.objectContaining({
        url: expect.stringContaining('replica.db'),
        syncUrl: 'libsql://prod.turso.io',
        authToken: 'prod-token-xyz',
        syncInterval: 300,
      })
    );
    expect(db).toBeDefined();
  });

  it('should handle minimal local-only configuration', () => {
    const db = createDatabase({ url: ':memory:' });

    expect(createClient).toHaveBeenCalledWith({
      url: ':memory:',
    });
    expect(db).toBeDefined();
  });

  it('should handle remote-only configuration', () => {
    const db = createDatabase({
      url: 'libsql://staging.turso.io',
      authToken: 'staging-token',
    });

    expect(createClient).toHaveBeenCalledWith({
      url: 'libsql://staging.turso.io',
      authToken: 'staging-token',
    });
    expect(db).toBeDefined();
  });
});
