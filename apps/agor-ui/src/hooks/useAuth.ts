/**
 * Authentication Hook
 *
 * Manages user authentication state and provides login/logout functions
 */

import { createClient } from '@agor/core/api';
import type { User } from '@agor/core/types';
import { useCallback, useEffect, useState } from 'react';

interface AuthState {
  user: User | null;
  accessToken: string | null;
  authenticated: boolean;
  loading: boolean;
  error: string | null;
}

interface UseAuthReturn extends AuthState {
  login: (email: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  reAuthenticate: () => Promise<void>;
}

const DAEMON_URL = 'http://localhost:3030';
const ACCESS_TOKEN_KEY = 'agor-access-token';
const REFRESH_TOKEN_KEY = 'agor-refresh-token';

/**
 * Authentication hook
 */
export function useAuth(): UseAuthReturn {
  const [state, setState] = useState<AuthState>({
    user: null,
    accessToken: null,
    authenticated: false,
    loading: true,
    error: null,
  });

  /**
   * Re-authenticate using stored token (with automatic refresh)
   */
  const reAuthenticate = useCallback(async () => {
    setState(prev => ({ ...prev, loading: true, error: null }));

    try {
      const storedAccessToken = localStorage.getItem(ACCESS_TOKEN_KEY);
      const storedRefreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);

      if (!storedAccessToken && !storedRefreshToken) {
        setState({
          user: null,
          accessToken: null,
          authenticated: false,
          loading: false,
          error: null,
        });
        return;
      }

      // Create temporary client
      const client = createClient(DAEMON_URL);

      // Connect the client first (since autoConnect is false)
      client.io.connect();

      // Wait for connection
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Connection timeout')), 5000);

        if (client.io.connected) {
          clearTimeout(timeout);
          resolve();
          return;
        }

        client.io.once('connect', () => {
          clearTimeout(timeout);
          resolve();
        });

        client.io.once('connect_error', err => {
          clearTimeout(timeout);
          reject(err);
        });
      });

      // Try to authenticate with stored access token first
      if (storedAccessToken) {
        try {
          const result = await client.authenticate({
            strategy: 'jwt',
            accessToken: storedAccessToken,
          });

          setState({
            user: result.user,
            accessToken: result.accessToken,
            authenticated: true,
            loading: false,
            error: null,
          });

          client.io.close();
          return;
        } catch (_accessTokenError) {
          // Access token expired, try refresh token
          console.log('Access token expired, attempting refresh...');
        }
      }

      // Access token expired or missing, try refresh token
      if (storedRefreshToken) {
        try {
          const refreshResult = await client.service('authentication/refresh').create({
            refreshToken: storedRefreshToken,
          });

          // Store new access token
          localStorage.setItem(ACCESS_TOKEN_KEY, refreshResult.accessToken);

          setState({
            user: refreshResult.user,
            accessToken: refreshResult.accessToken,
            authenticated: true,
            loading: false,
            error: null,
          });

          console.log('✓ Token refreshed successfully');
          client.io.close();
          return;
        } catch (_refreshError) {
          // Refresh token also expired
          console.log('Refresh token expired, need to login again');
        }
      }

      // Both tokens invalid or expired
      localStorage.removeItem(ACCESS_TOKEN_KEY);
      localStorage.removeItem(REFRESH_TOKEN_KEY);
      setState({
        user: null,
        accessToken: null,
        authenticated: false,
        loading: false,
        error: null,
      });
      client.io.close();
    } catch (_error) {
      // Connection or other error
      localStorage.removeItem(ACCESS_TOKEN_KEY);
      localStorage.removeItem(REFRESH_TOKEN_KEY);
      setState({
        user: null,
        accessToken: null,
        authenticated: false,
        loading: false,
        error: null,
      });
    }
  }, []);

  // Try to re-authenticate on mount (using stored token)
  useEffect(() => {
    reAuthenticate();
  }, [reAuthenticate]);

  // Auto-refresh token 5 minutes before expiration
  useEffect(() => {
    if (!state.authenticated || !state.accessToken) return;

    // Access token expires in 1 hour, refresh after 55 minutes
    const REFRESH_INTERVAL = 55 * 60 * 1000; // 55 minutes in milliseconds

    const refreshTimer = setInterval(async () => {
      const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
      if (!refreshToken) {
        console.log('No refresh token available');
        return;
      }

      try {
        const client = createClient(DAEMON_URL);
        client.io.connect();

        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('Connection timeout')), 5000);

          if (client.io.connected) {
            clearTimeout(timeout);
            resolve();
            return;
          }

          client.io.once('connect', () => {
            clearTimeout(timeout);
            resolve();
          });

          client.io.once('connect_error', err => {
            clearTimeout(timeout);
            reject(err);
          });
        });

        const refreshResult = await client.service('authentication/refresh').create({
          refreshToken,
        });

        // Store new access token
        localStorage.setItem(ACCESS_TOKEN_KEY, refreshResult.accessToken);

        setState(prev => ({
          ...prev,
          accessToken: refreshResult.accessToken,
          user: refreshResult.user,
        }));

        console.log('✓ Token auto-refreshed successfully');
        client.io.close();
      } catch (error) {
        console.error('Failed to auto-refresh token:', error);
        // Token refresh failed, user needs to login again
        localStorage.removeItem(ACCESS_TOKEN_KEY);
        localStorage.removeItem(REFRESH_TOKEN_KEY);
        setState({
          user: null,
          accessToken: null,
          authenticated: false,
          loading: false,
          error: 'Session expired, please login again',
        });
      }
    }, REFRESH_INTERVAL);

    return () => clearInterval(refreshTimer);
  }, [state.authenticated, state.accessToken]);

  /**
   * Login with email and password
   */
  const login = async (email: string, password: string): Promise<boolean> => {
    setState(prev => ({ ...prev, loading: true, error: null }));

    try {
      // Create temporary client for login
      const client = createClient(DAEMON_URL);

      // Connect the client first (since autoConnect is false)
      client.io.connect();

      // Wait for connection
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Connection timeout')), 5000);

        if (client.io.connected) {
          clearTimeout(timeout);
          resolve();
          return;
        }

        client.io.once('connect', () => {
          clearTimeout(timeout);
          resolve();
        });

        client.io.once('connect_error', err => {
          clearTimeout(timeout);
          reject(err);
        });
      });

      // Authenticate
      const result = await client.authenticate({
        strategy: 'local',
        email,
        password,
      });

      // Store both access and refresh tokens
      localStorage.setItem(ACCESS_TOKEN_KEY, result.accessToken);
      if (result.refreshToken) {
        localStorage.setItem(REFRESH_TOKEN_KEY, result.refreshToken);
        console.log('✓ Tokens stored in localStorage (access + refresh)');
      }

      setState({
        user: result.user,
        accessToken: result.accessToken,
        authenticated: true,
        loading: false,
        error: null,
      });

      // Clean up temporary client
      client.io.close();

      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Login failed';
      setState(prev => ({
        ...prev,
        loading: false,
        error: errorMessage,
      }));
      return false;
    }
  };

  /**
   * Logout
   */
  const logout = async () => {
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    setState({
      user: null,
      accessToken: null,
      authenticated: false,
      loading: false,
      error: null,
    });
  };

  return {
    ...state,
    login,
    logout,
    reAuthenticate,
  };
}
