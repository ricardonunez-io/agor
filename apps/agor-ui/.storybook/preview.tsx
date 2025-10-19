import type { Preview } from '@storybook/react-vite';
import { App, ConfigProvider, theme } from 'antd';

// Global decorator to wrap all stories with Ant Design ConfigProvider
const withAntdTheme = (Story, context) => {
  const isDark = context.globals.theme === 'dark';

  return (
    <ConfigProvider
      theme={{
        algorithm: isDark ? theme.darkAlgorithm : theme.defaultAlgorithm,
      }}
    >
      <App>
        <Story />
      </App>
    </ConfigProvider>
  );
};

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    backgrounds: {
      default: 'dark',
      values: [
        { name: 'dark', value: '#141414' },
        { name: 'light', value: '#ffffff' },
      ],
    },
    options: {
      storySort: {
        order: ['App', '*'],
      },
    },
    viewMode: 'story',
  },
  decorators: [withAntdTheme],
  globalTypes: {
    theme: {
      name: 'Theme',
      description: 'Global theme for components',
      defaultValue: 'dark',
      toolbar: {
        icon: 'circlehollow',
        items: [
          { value: 'light', title: 'Light', icon: 'sun' },
          { value: 'dark', title: 'Dark', icon: 'moon' },
        ],
        showName: true,
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: {
    theme: 'dark',
  },
};

export default preview;
