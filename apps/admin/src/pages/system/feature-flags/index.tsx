import React, { useState } from 'react';
import {
  Card,
  Table,
  Switch,
  Button,
  Space,
  Tag,
  Modal,
  Form,
  Input,
  Select,
  Spin,
  Popconfirm,
  message,
  Typography,
  InputNumber,
  Divider,
} from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, ThunderboltOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import {
  useFeatureFlags,
  useUpsertFeatureFlag,
  useToggleFeatureFlag,
  useDeleteFeatureFlag,
  type FeatureFlag,
  type FeatureFlagType,
  type UpsertFeatureFlagDto,
} from '@/services/featureFlagService';

const { TextArea } = Input;
const { Text } = Typography;

// ==================== 路由配置 ====================

export const routeConfig = {
  name: 'system-feature-flags',
  title: '功能开关',
  icon: 'ThunderboltOutlined',
  order: 3,
  requireAuth: true,
  requireAdmin: true,
};

// ==================== 常量 ====================

const TYPE_LABELS: Record<FeatureFlagType, string> = {
  boolean: '开关',
  percentage: '灰度百分比',
  user_list: '用户白名单',
  segment: '用户分群',
};

const TYPE_COLORS: Record<FeatureFlagType, string> = {
  boolean: 'blue',
  percentage: 'orange',
  user_list: 'green',
  segment: 'purple',
};

// ==================== 配置表单 ====================

const FlagConfigFields: React.FC<{ type: FeatureFlagType }> = ({ type }) => {
  if (type === 'percentage') {
    return (
      <Form.Item
        label="灰度百分比 (0-100)"
        name={['config', 'percentage']}
        rules={[{ required: true, message: '请输入百分比' }]}
      >
        <InputNumber min={0} max={100} step={5} style={{ width: '100%' }} addonAfter="%" />
      </Form.Item>
    );
  }
  if (type === 'user_list') {
    return (
      <>
        <Form.Item label="白名单 User IDs（每行一个）" name={['config', '_whitelistRaw']}>
          <TextArea
            rows={3}
            placeholder="user-id-1&#10;user-id-2"
            style={{ fontFamily: 'monospace', fontSize: 12 }}
          />
        </Form.Item>
        <Form.Item label="黑名单 User IDs（每行一个）" name={['config', '_blacklistRaw']}>
          <TextArea
            rows={3}
            placeholder="user-id-1&#10;user-id-2"
            style={{ fontFamily: 'monospace', fontSize: 12 }}
          />
        </Form.Item>
      </>
    );
  }
  if (type === 'segment') {
    return (
      <Form.Item label="目标分群（每行一个）" name={['config', '_segmentsRaw']}>
        <TextArea
          rows={3}
          placeholder="paid_pro&#10;churn_risk_high"
          style={{ fontFamily: 'monospace', fontSize: 12 }}
        />
      </Form.Item>
    );
  }
  return null;
};

// ==================== 编辑弹窗 ====================

const FlagModal: React.FC<{
  open: boolean;
  initial?: FeatureFlag | null;
  onClose: () => void;
}> = ({ open, initial, onClose }) => {
  const [form] = Form.useForm<UpsertFeatureFlagDto & { _type: FeatureFlagType }>();
  const [currentType, setCurrentType] = useState<FeatureFlagType>('boolean');
  const { mutateAsync: upsert, isPending } = useUpsertFeatureFlag();

  // 初始化表单值
  React.useEffect(() => {
    if (open) {
      if (initial) {
        const cfg = initial.config ?? {};
        const whitelistRaw = Array.isArray(cfg.whitelist)
          ? (cfg.whitelist as string[]).join('\n')
          : '';
        const blacklistRaw = Array.isArray(cfg.blacklist)
          ? (cfg.blacklist as string[]).join('\n')
          : '';
        const segmentsRaw = Array.isArray(cfg.segments)
          ? (cfg.segments as string[]).join('\n')
          : '';

        form.setFieldsValue({
          key: initial.key,
          name: initial.name,
          description: initial.description ?? '',
          type: initial.type,
          enabled: initial.enabled,
          config: {
            ...cfg,
            percentage: cfg.percentage as number | undefined,
            _whitelistRaw: whitelistRaw,
            _blacklistRaw: blacklistRaw,
            _segmentsRaw: segmentsRaw,
          },
        } as Parameters<typeof form.setFieldsValue>[0]);
        setCurrentType(initial.type);
      } else {
        form.resetFields();
        setCurrentType('boolean');
      }
    }
  }, [open, initial, form]);

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      const type = values.type ?? 'boolean';

      // 处理 config
      let config: Record<string, unknown> = {};
      if (type === 'percentage') {
        config = { percentage: values.config?.percentage };
      } else if (type === 'user_list') {
        const raw = values.config as Record<string, string>;
        config = {
          whitelist: (raw._whitelistRaw ?? '')
            .split('\n')
            .map((s: string) => s.trim())
            .filter(Boolean),
          blacklist: (raw._blacklistRaw ?? '')
            .split('\n')
            .map((s: string) => s.trim())
            .filter(Boolean),
        };
      } else if (type === 'segment') {
        const raw = values.config as Record<string, string>;
        config = {
          segments: (raw._segmentsRaw ?? '')
            .split('\n')
            .map((s: string) => s.trim())
            .filter(Boolean),
        };
      }

      await upsert({
        key: values.key,
        name: values.name,
        description: values.description,
        type,
        enabled: values.enabled ?? false,
        config,
      });
      message.success(initial ? '功能开关已更新' : '功能开关已创建');
      onClose();
    } catch {
      // form validation error - do nothing
    }
  };

  return (
    <Modal
      open={open}
      title={initial ? `编辑：${initial.key}` : '新建功能开关'}
      onCancel={onClose}
      onOk={handleOk}
      confirmLoading={isPending}
      okText="保存"
      cancelText="取消"
      width={520}
    >
      <Form form={form} layout="vertical" size="small">
        <Form.Item
          label="Key（唯一标识）"
          name="key"
          rules={[{ required: true, message: '请输入 Key' }, { max: 100 }]}
        >
          <Input
            placeholder="e.g. new_recipe_tab"
            disabled={!!initial}
            style={{ fontFamily: 'monospace' }}
          />
        </Form.Item>
        <Form.Item
          label="名称"
          name="name"
          rules={[{ required: true, message: '请输入名称' }, { max: 200 }]}
        >
          <Input placeholder="新食谱标签页" />
        </Form.Item>
        <Form.Item label="描述" name="description">
          <TextArea rows={2} placeholder="可选备注" />
        </Form.Item>
        <Form.Item label="类型" name="type" initialValue="boolean">
          <Select
            options={Object.entries(TYPE_LABELS).map(([value, label]) => ({
              value,
              label,
            }))}
            onChange={(v) => setCurrentType(v as FeatureFlagType)}
          />
        </Form.Item>
        <Form.Item label="默认启用" name="enabled" valuePropName="checked">
          <Switch />
        </Form.Item>
        <Divider plain style={{ fontSize: 12, color: '#8c8c8c' }}>
          类型配置
        </Divider>
        <FlagConfigFields type={currentType} />
      </Form>
    </Modal>
  );
};

