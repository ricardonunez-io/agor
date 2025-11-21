import type { Meta, StoryObj } from '@storybook/react';
import { Card, ConfigProvider, Space, Typography, theme } from 'antd';
import { useState } from 'react';
import { EmojiAutocompleteTextarea } from './EmojiAutocompleteTextarea';

const { Text, Paragraph } = Typography;

const meta = {
  title: 'Components/EmojiAutocompleteTextarea',
  component: EmojiAutocompleteTextarea,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'A textarea component with inline emoji autocomplete. Type `:` followed by an emoji shortcode (like `:smile`) to trigger the autocomplete dropdown.',
      },
    },
  },
  tags: ['autodocs'],
  argTypes: {
    placeholder: {
      control: 'text',
      description: 'Placeholder text for the textarea',
    },
    minRows: {
      control: 'number',
      description: 'Minimum number of rows',
    },
    maxRows: {
      control: 'number',
      description: 'Maximum number of rows',
    },
    disabled: {
      control: 'boolean',
      description: 'Whether the textarea is disabled',
    },
  },
} satisfies Meta<typeof EmojiAutocompleteTextarea>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Wrapper component to manage state for stories
 */
const StatefulTextarea = (props: React.ComponentProps<typeof EmojiAutocompleteTextarea>) => {
  const [value, setValue] = useState(props.value || '');

  return (
    <div style={{ width: '600px' }}>
      <EmojiAutocompleteTextarea {...props} value={value} onChange={setValue} />
      <div style={{ marginTop: 16, padding: 12, background: '#f5f5f5', borderRadius: 4 }}>
        <Text strong>Current value:</Text>
        <Paragraph style={{ marginTop: 8, marginBottom: 0, whiteSpace: 'pre-wrap' }}>
          {value || '(empty)'}
        </Paragraph>
      </div>
    </div>
  );
};

/**
 * Default story with basic usage
 */
export const Default: Story = {
  render: (args) => <StatefulTextarea {...args} />,
  args: {
    placeholder: 'Type : followed by emoji name (e.g., :smile)',
    minRows: 3,
    maxRows: 10,
  },
};

/**
 * Story with pre-filled content
 */
export const WithContent: Story = {
  render: (args) => <StatefulTextarea {...args} />,
  args: {
    value: 'Hello! 👋 Try typing :fire or :rocket to see autocomplete in action!',
    placeholder: 'Type : to insert emoji...',
    minRows: 4,
  },
};

/**
 * Story showing common emoji examples
 */
export const WithExamples: Story = {
  render: (args) => (
    <Space direction="vertical" size="large" style={{ width: '600px' }}>
      <Card title="Try these emoji shortcuts">
        <Space direction="vertical" size="small">
          <Text>
            <Text code>:smile</Text> → 😄
          </Text>
          <Text>
            <Text code>:fire</Text> → 🔥
          </Text>
          <Text>
            <Text code>:rocket</Text> → 🚀
          </Text>
          <Text>
            <Text code>:heart</Text> → ❤️
          </Text>
          <Text>
            <Text code>:thumbsup</Text> → 👍
          </Text>
          <Text>
            <Text code>:check</Text> → ✅
          </Text>
          <Text>
            <Text code>:sparkles</Text> → ✨
          </Text>
          <Text>
            <Text code>:bug</Text> → 🐛
          </Text>
        </Space>
      </Card>
      <StatefulTextarea {...args} />
    </Space>
  ),
  args: {
    placeholder: 'Type : followed by an emoji shortcode...',
    minRows: 5,
  },
};

/**
 * Disabled state
 */
export const Disabled: Story = {
  render: (args) => <StatefulTextarea {...args} />,
  args: {
    value: 'This textarea is disabled 🔒',
    disabled: true,
    minRows: 3,
  },
};

/**
 * Compact size with fewer rows
 */
export const Compact: Story = {
  render: (args) => <StatefulTextarea {...args} />,
  args: {
    placeholder: 'Compact textarea with emoji support...',
    minRows: 2,
    maxRows: 6,
  },
};

/**
 * Large textarea for longer content
 */
export const Large: Story = {
  render: (args) => <StatefulTextarea {...args} />,
  args: {
    placeholder: 'Large textarea for longer messages...',
    minRows: 8,
    maxRows: 20,
  },
};

/**
 * Dark theme demonstration
 */
export const DarkTheme: Story = {
  render: (args) => (
    <ConfigProvider
      theme={{
        algorithm: theme.darkAlgorithm,
      }}
    >
      <div style={{ padding: 24, background: '#141414', minHeight: '400px' }}>
        <Space direction="vertical" size="large" style={{ width: '600px' }}>
          <div>
            <Text style={{ color: '#fff' }}>Emoji autocomplete in dark mode</Text>
          </div>
          <StatefulTextarea {...args} />
        </Space>
      </div>
    </ConfigProvider>
  ),
  args: {
    value: 'Dark mode looks great! Try :moon or :star',
    placeholder: 'Type : to insert emoji...',
    minRows: 5,
  },
};

/**
 * Interactive playground with multiple examples
 */
export const Playground: Story = {
  render: () => {
    const [comment, setComment] = useState('');
    const [note, setNote] = useState('');

    return (
      <Space direction="vertical" size="large" style={{ width: '600px' }}>
        <Card title="Add a comment" size="small">
          <EmojiAutocompleteTextarea
            value={comment}
            onChange={setComment}
            placeholder="Write your comment... Use : for emojis"
            minRows={3}
            maxRows={8}
          />
        </Card>

        <Card title="Quick note" size="small">
          <EmojiAutocompleteTextarea
            value={note}
            onChange={setNote}
            placeholder="Jot down a quick note..."
            minRows={2}
            maxRows={6}
          />
        </Card>

        <Card title="Common shortcuts">
          <Space wrap>
            {[
              ':smile',
              ':joy',
              ':heart',
              ':fire',
              ':rocket',
              ':check',
              ':x',
              ':warning',
              ':bulb',
              ':sparkles',
              ':eyes',
              ':thinking',
              ':clap',
              ':pray',
              ':muscle',
            ].map((shortcode) => (
              <Text key={shortcode} code style={{ fontSize: 12 }}>
                {shortcode}
              </Text>
            ))}
          </Space>
        </Card>
      </Space>
    );
  },
};
