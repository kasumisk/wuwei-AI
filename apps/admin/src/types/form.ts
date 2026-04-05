// 表单字段类型定义
export type FormFieldType =
  | 'divider'
  | 'text'
  | 'password'
  | 'textarea'
  | 'number'
  | 'select'
  | 'multiSelect'
  | 'radio'
  | 'checkbox'
  | 'date'
  | 'dateRange'
  | 'time'
  | 'upload'
  | 'uploadDragger'
  | 'switch'
  | 'rate'
  | 'slider'
  | 'cascader'
  | 'treeSelect'
  | 'mention'
  | 'color'
  | 'custom';

// 表单字段配置接口
export interface FormFieldConfig {
  name: string;
  label: string;
  type: FormFieldType;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  tooltip?: string;
  initialValue?: unknown;
  rules?: Record<string, unknown>[];
  fieldProps?: Record<string, unknown>;
  formItemProps?: Record<string, unknown>;
  // 选项配置（适用于 select, radio, checkbox 等）
  options?: Array<{
    label: string;
    value: unknown;
    disabled?: boolean;
  }>;
  // 依赖字段配置
  dependencies?: string[];
  // 自定义渲染
  renderFormItem?: (schema: FormFieldConfig, config: Record<string, unknown>) => React.ReactNode;
  // 联动配置
  request?: () => Promise<unknown[]>;
  // 布局配置
  colProps?: {
    span?: number;
    offset?: number;
    push?: number;
    pull?: number;
  };
}

// Tab 配置接口
export interface FormTabConfig {
  key: string;
  label: string;
  fields: FormFieldConfig[];
}

// 表单配置接口
export interface FormConfig {
  title?: string;
  description?: string;
  layout?: 'horizontal' | 'vertical' | 'inline';
  labelCol?: {
    span?: number;
    offset?: number;
  };
  wrapperCol?: {
    span?: number;
    offset?: number;
  };
  // fields 和 tabs 二选一
  fields?: FormFieldConfig[];
  tabs?: FormTabConfig[];
  submitText?: string;
  resetText?: string;
  showReset?: boolean;
  grid?: boolean;
  rowProps?: Record<string, unknown>;
  submitter?: {
    render?: boolean;
    resetButtonProps?: Record<string, unknown>;
    submitButtonProps?: Record<string, unknown>;
    searchConfig?: {
      resetText?: string;
      submitText?: string;
    };
  };
}

// 表单模式类型
export type FormMode = 'normal' | 'modal' | 'drawer';

// Pro Form 组件 Props
export interface ProFormProps {
  config: FormConfig;
  mode?: FormMode;
  visible?: boolean;
  onVisibleChange?: (visible: boolean) => void;
  onFinish?: (values: Record<string, unknown>) => Promise<boolean | void>;
  onReset?: () => void;
  onValuesChange?: (
    changedValues: Record<string, unknown>,
    allValues: Record<string, unknown>
  ) => void;
  initialValues?: Record<string, unknown>;
  loading?: boolean;
  width?: number | string;
  // Modal 特有属性 - 这些属性会传递给 ModalForm 的 modalProps
  modalProps?: {
    destroyOnClose?: boolean;
    maskClosable?: boolean;
    centered?: boolean;
    keyboard?: boolean;
    mask?: boolean;
    closable?: boolean;
    okText?: string;
    cancelText?: string;
    [key: string]: unknown;
  };
  // Drawer 特有属性 - 这些属性会传递给 DrawerForm 的 drawerProps
  drawerProps?: {
    closable?: boolean;
    destroyOnClose?: boolean;
    maskClosable?: boolean;
    mask?: boolean;
    keyboard?: boolean;
    placement?: 'top' | 'right' | 'bottom' | 'left';
    [key: string]: unknown;
  };
}