// ==================== 主页面 ====================

const FeatureFlagsPage: React.FC = () => {
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<FeatureFlag | null>(null);

  const { data: flags, isLoading } = useFeatureFlags();
  const { mutateAsync: toggle } = useToggleFeatureFlag();
  const { mutateAsync: deleteFlag } = useDeleteFeatureFlag();

  const handleToggle = async (flag: FeatureFlag) => {
    await toggle(flag.key);
    message.success(`${flag.name} 已${flag.enabled ? '关闭' : '开启'}`);
  };

  const handleDelete = async (flag: FeatureFlag) => {
    await deleteFlag(flag.key);
    message.success(`已删除 ${flag.key}`);
  };

  const handleEdit = (flag: FeatureFlag) => {
    setEditing(flag);
    setModalOpen(true);
  };

  const handleCreate = () => {
    setEditing(null);
    setModalOpen(true);
  };

  const columns: ColumnsType<FeatureFlag> = [
    {
      title: 'Key',
      dataIndex: 'key',
      width: 200,
      render: (v) => (
        <Text code copyable={{ text: v }} style={{ fontSize: 12 }}>
          {v}
        </Text>
      ),
    },
    { title: '名称', dataIndex: 'name', ellipsis: true },
    {
      title: '类型',
      dataIndex: 'type',
      width: 110,
      render: (v: FeatureFlagType) => <Tag color={TYPE_COLORS[v]}>{TYPE_LABELS[v]}</Tag>,
    },
    {
      title: '配置',
      dataIndex: 'config',
      width: 160,
      ellipsis: true,
      render: (cfg: Record<string, unknown>) => {
        if (!cfg || Object.keys(cfg).length === 0) return <Text type="secondary">—</Text>;
        if (cfg.percentage !== undefined) return <Tag>{cfg.percentage as React.ReactNode}%</Tag>;
        if (Array.isArray(cfg.whitelist)) return <Tag>{cfg.whitelist.length} 白名单</Tag>;
        if (Array.isArray(cfg.segments)) return <Tag>{cfg.segments.join(', ')}</Tag>;
        return (
          <Text type="secondary" style={{ fontSize: 11 }}>
            {JSON.stringify(cfg).slice(0, 40)}
          </Text>
        );
      },
    },
    {
      title: '状态',
      dataIndex: 'enabled',
      width: 80,
      render: (v: boolean, record) => (
        <Switch checked={v} size="small" onChange={() => handleToggle(record)} />
      ),
    },
    {
      title: '操作',
      width: 100,
      render: (_, record) => (
        <Space size={4}>
          <Button
            type="text"
            size="small"
            icon={<EditOutlined />}
            onClick={() => handleEdit(record)}
          />
          <Popconfirm
            title={`确认删除 ${record.key}？`}
            onConfirm={() => handleDelete(record)}
            okText="删除"
            okButtonProps={{ danger: true }}
            cancelText="取消"
          >
            <Button type="text" size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <>
      <Card
        title={
          <Space>
            <ThunderboltOutlined />
            <span>功能开关管理</span>
            <Tag color="blue">{flags?.length ?? 0} 个</Tag>
          </Space>
        }
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
            新建
          </Button>
        }
        size="small"
      >
        <Spin spinning={isLoading}>
          <Table
            size="small"
            dataSource={flags ?? []}
            rowKey="id"
            columns={columns}
            pagination={{ pageSize: 20, showSizeChanger: false }}
          />
        </Spin>
      </Card>

      <FlagModal open={modalOpen} initial={editing} onClose={() => setModalOpen(false)} />
    </>
  );
};

export default FeatureFlagsPage;
