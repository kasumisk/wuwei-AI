# 配置表单组件使用说明

## 🎯 功能概述

基于 `@ant-design/pro-components` 的配置表单组件，支持通过 JSON 配置快速生成表单，支持三种展示模式：

- 🖼️ **普通模式**: 直接在页面中展示
- 🪟 **弹窗模式**: 在 Modal 中展示
- 📋 **抽屉模式**: 在 Drawer 中展示

## 📝 基础用法

### 1. 表单配置

```tsx
import type { FormConfig } from '@/types/form';

const formConfig: FormConfig = {
  title: '用户信息表单',
  description: '这是表单描述',
  layout: 'vertical',
  grid: true,
  fields: [
    {
      name: 'username',
      label: '用户名',
      type: 'text',
      required: true,
      placeholder: '请输入用户名',
      colProps: { span: 12 },
    },
    {
      name: 'email',
      label: '邮箱',
      type: 'text',
      required: true,
      rules: [{ type: 'email', message: '请输入有效邮箱' }],
      colProps: { span: 12 },
    },
    // ... 更多字段
  ],
};
```

### 2. 普通表单使用

```tsx
import ConfigurableProForm from '@/components/ProForm';

<ConfigurableProForm
  config={formConfig}
  mode="normal"
  onFinish={async (values) => {
    console.log(values);
    return true;
  }}
  initialValues={{ username: 'admin' }}
/>;
```

### 3. 弹窗表单使用

```tsx
const [visible, setVisible] = useState(false);

<ConfigurableProForm
  config={formConfig}
  mode="modal"
  visible={visible}
  onVisibleChange={setVisible}
  onFinish={async (values) => {
    console.log(values);
    setVisible(false);
    return true;
  }}
  width={600}
/>;
```

### 4. 抽屉表单使用

```tsx
const [visible, setVisible] = useState(false);

<ConfigurableProForm
  config={formConfig}
  mode="drawer"
  visible={visible}
  onVisibleChange={setVisible}
  onFinish={async (values) => {
    console.log(values);
    setVisible(false);
    return true;
  }}
  width={600}
/>;
```

## 🔧 支持的字段类型

| 类型          | 说明       | 示例配置                                               |
| ------------- | ---------- | ------------------------------------------------------ |
| `text`        | 文本输入框 | `{ type: 'text', placeholder: '请输入' }`              |
| `password`    | 密码输入框 | `{ type: 'password' }`                                 |
| `textarea`    | 多行文本   | `{ type: 'textarea', fieldProps: { rows: 4 } }`        |
| `number`      | 数字输入   | `{ type: 'number', fieldProps: { min: 0, max: 100 } }` |
| `select`      | 下拉选择   | `{ type: 'select', options: [...] }`                   |
| `multiSelect` | 多选下拉   | `{ type: 'multiSelect', options: [...] }`              |
| `radio`       | 单选组     | `{ type: 'radio', options: [...] }`                    |
| `checkbox`    | 多选组     | `{ type: 'checkbox', options: [...] }`                 |
| `date`        | 日期选择   | `{ type: 'date' }`                                     |
| `dateRange`   | 日期范围   | `{ type: 'dateRange' }`                                |
| `time`        | 时间选择   | `{ type: 'time' }`                                     |
| `upload`      | 文件上传   | `{ type: 'upload' }`                                   |
| `switch`      | 开关       | `{ type: 'switch' }`                                   |
| `rate`        | 评分       | `{ type: 'rate' }`                                     |
| `slider`      | 滑动条     | `{ type: 'slider', fieldProps: { min: 0, max: 100 } }` |
| `cascader`    | 级联选择   | `{ type: 'cascader', options: [...] }`                 |
| `treeSelect`  | 树选择     | `{ type: 'treeSelect', options: [...] }`               |
| `colorPicker` | 颜色选择   | `{ type: 'colorPicker' }`                              |

## 🎛️ 字段配置选项

```tsx
interface FormFieldConfig {
  name: string; // 字段名
  label: string; // 字段标签
  type: FormFieldType; // 字段类型
  required?: boolean; // 是否必填
  disabled?: boolean; // 是否禁用
  placeholder?: string; // 占位符
  tooltip?: string; // 提示信息
  initialValue?: unknown; // 初始值
  rules?: Array<{
    // 验证规则
    required?: boolean;
    message?: string;
    type?: string;
    pattern?: RegExp;
  }>;
  fieldProps?: Record<string, unknown>; // 字段属性
  formItemProps?: Record<string, unknown>; // 表单项属性
  options?: Array<{
    // 选项列表（select、radio等）
    label: string;
    value: unknown;
    disabled?: boolean;
  }>;
  dependencies?: string[]; // 依赖字段
  colProps?: {
    // 栅格布局
    span?: number;
    offset?: number;
  };
}
```

## 🎨 表单配置选项

```tsx
interface FormConfig {
  title?: string; // 表单标题
  description?: string; // 表单描述
  layout?: 'horizontal' | 'vertical' | 'inline'; // 布局模式
  labelCol?: { span?: number; offset?: number }; // 标签列配置
  wrapperCol?: { span?: number; offset?: number }; // 包装列配置
  fields: FormFieldConfig[]; // 字段配置数组
  submitText?: string; // 提交按钮文本
  resetText?: string; // 重置按钮文本
  showReset?: boolean; // 是否显示重置按钮
  grid?: boolean; // 是否启用栅格布局
  rowProps?: Record<string, unknown>; // 行属性
  submitter?: {
    // 提交器配置
    render?: boolean;
    resetButtonProps?: Record<string, unknown>;
    submitButtonProps?: Record<string, unknown>;
    searchConfig?: {
      resetText?: string;
      submitText?: string;
    };
  };
}
```

## 📋 完整示例

参考 `/src/pages/form-demo/index.tsx` 文件，其中包含了：

- ✅ 普通表单展示
- ✅ 弹窗表单展示
- ✅ 抽屉表单展示
- ✅ 各种字段类型使用
- ✅ 栅格布局配置
- ✅ 表单验证规则
- ✅ 初始值设置

## 🚀 高级功能

### 1. 字段联动

```tsx
{
  name: 'city',
  label: '城市',
  type: 'select',
  dependencies: ['province'],
  request: async () => {
    // 根据省份动态获取城市列表
    return cityOptions;
  }
}
```

### 2. 自定义渲染

```tsx
{
  name: 'custom',
  label: '自定义字段',
  type: 'text',
  renderFormItem: (schema, config) => {
    return <CustomComponent {...config} />;
  }
}
```

### 3. 栅格布局

```tsx
{
  grid: true,
  rowProps: { gutter: 16 },
  fields: [
    { name: 'field1', colProps: { span: 8 } },
    { name: 'field2', colProps: { span: 8 } },
    { name: 'field3', colProps: { span: 8 } },
  ]
}
```

## 🎯 应用场景

- 📝 **用户信息表单**: 注册、个人资料编辑
- 🏢 **企业信息表单**: 公司信息、配置表单
- 📊 **数据录入表单**: 快速生成各种数据录入界面
- ⚙️ **配置表单**: 系统设置、参数配置
- 🔍 **搜索表单**: 高级搜索、筛选条件

通过 JSON 配置的方式，可以极大提高表单开发效率，减少重复代码！🎉
