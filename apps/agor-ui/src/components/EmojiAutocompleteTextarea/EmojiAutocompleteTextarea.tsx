import ReactTextareaAutocomplete from '@webscopeio/react-textarea-autocomplete';
import { theme } from 'antd';
import { type EmojiOption, useEmojiAutocomplete } from '../../hooks/useEmojiAutocomplete';
import './EmojiAutocompleteTextarea.css';

interface EmojiAutocompleteTextareaProps {
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  minRows?: number;
  maxRows?: number;
  disabled?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Item component for displaying emoji in autocomplete dropdown
 */
const EmojiItem: React.FC<{ entity: EmojiOption }> = ({ entity }) => {
  const { token } = theme.useToken();

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: token.marginXS,
        padding: `${token.paddingXS}px ${token.paddingSM}px`,
      }}
    >
      <span style={{ fontSize: 20 }}>{entity.emoji}</span>
      <span style={{ color: token.colorText }}>:{entity.shortcode}:</span>
    </div>
  );
};

/**
 * Loading component shown while searching
 */
const LoadingIndicator: React.FC = () => {
  const { token } = theme.useToken();
  return (
    <div
      style={{
        padding: token.paddingSM,
        textAlign: 'center',
        color: token.colorTextSecondary,
        fontSize: token.fontSizeSM,
      }}
    >
      Searching emojis...
    </div>
  );
};

/**
 * Textarea with inline emoji autocomplete triggered by ':'
 *
 * Usage:
 * ```tsx
 * <EmojiAutocompleteTextarea
 *   value={value}
 *   onChange={setValue}
 *   placeholder="Type : to insert emoji..."
 * />
 * ```
 *
 * Type `:smile` and press Enter to insert 😄
 */
export const EmojiAutocompleteTextarea: React.FC<EmojiAutocompleteTextareaProps> = ({
  value = '',
  onChange,
  placeholder,
  minRows = 3,
  maxRows = 10,
  disabled = false,
  className = '',
  style = {},
}) => {
  const { token } = theme.useToken();
  const { searchEmojis } = useEmojiAutocomplete();

  const handleChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChange?.(event.target.value);
  };

  // Data provider for emoji autocomplete
  const emojiDataProvider = async (token: string): Promise<EmojiOption[]> => {
    // Token is the text after ':' trigger
    return searchEmojis(token);
  };

  // Output function - what gets inserted into the textarea
  const emojiOutput = (item: EmojiOption): string => {
    return item.emoji;
  };

  return (
    <div className={`emoji-autocomplete-wrapper ${className}`} style={style}>
      <ReactTextareaAutocomplete
        className="emoji-autocomplete-textarea"
        value={value}
        onChange={handleChange}
        placeholder={placeholder}
        disabled={disabled}
        rows={minRows}
        maxRows={maxRows}
        loadingComponent={LoadingIndicator}
        trigger={{
          ':': {
            dataProvider: emojiDataProvider,
            component: EmojiItem,
            output: emojiOutput,
          },
        }}
        style={{
          fontSize: token.fontSize,
          fontFamily: token.fontFamily,
          lineHeight: token.lineHeight,
          color: token.colorText,
          backgroundColor: token.colorBgContainer,
          border: `1px solid ${token.colorBorder}`,
          borderRadius: token.borderRadius,
          padding: `${token.paddingSM}px ${token.padding}px`,
          width: '100%',
          minHeight: `${minRows * 1.5 * token.fontSize}px`,
          maxHeight: `${maxRows * 1.5 * token.fontSize}px`,
          resize: 'vertical',
          outline: 'none',
          transition: 'all 0.2s',
        }}
      />
    </div>
  );
};
