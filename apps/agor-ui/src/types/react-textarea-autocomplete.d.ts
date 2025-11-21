declare module '@webscopeio/react-textarea-autocomplete' {
  import type * as React from 'react';

  export interface TriggerType<T> {
    [key: string]: {
      dataProvider: (token: string) => Promise<T[]> | T[];
      component: React.ComponentType<{ entity: T; selected: boolean }>;
      output?: (item: T, trigger: string) => string;
      afterWhitespace?: boolean;
      allowWhitespace?: boolean;
    };
  }

  export interface TextareaProps<T> extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
    loadingComponent?: React.ComponentType;
    trigger?: TriggerType<T>;
    value?: string;
    onChange?: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
    minChar?: number;
    scrollToItem?: boolean | ((container: HTMLDivElement, item: HTMLDivElement) => void);
    movePopupAsYouType?: boolean;
    containerStyle?: React.CSSProperties;
    containerClassName?: string;
    dropdownStyle?: React.CSSProperties;
    dropdownClassName?: string;
    itemStyle?: React.CSSProperties;
    itemClassName?: string;
    loaderStyle?: React.CSSProperties;
    loaderClassName?: string;
    listStyle?: React.CSSProperties;
    listClassName?: string;
    textareaComponent?: React.ComponentType<React.TextareaHTMLAttributes<HTMLTextAreaElement>>;
  }

  export default class ReactTextareaAutocomplete<T = unknown> extends React.Component<
    TextareaProps<T>
  > {}
}
