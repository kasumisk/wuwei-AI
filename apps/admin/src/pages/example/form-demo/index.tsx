import React, { useState } from 'react';
import { Card, Button, Space, Divider, message } from 'antd';
import ConfigurableProForm from '@/components/ProForm';
import type { FormConfig } from '@/types/form';

// 路由配置
export const routeConfig = {
  name: 'formDemo',
  title: '配置表单示例',
  icon: 'form',
  requireAuth: true,
  hideInMenu: true,
};

const FormDemo: React.FC = () => {
  const [modalVisible, setModalVisible] = useState(false);
  const [drawerVisible, setDrawerVisible] = useState(false);

  // 表单配置示例
  const formConfig: FormConfig = {
    title: '用户信息表单',
    description: '通过 JSON 配置生成的动态表单',
    layout: 'vertical',
    grid: true,
    fields: [
      {
        name: 'name',
        label: '姓名',
        type: 'text',
        required: true,
        placeholder: '请输入姓名',
        colProps: { span: 12 },
      },
      {
        name: 'email',
        label: '邮箱',
        type: 'text',
        required: true,
        placeholder: '请输入邮箱',
        rules: [
          { type: 'email', message: '请输入有效的邮箱地址' },
        ],
        colProps: { span: 12 },
      },
      {
        name: 'age',
        label: '年龄',
        type: 'number',
        required: true,
        fieldProps: {
          min: 1,
          max: 120,
        },
        colProps: { span: 8 },
      },
      {
        name: 'gender',
        label: '性别',
        type: 'radio',
        required: true,
        options: [
          { label: '男', value: 'male' },
          { label: '女', value: 'female' },
        ],
        colProps: { span: 8 },
      },
      {
        name: 'status',
        label: '状态',
        type: 'select',
        required: true,
        options: [
          { label: '活跃', value: 'active' },
          { label: '禁用', value: 'inactive' },
        ],
        colProps: { span: 8 },
      },
      {
        name: 'skills',
        label: '技能',
        type: 'multiSelect',
        options: [
          { label: 'React', value: 'react' },
          { label: 'Vue', value: 'vue' },
          { label: 'Angular', value: 'angular' },
          { label: 'Node.js', value: 'nodejs' },
        ],
        colProps: { span: 12 },
      },
      {
        name: 'birthday',
        label: '出生日期',
        type: 'date',
        colProps: { span: 12 },
      },
      {
        name: 'introduction',
        label: '个人介绍',
        type: 'textarea',
        placeholder: '请输入个人介绍',
        colProps: { span: 24 },
      },
      {
        name: 'newsletter',
        label: '订阅邮件',
        type: 'switch',
        colProps: { span: 8 },
      },
      {
        name: 'rating',
        label: '评分',
        type: 'rate',
        colProps: { span: 8 },
      },
      {
        name: 'progress',
        label: '完成度',
        type: 'slider',
        fieldProps: {
          min: 0,
          max: 100,
          marks: {
            0: '0%',
            25: '25%',
            50: '50%',
            75: '75%',
            100: '100%',
          },
        },
        colProps: { span: 8 },
      },
    ],
    submitText: '保存',
    resetText: '重置',
    showReset: true,
  };

  const handleSubmit = async (values: Record<string, unknown>) => {
    console.log('表单数据:', values);
    message.success('表单提交成功！');
    return true;
  };

  return (
    <div style={{ padding: 24 }}>
      <Card title="配置表单示例" style={{ marginBottom: 24 }}>
        <Space>
          <Button type="primary" onClick={() => setModalVisible(true)}>
            弹窗表单
          </Button>
          <Button onClick={() => setDrawerVisible(true)}>
            抽屉表单
          </Button>
        </Space>
        
        <Divider>普通表单</Divider>
        
        <ConfigurableProForm
          config={formConfig}
          mode="normal"
          onFinish={handleSubmit}
          initialValues={{
            name: '张三',
            email: 'zhangsan@example.com',
            gender: 'male',
            newsletter: true,
            rating: 4,
            progress: 60,
          }}
        />
      </Card>

      {/* 弹窗表单 */}
      <ConfigurableProForm
        config={{
          ...formConfig,
          title: '弹窗表单',
          description: '这是一个弹窗模式的表单',
        }}
        mode="modal"
        visible={modalVisible}
        onVisibleChange={setModalVisible}
        onFinish={async (values) => {
          console.log('弹窗表单数据:', values);
          message.success('弹窗表单提交成功！');
          setModalVisible(false);
          return true;
        }}
        width={800}
      />

      {/* 抽屉表单 */}
      <ConfigurableProForm
        config={{
          ...formConfig,
          title: '抽屉表单',
          description: '这是一个抽屉模式的表单',
        }}
        mode="drawer"
        visible={drawerVisible}
        onVisibleChange={setDrawerVisible}
        onFinish={async (values) => {
          console.log('抽屉表单数据:', values);
          message.success('抽屉表单提交成功！');
          setDrawerVisible(false);
          return true;
        }}
        width={600}
      />
    </div>
  );
};

export default FormDemo;