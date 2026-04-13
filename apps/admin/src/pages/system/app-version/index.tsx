import React, { useState, useRef } from 'react';
import {
  Card,
  Button,
  Space,
  Tag,
  Popconfirm,
  message,
  Statistic,
  Row,
  Col,
  Upload,
  Table,
  Switch,
  Form,
  Input,
  Select,
  InputNumber,
  Tooltip,
  Modal,
} from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  CloudUploadOutlined,
  StopOutlined,
  ReloadOutlined,
  AndroidOutlined,
  AppleOutlined,
  UploadOutlined,
  AppstoreOutlined,
  GoogleOutlined,
  LinkOutlined,
} from '@ant-design/icons';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { ProTable } from '@ant-design/pro-components';
import ConfigurableProForm from '@/components/ProForm';
import type { FormConfig } from '@/types/form';
import {
  useCreateAppVersion,
  useUpdateAppVersion,
  useDeleteAppVersion,
  usePublishAppVersion,
  useArchiveAppVersion,
  useAppVersionStats,
  useAppVersionPackages,
  useCreatePackage,
  useUpdatePackage,
  useDeletePackage,
  useTogglePackageEnabled,
  appVersionApi,
  type AppVersionInfoDto,
  type AppVersionPackageDto,
  type AppPlatform,
  type UpdateType,
  type AppVersionStatus,
  type AppChannel,
  type CreatePackageDto,
  STORE_CHANNELS,
} from '@/services/appVersionService';
import { useUploadFile, type UploadResult } from '@/services/admin';
import globalModal from '@/utils/modal';

// ==================== 常量配置 ====================

const platformConfig: Record<AppPlatform, { color: string; icon: React.ReactNode; text: string }> =
  {
    android: { color: 'green', icon: <AndroidOutlined />, text: 'Android' },
    ios: { color: 'blue', icon: <AppleOutlined />, text: 'iOS' },
  };

const updateTypeConfig: Record<UpdateType, { color: string; text: string }> = {
  optional: { color: 'processing', text: '可选更新' },
  force: { color: 'error', text: '强制更新' },
};

const statusConfig: Record<AppVersionStatus, { color: string; text: string }> = {
  draft: { color: 'default', text: '草稿' },
  published: { color: 'success', text: '已发布' },
  archived: { color: 'warning', text: '已归档' },
};

const channelConfig: Record<
  AppChannel,
  { color: string; text: string; icon?: React.ReactNode; isStore: boolean }
> = {
  official: { color: 'blue', text: '官方渠道', icon: <LinkOutlined />, isStore: false },
  beta: { color: 'purple', text: '测试渠道', isStore: false },
  app_store: { color: 'geekblue', text: 'App Store', icon: <AppleOutlined />, isStore: true },
  google_play: { color: 'green', text: 'Google Play', icon: <GoogleOutlined />, isStore: true },
};

// ==================== 工具函数 ====================

function formatFileSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '-';
  const units = ['B', 'KB', 'MB', 'GB'];
  let index = 0;
  let size = bytes;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index++;
  }
  return `${size.toFixed(1)} ${units[index]}`;
}

// ==================== 渠道包管理弹窗 ====================

interface PackageManagerProps {
  version: AppVersionInfoDto;
  onClose: () => void;
}

