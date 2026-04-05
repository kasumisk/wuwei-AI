import { Card, Form, Switch, Select, Button, Divider, ColorPicker, Space, message } from 'antd';
import { useThemeStore } from '@/store';

// 路由配置
export const routeConfig = {
  name: 'settings',
  title: '系统设置',
  icon: 'setting',
  requireAuth: true,
  hideInMenu: true,
};

const { Option } = Select;

const SettingsPage = () => {
  const { 
    mode, 
    primaryColor, 
    collapsed, 
    locale,
    setMode, 
    setPrimaryColor, 
    setCollapsed, 
    setLocale 
  } = useThemeStore();

  const [form] = Form.useForm();

  const handleSave = () => {
    message.success('设置保存成功！');
  };

  const handleReset = () => {
    form.resetFields();
    setMode('light');
    setPrimaryColor('#1677ff');
    setCollapsed(false);
    setLocale('zh-CN');
    message.info('设置已重置');
  };

  return (
    <div style={{ padding: 24 }}>
      <Card title="系统设置">
        <Form
          form={form}
          layout="vertical"
          initialValues={{
            darkMode: mode === 'dark',
            primaryColor,
            autoCollapse: collapsed,
            language: locale,
          }}
        >
          <Divider orientation="left">外观设置</Divider>
          
          <Form.Item label="暗色模式" name="darkMode">
            <Switch 
              checked={mode === 'dark'}
              onChange={(checked) => setMode(checked ? 'dark' : 'light')}
              checkedChildren="暗色"
              unCheckedChildren="亮色"
            />
          </Form.Item>

          <Form.Item label="主题色" name="primaryColor">
            <Space>
              <ColorPicker
                value={primaryColor}
                onChange={(color) => setPrimaryColor(color.toHexString())}
                showText
                presets={[
                  {
                    label: '推荐',
                    colors: [
                      '#1677ff',
                      '#722ed1',
                      '#13c2c2',
                      '#52c41a',
                      '#fa8c16',
                      '#f5222d',
                    ],
                  },
                ]}
              />
              <Button size="small" onClick={() => setPrimaryColor('#1677ff')}>
                重置
              </Button>
            </Space>
          </Form.Item>

          <Form.Item label="自动折叠侧边栏" name="autoCollapse">
            <Switch 
              checked={collapsed}
              onChange={setCollapsed}
              checkedChildren="开启"
              unCheckedChildren="关闭"
            />
          </Form.Item>

          <Divider orientation="left">语言设置</Divider>

          <Form.Item label="界面语言" name="language">
            <Select value={locale} onChange={setLocale} style={{ width: 200 }}>
              <Option value="zh-CN">简体中文</Option>
              <Option value="en-US">English</Option>
            </Select>
          </Form.Item>

          <Divider orientation="left">其他设置</Divider>

          <Form.Item label="桌面通知">
            <Switch defaultChecked />
          </Form.Item>

          <Form.Item label="自动保存">
            <Switch defaultChecked />
          </Form.Item>

          <Form.Item label="数据备份">
            <Switch />
          </Form.Item>

          <Form.Item>
            <Space>
              <Button type="primary" onClick={handleSave}>
                保存设置
              </Button>
              <Button onClick={handleReset}>
                重置设置
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
};

export default SettingsPage;