import React from 'react';
import { ProForm, ModalForm, DrawerForm } from '@ant-design/pro-components';
import { Row, Col, Tabs } from 'antd';
import FieldRenderer from './FieldRenderer';
import type { ProFormProps } from '@/types/form';

const ConfigurableProForm: React.FC<ProFormProps> = ({
  config,
  mode = 'normal',
  visible,
  onVisibleChange,
  onFinish,
  onReset,
  onValuesChange,
  initialValues,
  loading = false,
  width = 600,
  modalProps = {
    destroyOnClose: true,
  },
  drawerProps = {
    destroyOnClose: true,
  },
}) => {
  const {
    title,
    description,
    layout = 'vertical',
    labelCol,
    wrapperCol,
    fields,
    tabs,
    submitText = '提交',
    resetText = '重置',
    showReset = true,
    grid = false,
    rowProps = {},
  } = config;

  // 渲染字段列表的辅助函数
  const renderFieldList = (fieldList: any[]) => {
    if (grid) {
      return (
        <Row {...(rowProps as Record<string, unknown>)}>
          {fieldList.map((field) => (
            <Col key={field.name} {...field.colProps}>
              <FieldRenderer config={field} />
            </Col>
          ))}
        </Row>
      );
    }

    return fieldList.map((field) => <FieldRenderer key={field.name} config={field} />);
  };

  // 渲染表单字段
  const renderFields = () => {
    // 如果配置了 tabs，使用 Tabs 组件
    if (tabs && tabs.length > 0) {
      return (
        <Tabs
          items={tabs.map((tab) => ({
            key: tab.key,
            label: tab.label,
            children: renderFieldList(tab.fields),
          }))}
        />
      );
    }

    // 否则直接渲染 fields
    if (fields && fields.length > 0) {
      return renderFieldList(fields);
    }

    return null;
  };

  // 根据模式渲染不同的表单
  switch (mode) {
    case 'modal':
      return (
        <ModalForm
          title={title}
          width={width}
          open={visible}
          onOpenChange={onVisibleChange}
          layout={layout}
          labelCol={labelCol}
          wrapperCol={wrapperCol}
          initialValues={initialValues}
          loading={loading}
          onFinish={async (values) => {
            const result = await onFinish?.(values);
            return result !== false;
          }}
          onReset={onReset}
          onValuesChange={onValuesChange}
          modalProps={modalProps}
        >
          {description && <div style={{ marginBottom: 16, color: '#666' }}>{description}</div>}
          {renderFields()}
        </ModalForm>
      );

    case 'drawer':
      return (
        <DrawerForm
          title={title}
          width={width}
          open={visible}
          onOpenChange={onVisibleChange}
          layout={layout}
          labelCol={labelCol}
          wrapperCol={wrapperCol}
          initialValues={initialValues}
          loading={loading}
          onFinish={async (values) => {
            const result = await onFinish?.(values);
            return result !== false;
          }}
          onReset={onReset}
          onValuesChange={onValuesChange}
          drawerProps={drawerProps}
        >
          {description && <div style={{ marginBottom: 16, color: '#666' }}>{description}</div>}
          {renderFields()}
        </DrawerForm>
      );

    case 'normal':
    default:
      return (
        <ProForm
          layout={layout}
          labelCol={labelCol}
          wrapperCol={wrapperCol}
          initialValues={initialValues}
          loading={loading}
          onFinish={async (values) => {
            const result = await onFinish?.(values);
            return result !== false;
          }}
          onReset={onReset}
          onValuesChange={onValuesChange}
          submitter={{
            searchConfig: {
              submitText,
              resetText,
            },
            resetButtonProps: showReset ? undefined : false,
          }}
        >
          {title && <h3 style={{ marginBottom: 16 }}>{title}</h3>}
          {description && <div style={{ marginBottom: 16, color: '#666' }}>{description}</div>}
          {renderFields()}
        </ProForm>
      );
  }
};

export default ConfigurableProForm;
