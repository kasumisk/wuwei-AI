import { Form, Input, Button, Card, Row, Col, Select, DatePicker, InputNumber, Space } from 'antd';

// 路由配置
export const routeConfig = {
  name: 'userForm',
  title: '用户表单',
  icon: 'form',
  requireAuth: true,
};

const { Option } = Select;

interface FormValues {
  username: string;
  email: string;
  phone: string;
  age: number;
  gender: string;
  birthDate: string;
  remark?: string;
}

const UserForm = () => {
  const [form] = Form.useForm();

  const onFinish = (values: FormValues) => {
    console.log('表单数据:', values);
  };

  return (
    <Card title="用户表单">
      <Form
        form={form}
        layout="vertical"
        onFinish={onFinish}
        autoComplete="off"
      >
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item
              label="用户名"
              name="username"
              rules={[{ required: true, message: '请输入用户名!' }]}
            >
              <Input placeholder="请输入用户名" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item
              label="邮箱"
              name="email"
              rules={[
                { required: true, message: '请输入邮箱!' },
                { type: 'email', message: '请输入有效的邮箱地址!' },
              ]}
            >
              <Input placeholder="请输入邮箱" />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={16}>
          <Col span={12}>
            <Form.Item
              label="手机号"
              name="phone"
              rules={[{ required: true, message: '请输入手机号!' }]}
            >
              <Input placeholder="请输入手机号" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item
              label="年龄"
              name="age"
              rules={[{ required: true, message: '请输入年龄!' }]}
            >
              <InputNumber
                min={1}
                max={120}
                placeholder="请输入年龄"
                style={{ width: '100%' }}
              />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={16}>
          <Col span={12}>
            <Form.Item
              label="性别"
              name="gender"
              rules={[{ required: true, message: '请选择性别!' }]}
            >
              <Select placeholder="请选择性别">
                <Option value="male">男</Option>
                <Option value="female">女</Option>
              </Select>
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item
              label="出生日期"
              name="birthDate"
              rules={[{ required: true, message: '请选择出生日期!' }]}
            >
              <DatePicker style={{ width: '100%' }} placeholder="请选择出生日期" />
            </Form.Item>
          </Col>
        </Row>

        <Form.Item label="备注" name="remark">
          <Input.TextArea rows={4} placeholder="请输入备注信息" />
        </Form.Item>

        <Form.Item>
          <Space>
            <Button type="primary" htmlType="submit">
              提交
            </Button>
            <Button htmlType="button" onClick={() => form.resetFields()}>
              重置
            </Button>
          </Space>
        </Form.Item>
      </Form>
    </Card>
  );
};

export default UserForm;