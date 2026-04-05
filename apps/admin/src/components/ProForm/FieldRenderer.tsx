import React from 'react';
import {
  ProFormText,
  ProFormTextArea,
  ProFormDigit,
  ProFormSwitch,
  ProFormCheckbox,
  ProFormRadio,
  ProFormSelect,
  ProFormDatePicker,
  ProFormDateRangePicker,
  ProFormTimePicker,
  ProFormCascader,
  ProFormTreeSelect,
  ProFormRate,
  ProFormSlider,
  ProFormColorPicker,
  ProFormItem,
} from '@ant-design/pro-components';
import type { FormFieldConfig } from '@/types/form';
import ImageUpload from '@/components/ImageUpload';
import { Divider } from 'antd';

interface FieldRendererProps {
  config: FormFieldConfig;
}

const FieldRenderer: React.FC<FieldRendererProps> = ({ config }) => {
  const {
    type,
    name,
    label,
    placeholder,
    tooltip,
    required,
    disabled = false,
    rules = [],
    options = [],
    initialValue,
    fieldProps = {},
    formItemProps = {},
    dependencies,
    colProps,
  } = config;

  // 处理必填规则
  const fieldRules = required
    ? [{ required: true, message: `${label}不能为空` }, ...rules]
    : rules;

  // 安全的 fieldProps 类型转换
  const safeFieldProps = fieldProps as any;

  switch (type) {
      
    case 'divider':
      return (
        <Divider />
      );
    case 'text':
      return (
        <ProFormText
          name={name}
          label={label}
          placeholder={placeholder || `请输入${label}`}
          tooltip={tooltip}
          disabled={disabled}
          initialValue={initialValue}
          rules={fieldRules}
          fieldProps={safeFieldProps}
          formItemProps={formItemProps}
          dependencies={dependencies}
          colProps={colProps}
        />
      );

    case 'password':
      return (
        <ProFormText.Password
          name={name}
          label={label}
          placeholder={placeholder || `请输入${label}`}
          tooltip={tooltip}
          disabled={disabled}
          initialValue={initialValue}
          rules={fieldRules}
          fieldProps={safeFieldProps}
          formItemProps={formItemProps}
          dependencies={dependencies}
          colProps={colProps}
        />
      );

    case 'textarea':
      return (
        <ProFormTextArea
          name={name}
          label={label}
          placeholder={placeholder || `请输入${label}`}
          tooltip={tooltip}
          disabled={disabled}
          initialValue={initialValue}
          rules={fieldRules}
          fieldProps={{ ...safeFieldProps, rows: 4 }}
          formItemProps={formItemProps}
          dependencies={dependencies}
          colProps={colProps}
        />
      );

    case 'number':
      return (
        <ProFormDigit
          name={name}
          label={label}
          placeholder={placeholder || `请输入${label}`}
          tooltip={tooltip}
          disabled={disabled}
          initialValue={initialValue}
          rules={fieldRules}
          fieldProps={safeFieldProps}
          formItemProps={formItemProps}
          dependencies={dependencies}
          colProps={colProps}
        />
      );

    case 'switch':
      return (
        <ProFormSwitch
          name={name}
          label={label}
          tooltip={tooltip}
          disabled={disabled}
          initialValue={initialValue}
          rules={fieldRules}
          fieldProps={safeFieldProps}
          formItemProps={formItemProps}
          dependencies={dependencies}
          colProps={colProps}
        />
      );

    case 'checkbox':
      return (
        <ProFormCheckbox.Group
          name={name}
          label={label}
          tooltip={tooltip}
          disabled={disabled}
          initialValue={initialValue}
          rules={fieldRules}
          options={options}
          fieldProps={safeFieldProps}
          formItemProps={formItemProps}
          dependencies={dependencies}
          colProps={colProps}
        />
      );

    case 'radio':
      return (
        <ProFormRadio.Group
          name={name}
          label={label}
          tooltip={tooltip}
          disabled={disabled}
          initialValue={initialValue}
          rules={fieldRules}
          options={options}
          fieldProps={safeFieldProps}
          formItemProps={formItemProps}
          dependencies={dependencies}
          colProps={colProps}
        />
      );

    case 'select':
      return (
        <ProFormSelect
          name={name}
          label={label}
          placeholder={placeholder || `请选择${label}`}
          tooltip={tooltip}
          disabled={disabled}
          initialValue={initialValue}
          rules={fieldRules}
          options={options}
          fieldProps={safeFieldProps}
          formItemProps={formItemProps}
          dependencies={dependencies}
          colProps={colProps}
        />
      );

    case 'date':
      return (
        <ProFormDatePicker
          name={name}
          label={label}
          placeholder={placeholder || `请选择${label}`}
          tooltip={tooltip}
          disabled={disabled}
          initialValue={initialValue}
          rules={fieldRules}
          fieldProps={safeFieldProps}
          formItemProps={formItemProps}
          dependencies={dependencies}
          colProps={colProps}
        />
      );

    case 'dateRange':
      return (
        <ProFormDateRangePicker
          name={name}
          label={label}
          tooltip={tooltip}
          disabled={disabled}
          initialValue={initialValue}
          rules={fieldRules}
          fieldProps={safeFieldProps}
          formItemProps={formItemProps}
          dependencies={dependencies}
          colProps={colProps}
        />
      );

    case 'time':
      return (
        <ProFormTimePicker
          name={name}
          label={label}
          placeholder={placeholder || `请选择${label}`}
          tooltip={tooltip}
          disabled={disabled}
          initialValue={initialValue}
          rules={fieldRules}
          fieldProps={safeFieldProps}
          formItemProps={formItemProps}
          dependencies={dependencies}
          colProps={colProps}
        />
      );

    case 'upload': {
      // 从fieldProps中获取上传相关配置
      const {
        listType = 'picture-card',
        maxCount = 1,
        accept = 'image/*',
        disabled: fieldDisabled = false,
        ...restFieldProps
      } = safeFieldProps as {
        listType?: 'text' | 'picture' | 'picture-card' | 'picture-circle';
        maxCount?: number;
        accept?: string;
        disabled?: boolean;
        [key: string]: unknown;
      };

      return (
        <ProFormItem
          name={name}
          label={label}
          tooltip={tooltip}
          rules={fieldRules}
          {...formItemProps}
        >
          <ImageUpload
            listType={listType}
            maxCount={maxCount}
            accept={accept}
            disabled={disabled || fieldDisabled}
            {...restFieldProps}
          />
        </ProFormItem>
      );
    }

    case 'uploadDragger':
      return (
        <ProFormText
          name={name}
          label={label}
          placeholder="拖拽上传功能暂未实现"
          tooltip={tooltip}
          disabled={true}
          initialValue={initialValue}
          rules={fieldRules}
          fieldProps={safeFieldProps}
          formItemProps={formItemProps}
          dependencies={dependencies}
          colProps={colProps}
        />
      );

    case 'cascader':
      return (
        <ProFormCascader
          name={name}
          label={label}
          placeholder={placeholder || `请选择${label}`}
          tooltip={tooltip}
          disabled={disabled}
          initialValue={initialValue}
          rules={fieldRules}
          fieldProps={{
            ...safeFieldProps,
            options,
          }}
          formItemProps={formItemProps}
          dependencies={dependencies}
          colProps={colProps}
        />
      );

    case 'treeSelect':
      return (
        <ProFormTreeSelect
          name={name}
          label={label}
          placeholder={placeholder || `请选择${label}`}
          tooltip={tooltip}
          disabled={disabled}
          initialValue={initialValue}
          rules={fieldRules}
          fieldProps={{
            ...safeFieldProps,
            treeData: options.map((opt: Record<string, unknown>) => ({ 
              ...opt, 
              key: String(opt.value),
              title: opt.label 
            })),
          }}
          formItemProps={formItemProps}
          dependencies={dependencies}
          colProps={colProps}
        />
      );

    case 'rate':
      return (
        <ProFormRate
          name={name}
          label={label}
          tooltip={tooltip}
          disabled={disabled}
          initialValue={initialValue}
          rules={fieldRules}
          fieldProps={safeFieldProps}
          formItemProps={formItemProps}
          dependencies={dependencies}
          colProps={colProps}
        />
      );

    case 'slider':
      return (
        <ProFormSlider
          name={name}
          label={label}
          tooltip={tooltip}
          disabled={disabled}
          initialValue={initialValue}
          rules={fieldRules}
          fieldProps={safeFieldProps}
          formItemProps={formItemProps}
          dependencies={dependencies}
          colProps={colProps}
        />
      );

    case 'color':
      return (
        <ProFormColorPicker
          name={name}
          label={label}
          tooltip={tooltip}
          disabled={disabled}
          initialValue={initialValue}
          rules={fieldRules}
          fieldProps={safeFieldProps}
          formItemProps={formItemProps}
          dependencies={dependencies}
          colProps={colProps}
        />
      );

    case 'custom':
      return (
        <ProFormText
          name={name}
          label={label}
          placeholder={placeholder || `请输入${label}`}
          tooltip={tooltip}
          disabled={disabled}
          initialValue={initialValue}
          rules={fieldRules}
          fieldProps={safeFieldProps}
          formItemProps={formItemProps}
          dependencies={dependencies}
          colProps={colProps}
        />
      );

    default:
      return (
        <ProFormText
          name={name}
          label={label}
          placeholder={placeholder || `请输入${label}`}
          tooltip={tooltip}
          disabled={disabled}
          initialValue={initialValue}
          rules={fieldRules}
          fieldProps={safeFieldProps}
          formItemProps={formItemProps}
          dependencies={dependencies}
          colProps={colProps}
        />
      );
  }
};

export default FieldRenderer;