const PackageManager: React.FC<PackageManagerProps> = ({ version, onClose }) => {
  const [packageFormVisible, setPackageFormVisible] = useState(false);
  const [editingPackage, setEditingPackage] = useState<AppVersionPackageDto | null>(null);
  const [uploadedFileInfo, setUploadedFileInfo] = useState<UploadResult | null>(null);
  const [uploading, setUploading] = useState(false);
  const [selectedChannel, setSelectedChannel] = useState<AppChannel>('official');
  const [_selectedPlatform, setSelectedPlatform] = useState<AppPlatform>('android');
  const [form] = Form.useForm();

  const uploadMutation = useUploadFile();
  const { data: packages = [], isLoading } = useAppVersionPackages(version.id);

  const createPackageMutation = useCreatePackage(version.id, {
    onSuccess: () => {
      message.success('渠道包创建成功');
      setPackageFormVisible(false);
      resetForm();
    },
    onError: (e: any) => message.error(`创建失败: ${e.message}`),
  });
  const updatePackageMutation = useUpdatePackage(version.id, {
    onSuccess: () => {
      message.success('更新成功');
      setPackageFormVisible(false);
      resetForm();
    },
    onError: (e: any) => message.error(`更新失败: ${e.message}`),
  });
  const deletePackageMutation = useDeletePackage(version.id, {
    onSuccess: () => message.success('删除成功'),
    onError: (e: any) => message.error(`删除失败: ${e.message}`),
  });
  const toggleMutation = useTogglePackageEnabled(version.id, {
    onError: (e: any) => message.error(`操作失败: ${e.message}`),
  });

  const resetForm = () => {
    form.resetFields();
    setEditingPackage(null);
    setUploadedFileInfo(null);
    setSelectedChannel('official');
    setSelectedPlatform('android');
  };

  const openCreate = () => {
    resetForm();
    setPackageFormVisible(true);
  };

  const openEdit = (pkg: AppVersionPackageDto) => {
    setEditingPackage(pkg);
    setSelectedChannel(pkg.channel as AppChannel);
    setSelectedPlatform(pkg.platform);
    form.setFieldsValue({
      platform: pkg.platform,
      channel: pkg.channel,
      downloadUrl: pkg.downloadUrl,
      fileSize: pkg.fileSize,
      checksum: pkg.checksum,
    });
    setPackageFormVisible(true);
  };

  const handleChannelChange = (channel: AppChannel) => {
    setSelectedChannel(channel);
    setUploadedFileInfo(null);
    if (channel === 'app_store') {
      form.setFieldValue('downloadUrl', 'https://apps.apple.com/app/id');
    } else if (channel === 'google_play') {
      form.setFieldValue('downloadUrl', 'https://play.google.com/store/apps/details?id=');
    } else {
      form.setFieldValue('downloadUrl', undefined);
    }
  };

  const handleSubmit = async () => {
    const values = await form.validateFields();
    const isStore = STORE_CHANNELS.includes(selectedChannel);
    const data: CreatePackageDto = {
      platform: values.platform,
      channel: values.channel,
      downloadUrl: uploadedFileInfo?.url || values.downloadUrl,
      fileSize: isStore ? 0 : (uploadedFileInfo?.size ?? values.fileSize ?? 0),
      checksum: isStore
        ? undefined
        : uploadedFileInfo
          ? `md5:${uploadedFileInfo.md5}`
          : values.checksum,
      enabled: true,
    };
    if (editingPackage) {
      updatePackageMutation.mutate({ id: editingPackage.id, data });
    } else {
      createPackageMutation.mutate(data);
    }
  };

  const isStore = STORE_CHANNELS.includes(selectedChannel);
  const availableChannels = Object.keys(channelConfig) as AppChannel[];

  const pkgColumns = [
    {
      title: '平台',
      dataIndex: 'platform',
      width: 100,
      render: (platform: AppPlatform) => {
        const cfg = platformConfig[platform];
        return cfg ? (
          <Tag color={cfg.color} icon={cfg.icon}>
            {cfg.text}
          </Tag>
        ) : (
          '-'
        );
      },
    },
    {
      title: '渠道',
      dataIndex: 'channel',
      render: (channel: AppChannel) => {
        const cfg = channelConfig[channel] || { color: 'default', text: channel, isStore: false };
        return (
          <Tag color={cfg.color} icon={cfg.icon}>
            {cfg.text}
          </Tag>
        );
      },
    },
    {
      title: '下载 / 商店链接',
      dataIndex: 'downloadUrl',
      ellipsis: true,
      render: (url: string) => (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          style={{
            maxWidth: 260,
            display: 'inline-block',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            verticalAlign: 'middle',
          }}
        >
          {url}
        </a>
      ),
    },
    {
      title: '文件大小',
      dataIndex: 'fileSize',
      width: 110,
      render: (size: number) => formatFileSize(size),
    },
    {
      title: '校验值',
      dataIndex: 'checksum',
      width: 160,
      render: (v: string) =>
        v ? (
          <Tooltip title={v}>
            <code style={{ fontSize: 11 }}>{v.slice(0, 20)}…</code>
          </Tooltip>
        ) : (
          '-'
        ),
    },
    {
      title: '启用',
      dataIndex: 'enabled',
      width: 80,
      render: (enabled: boolean, record: AppVersionPackageDto) => (
        <Switch
          checked={enabled}
          size="small"
          onChange={() => toggleMutation.mutate(record.id)}
          loading={toggleMutation.isPending}
        />
      ),
    },
    {
      title: '操作',
      width: 130,
      render: (_: any, record: AppVersionPackageDto) => (
        <Space size="small">
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEdit(record)}>
            编辑
          </Button>
          <Popconfirm
            title="确定删除该渠道包？"
            onConfirm={() => deletePackageMutation.mutate(record.id)}
            okText="删除"
            cancelText="取消"
          >
            <Button
              type="link"
              size="small"
              danger
              icon={<DeleteOutlined />}
              loading={deletePackageMutation.isPending}
            >
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <>
      <Modal
        title={
          <Space>
            {version.platform ? (
              <Tag
                color={platformConfig[version.platform].color}
                icon={platformConfig[version.platform].icon}
              >
                {platformConfig[version.platform].text}
              </Tag>
            ) : (
              <Tag color="cyan">全平台</Tag>
            )}
            <span>v{version.version} — 渠道包管理</span>
            <Tag color={statusConfig[version.status].color}>
              {statusConfig[version.status].text}
            </Tag>
          </Space>
        }
        open
        onCancel={onClose}
        footer={null}
        width={860}
        destroyOnClose
      >
        <div style={{ marginBottom: 12, textAlign: 'right' }}>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            添加渠道包
          </Button>
        </div>
        <Table
          rowKey="id"
          columns={pkgColumns}
          dataSource={packages}
          loading={isLoading}
          pagination={false}
          size="small"
          locale={{ emptyText: '暂无渠道包，点击右上角添加' }}
        />
      </Modal>

      <Modal
        title={editingPackage ? '编辑渠道包' : '添加渠道包'}
        open={packageFormVisible}
        onCancel={() => {
          setPackageFormVisible(false);
          resetForm();
        }}
        onOk={handleSubmit}
        confirmLoading={createPackageMutation.isPending || updatePackageMutation.isPending}
        destroyOnClose
        width={520}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="platform"
            label="平台"
            rules={[{ required: true, message: '请选择平台' }]}
          >
            <Select
              placeholder="选择平台"
              disabled={!!editingPackage}
              onChange={(v: AppPlatform) => setSelectedPlatform(v)}
              options={[
                {
                  label: (
                    <Space>
                      <AndroidOutlined /> Android
                    </Space>
                  ),
                  value: 'android',
                },
                {
                  label: (
                    <Space>
                      <AppleOutlined /> iOS
                    </Space>
                  ),
                  value: 'ios',
                },
              ]}
            />
          </Form.Item>
          <Form.Item
            name="channel"
            label="分发渠道"
            rules={[{ required: true, message: '请选择渠道' }]}
          >
            <Select
              placeholder="选择渠道"
              disabled={!!editingPackage}
              onChange={handleChannelChange}
              options={availableChannels.map((ch) => ({
                label: (
                  <Space>
                    {channelConfig[ch].icon}
                    {channelConfig[ch].text}
                    {channelConfig[ch].isStore && (
                      <Tag color="orange" style={{ fontSize: 11 }}>
                        商店
                      </Tag>
                    )}
                  </Space>
                ),
                value: ch,
              }))}
            />
          </Form.Item>

          {isStore ? (
            <Form.Item
              name="downloadUrl"
              label={selectedChannel === 'app_store' ? 'App Store 链接' : 'Google Play 链接'}
              rules={[{ required: true, message: '请输入商店链接' }]}
            >
              <Input
                prefix={selectedChannel === 'app_store' ? <AppleOutlined /> : <GoogleOutlined />}
                placeholder={
                  selectedChannel === 'app_store'
                    ? 'https://apps.apple.com/app/idXXXXXXXXXX'
                    : 'https://play.google.com/store/apps/details?id=com.example'
                }
              />
            </Form.Item>
          ) : (
            <>
              <Form.Item label="上传安装包">
                <Upload.Dragger
                  accept=".apk,.ipa,.aab"
                  maxCount={1}
                  showUploadList={false}
                  disabled={uploading}
                  customRequest={async ({ file, onSuccess, onError }) => {
                    try {
                      setUploading(true);
                      const result = await uploadMutation.mutateAsync({
                        file: file as File,
                        category: 'app-package',
                      });
                      setUploadedFileInfo(result);
                      form.setFieldsValue({
                        downloadUrl: result.url,
                        fileSize: result.size,
                        checksum: `md5:${result.md5}`,
                      });
                      message.success(`上传成功: ${formatFileSize(result.size)}`);
                      onSuccess?.(result);
                    } catch (err: any) {
                      message.error(`上传失败: ${err.message}`);
                      onError?.(err);
                    } finally {
                      setUploading(false);
                    }
                  }}
                >
                  <p className="ant-upload-drag-icon">
                    <UploadOutlined />
                  </p>
                  <p className="ant-upload-text">
                    {uploading ? '上传中...' : '点击或拖拽安装包到此区域'}
                  </p>
                  <p className="ant-upload-hint">
                    支持 .apk / .ipa / .aab，上传后自动填充链接、大小、MD5
                  </p>
                </Upload.Dragger>
                {uploadedFileInfo && (
                  <div
                    style={{
                      marginTop: 8,
                      padding: '8px 12px',
                      background: '#f6ffed',
                      borderRadius: 6,
                      border: '1px solid #b7eb8f',
                      fontSize: 12,
                    }}
                  >
                    ✅ {uploadedFileInfo.originalName} · {formatFileSize(uploadedFileInfo.size)} ·
                    MD5: {uploadedFileInfo.md5}
                  </div>
                )}
              </Form.Item>

              <Form.Item
                name="downloadUrl"
                label="下载链接"
                rules={[{ required: true, message: '请上传文件或手动填写链接' }]}
              >
                <Input placeholder="上传后自动填入，也可手动输入" disabled={!!uploadedFileInfo} />
              </Form.Item>

              <Row gutter={12}>
                <Col span={12}>
                  <Form.Item name="fileSize" label="文件大小（字节）">
                    <InputNumber
                      style={{ width: '100%' }}
                      placeholder="上传后自动填入"
                      disabled={!!uploadedFileInfo}
                      min={0}
                    />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="checksum" label="文件校验值">
                    <Input placeholder="md5:abc123..." disabled={!!uploadedFileInfo} />
                  </Form.Item>
                </Col>
              </Row>
            </>
          )}
        </Form>
      </Modal>
    </>
  );
};

// ==================== 主组件 ====================

const AppVersionManagement: React.FC = () => {
  const [currentRecord, setCurrentRecord] = useState<AppVersionInfoDto | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [packageManagerVersion, setPackageManagerVersion] = useState<AppVersionInfoDto | null>(
    null
  );
  const actionRef = useRef<ActionType>(null);

  const createMutation = useCreateAppVersion({
    onSuccess: () => {
      message.success('创建成功');
      setModalVisible(false);
      setCurrentRecord(null);
      actionRef.current?.reload();
    },
    onError: (e: any) => message.error(`创建失败: ${e.message}`),
  });
  const updateMutation = useUpdateAppVersion({
    onSuccess: () => {
      message.success('更新成功');
      setModalVisible(false);
      setCurrentRecord(null);
      actionRef.current?.reload();
    },
    onError: (e: any) => message.error(`更新失败: ${e.message}`),
  });
  const deleteMutation = useDeleteAppVersion({
    onSuccess: () => {
      message.success('删除成功');
      actionRef.current?.reload();
    },
    onError: (e: any) => message.error(`删除失败: ${e.message}`),
  });
  const publishMutation = usePublishAppVersion({
    onSuccess: () => {
      message.success('发布成功');
      actionRef.current?.reload();
    },
    onError: (e: any) => message.error(`发布失败: ${e.message}`),
  });
  const archiveMutation = useArchiveAppVersion({
    onSuccess: () => {
      message.success('归档成功');
      actionRef.current?.reload();
    },
    onError: (e: any) => message.error(`归档失败: ${e.message}`),
  });
  const { data: stats } = useAppVersionStats();

  const handleCreate = () => {
    setIsEditMode(false);
    setCurrentRecord(null);
    setModalVisible(true);
  };
  const handleEdit = (record: AppVersionInfoDto) => {
    setIsEditMode(true);
    setCurrentRecord(record);
    setModalVisible(true);
  };
  const handleDelete = (id: string) => (deleteMutation.mutate as any)(id);

  const handlePublish = (record: AppVersionInfoDto) => {
    const platText = record.platform ? platformConfig[record.platform].text : '全平台';
    globalModal.confirm({
      title: '确认发布',
      content: `确定要发布 ${platText} v${record.version} 吗？${record.grayRelease ? `（灰度：${record.grayPercent}%）` : ''}`,
      okText: '确认发布',
      cancelText: '取消',
      onOk: () => publishMutation.mutate({ id: record.id }),
    });
  };

  const handleArchive = (record: AppVersionInfoDto) => {
    const platText = record.platform ? platformConfig[record.platform].text : '全平台';
    globalModal.confirm({
      title: '确认归档',
      content: `确定要归档 ${platText} v${record.version} 吗？`,
      okText: '确认归档',
      cancelText: '取消',
      onOk: () => (archiveMutation.mutate as any)(record.id),
    });
  };

  const handleFormSubmit = async (values: Record<string, any>) => {
    const formData = {
      ...values,
      grayPercent: values.grayPercent ? Number(values.grayPercent) : 0,
      grayRelease: values.grayRelease ?? false,
      i18nDescription: values.i18nDescription
        ? typeof values.i18nDescription === 'string'
          ? JSON.parse(values.i18nDescription)
          : values.i18nDescription
        : undefined,
      metadata: values.metadata
        ? typeof values.metadata === 'string'
          ? JSON.parse(values.metadata)
          : values.metadata
        : undefined,
    };
    if (isEditMode && currentRecord) {
      updateMutation.mutate({ id: currentRecord.id, data: formData });
    } else {
      createMutation.mutate(formData as any);
    }
  };

  // ==================== 表格列 ====================

  const columns: ProColumns<AppVersionInfoDto>[] = [
    // {
    //   title: '平台',
    //   dataIndex: 'platform',
    //   width: 110,
    //   valueType: 'select',
    //   valueEnum: { android: { text: 'Android' }, ios: { text: 'iOS' } },
    //   render: (_: any, record: AppVersionInfoDto) => {
    //     const cfg = platformConfig[record.platform];
    //     return <Tag color={cfg.color} icon={cfg.icon}>{cfg.text}</Tag>;
    //   },
    // },
    {
      title: '版本号',
      dataIndex: 'version',
      width: 100,
      render: (_: any, record: AppVersionInfoDto) => (
        <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>v{record.version}</span>
      ),
    },
    {
      title: '标题',
      dataIndex: 'title',
      ellipsis: true,
      search: false,
    },
    {
      title: '更新类型',
      dataIndex: 'updateType',
      width: 110,
      valueType: 'select',
      valueEnum: { optional: { text: '可选更新' }, force: { text: '强制更新' } },
      render: (_: any, record: AppVersionInfoDto) => {
        const cfg = updateTypeConfig[record.updateType];
        return <Tag color={cfg.color}>{cfg.text}</Tag>;
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      valueType: 'select',
      valueEnum: {
        draft: { text: '草稿', status: 'Default' },
        published: { text: '已发布', status: 'Success' },
        archived: { text: '已归档', status: 'Warning' },
      },
      render: (_: any, record: AppVersionInfoDto) => {
        const cfg = statusConfig[record.status];
        return <Tag color={cfg.color}>{cfg.text}</Tag>;
      },
    },
    {
      title: '渠道包',
      dataIndex: 'packages',
      width: 180,
      search: false,
      render: (_: any, record: AppVersionInfoDto) => {
        const pkgs = record.packages || [];
        if (pkgs.length === 0) return <span style={{ color: '#bbb' }}>未配置</span>;
        return (
          <Space size={4} wrap>
            {pkgs.map((p) => {
              const cfg = channelConfig[p.channel as AppChannel] || {
                color: 'default',
                text: p.channel,
                isStore: false,
              };
              return (
                <Tooltip key={p.id} title={p.enabled ? '已启用' : '已禁用'}>
                  <Tag
                    color={p.enabled ? cfg.color : 'default'}
                    icon={cfg.icon}
                    style={{ margin: 0 }}
                  >
                    {cfg.text}
                  </Tag>
                </Tooltip>
              );
            })}
          </Space>
        );
      },
    },
    {
      title: '灰度',
      dataIndex: 'grayRelease',
      width: 90,
      search: false,
      render: (_: any, record: AppVersionInfoDto) =>
        record.grayRelease ? <Tag color="orange">{record.grayPercent}%</Tag> : <Tag>关闭</Tag>,
    },
    {
      title: '发布时间',
      dataIndex: 'releaseDate',
      width: 120,
      valueType: 'date',
      search: false,
      render: (_: any, record: AppVersionInfoDto) =>
        record.releaseDate ? new Date(record.releaseDate).toLocaleDateString('zh-CN') : '-',
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      width: 170,
      valueType: 'dateTime',
      search: false,
      sorter: true,
    },
    {
      title: '操作',
      key: 'actions',
      width: 260,
      fixed: 'right',
      search: false,
      render: (_: any, record: AppVersionInfoDto) => (
        <Space size="small">
          <Button
            type="link"
            size="small"
            icon={<AppstoreOutlined />}
            onClick={() => setPackageManagerVersion(record)}
            style={{ color: '#722ed1' }}
          >
            渠道包
          </Button>
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            onClick={() => handleEdit(record)}
          >
            编辑
          </Button>
          {record.status === 'draft' && (
            <Button
              type="link"
              size="small"
              icon={<CloudUploadOutlined />}
              onClick={() => handlePublish(record)}
              loading={publishMutation.isPending}
              style={{ color: '#52c41a' }}
            >
              发布
            </Button>
          )}
          {record.status === 'published' && (
            <Button
              type="link"
              size="small"
              icon={<StopOutlined />}
              onClick={() => handleArchive(record)}
              loading={archiveMutation.isPending}
              style={{ color: '#faad14' }}
            >
              归档
            </Button>
          )}
          {record.status !== 'published' && (
            <Popconfirm
              title="确定删除这个版本吗？"
              description="删除后不可恢复（含所有渠道包）"
              onConfirm={() => handleDelete(record.id)}
              okText="确定"
              cancelText="取消"
            >
              <Button
                type="link"
                size="small"
                danger
                icon={<DeleteOutlined />}
                loading={deleteMutation.isPending}
              >
                删除
              </Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  // ==================== 版本表单配置 ====================

  const formConfig: FormConfig = {
    title: isEditMode ? '编辑版本' : '新增版本',
    layout: 'vertical',
    fields: [
      {
        name: 'version',
        label: '版本号',
        type: 'text',
        required: true,
        rules: [{ pattern: /^\d+\.\d+\.\d+$/, message: '版本号格式必须为 x.y.z' }],
        fieldProps: { placeholder: '例如: 1.3.0', disabled: isEditMode },
      },
      {
        name: 'updateType',
        label: '更新类型',
        type: 'select',
        required: true,
        options: [
          { label: '可选更新', value: 'optional' },
          { label: '强制更新', value: 'force' },
        ],
        fieldProps: { placeholder: '选择更新类型' },
      },
      {
        name: 'title',
        label: '更新标题',
        type: 'text',
        required: true,
        fieldProps: { placeholder: '例如: v1.3.0 新功能发布' },
      },
      {
        name: 'description',
        label: '更新描述',
        type: 'textarea',
        required: true,
        fieldProps: { placeholder: '支持 Markdown 格式', rows: 5 },
      },
      {
        name: 'minSupportVersion',
        label: '最低支持版本',
        type: 'text',
        rules: [{ pattern: /^\d+\.\d+\.\d+$/, message: '版本号格式必须为 x.y.z' }],
        fieldProps: { placeholder: '低于此版本将强制更新，例如: 1.0.0' },
      },
      {
        name: 'grayRelease',
        label: '灰度发布',
        type: 'switch',
        fieldProps: { checkedChildren: '开启', unCheckedChildren: '关闭' },
      },
      {
        name: 'grayPercent',
        label: '灰度比例 (%)',
        type: 'slider',
        fieldProps: {
          min: 0,
          max: 100,
          marks: { 0: '0%', 25: '25%', 50: '50%', 75: '75%', 100: '100%' },
        },
      },
      {
        name: 'releaseDate',
        label: '发布时间',
        type: 'date',
        fieldProps: { placeholder: '留空则发布时立即生效', style: { width: '100%' } },
      },
      {
        name: 'i18nDescription',
        label: '多语言描述 (JSON)',
        type: 'textarea',
        fieldProps: {
          rows: 3,
          placeholder: '{"zh-CN": "中文描述", "en-US": "English description"}',
        },
      },
      {
        name: 'metadata',
        label: '扩展元数据 (JSON)',
        type: 'textarea',
        fieldProps: { rows: 3, placeholder: '{"key": "value"}' },
      },
    ],
  };

  // ==================== 渲染 ====================

  return (
    <Card>
      {/* 常驻统计卡片行 */}
      {stats && (
        <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
          <Col xs={12} sm={6}>
            <Card size="small" variant="borderless" style={{ background: '#fafafa' }}>
              <Statistic title="总版本数" value={stats.total} prefix={<AppstoreOutlined />} />
            </Card>
          </Col>
          <Col xs={12} sm={6}>
            <Card size="small" variant="borderless" style={{ background: '#fafafa' }}>
              <Statistic
                title="已发布"
                value={stats.published}
                valueStyle={{ color: '#52c41a' }}
                prefix={<CloudUploadOutlined />}
              />
            </Card>
          </Col>
          <Col xs={12} sm={6}>
            <Card size="small" variant="borderless" style={{ background: '#fafafa' }}>
              <Statistic title="草稿" value={stats.draft} />
            </Card>
          </Col>
          <Col xs={12} sm={6}>
            <Card size="small" variant="borderless" style={{ background: '#fafafa' }}>
              <Statistic
                title="已归档"
                value={stats.archived}
                valueStyle={{ color: '#faad14' }}
                prefix={<StopOutlined />}
              />
            </Card>
          </Col>
        </Row>
      )}

      <ProTable<AppVersionInfoDto>
        actionRef={actionRef}
        rowKey="id"
        headerTitle="App 版本管理"
        columns={columns}
        scroll={{ x: 1400 }}
        request={async (params) => {
          try {
            const { list, total } = await appVersionApi.getAppVersions({
              page: params.current,
              pageSize: params.pageSize,
              keyword: params.version,
              platform: params.platform,
              status: params.status,
              updateType: params.updateType,
            });
            return { data: list || [], total: total || 0, success: true };
          } catch {
            return { data: [], total: 0, success: false };
          }
        }}
        toolBarRender={() => [
          <Button
            key="refresh"
            icon={<ReloadOutlined />}
            onClick={() => actionRef.current?.reload()}
          >
            刷新
          </Button>,
          <Button key="create" type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
            新增版本
          </Button>,
        ]}
        pagination={{
          defaultPageSize: 10,
          showSizeChanger: true,
          showTotal: (total: number) => `共 ${total} 个版本`,
        }}
        search={{ labelWidth: 'auto' }}
      />

      {/* 版本编辑 Drawer */}
      <ConfigurableProForm
        config={formConfig}
        mode="drawer"
        visible={modalVisible}
        onVisibleChange={setModalVisible}
        initialValues={
          currentRecord
            ? {
                ...currentRecord,
                i18nDescription: currentRecord.i18nDescription
                  ? JSON.stringify(currentRecord.i18nDescription, null, 2)
                  : undefined,
                metadata: currentRecord.metadata
                  ? JSON.stringify(currentRecord.metadata, null, 2)
                  : undefined,
              }
            : { updateType: 'optional', grayRelease: false, grayPercent: 0 }
        }
        onFinish={handleFormSubmit}
        loading={createMutation.isPending || updateMutation.isPending}
        width={560}
      />

      {/* 渠道包管理弹窗 */}
      {packageManagerVersion && (
        <PackageManager
          version={packageManagerVersion}
          onClose={() => setPackageManagerVersion(null)}
        />
      )}
    </Card>
  );
};

export default AppVersionManagement;

export const routeConfig = {
  name: 'app-version',
  title: 'App版本管理',
  icon: 'CloudUploadOutlined',
  order: 10,
  requireAuth: true,
  requireAdmin: true,
};
