import React, { useMemo, useState } from 'react';
import {
  Alert,
  Avatar,
  Button,
  Card,
  Col,
  Descriptions,
  Divider,
  Drawer,
  Form,
  Input,
  Modal,
  Popconfirm,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import {
  BellOutlined,
  EyeOutlined,
  PlayCircleOutlined,
  PoweroffOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  SendOutlined,
  SyncOutlined,
} from '@ant-design/icons';
import {
  useCleanupInvalidPushTokens,
  useDisablePushDevice,
  usePushDevices,
  usePushLogs,
  usePushOverview,
  usePushProviderHealth,
  usePushUserDetail,
  useRetryPushLog,
  useSendPushTest,
  useTriggerPushCron,
  type PushDeviceItem,
  type PushLogItem,
} from '@/services/pushManagementService';

const { Text } = Typography;

export const routeConfig = {
  name: 'system-push-management',
  title: 'Push 管理',
  icon: 'BellOutlined',
  order: 5,
  requireAuth: true,
  requireAdmin: true,
};

const PushManagementPage: React.FC = () => {
  const [filters, setFilters] = useState<Record<string, string>>({ limit: '50' });
  const [logFilters, setLogFilters] = useState<Record<string, string>>({ limit: '50' });
  const [testOpen, setTestOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string>();
  const [form] = Form.useForm();

  const {
    data: overview,
    isLoading: overviewLoading,
    refetch: refetchOverview,
  } = usePushOverview();
  const {
    data: devices,
    isLoading: devicesLoading,
    refetch: refetchDevices,
  } = usePushDevices(filters);
  const { data: logs, isLoading: logsLoading, refetch: refetchLogs } = usePushLogs(logFilters);
  const {
    data: providerHealth,
    isLoading: providerHealthLoading,
    refetch: refetchProviderHealth,
  } = usePushProviderHealth();
  const {
    data: userDetail,
    isLoading: userDetailLoading,
    refetch: refetchUserDetail,
  } = usePushUserDetail(selectedUserId);
  const disableMutation = useDisablePushDevice();
  const testMutation = useSendPushTest();
  const triggerCronMutation = useTriggerPushCron();
  const retryLogMutation = useRetryPushLog();
  const cleanupMutation = useCleanupInvalidPushTokens();

  const providerSummary = useMemo(() => overview?.byProvider ?? [], [overview]);

  const handleDisable = async (id: string) => {
    await disableMutation.mutateAsync(id);
    message.success('Push token 已禁用');
  };

  const handleOpenUserDetail = async (userId: string) => {
    setSelectedUserId(userId);
  };

  const handleTriggerCron = async (
    cronName: 'push.daily-check-in' | 'push.no-analysis-today' | 'push.weekly-report-ready',
  ) => {
    const result = await triggerCronMutation.mutateAsync({ cronName });
    message.success(`${result.cronName} 已手动触发`);
  };

  const handleRetryLog = async (id: string) => {
    const result = await retryLogMutation.mutateAsync(id);
    message.success(`日志重试完成：sent=${result.sent}, failed=${result.failed}`);
  };

  const handleCleanupInvalidTokens = async () => {
    const result = await cleanupMutation.mutateAsync({ limit: 300 });
    message.success(
      `清理完成：扫描 ${result.scannedLogs} 条失败日志，命中 ${result.matchedDeviceIds} 个 token，实际清理 ${result.cleanedCount} 个`,
    );
  };

  const handleSendTest = async () => {
    const values = await form.validateFields();
    await testMutation.mutateAsync({
      userId: values.userId,
      type: values.type,
      payload: values.analysisId
        ? { target: 'analysis_detail', analysisId: values.analysisId }
        : { target: values.target || 'home' },
    });
    message.success('测试 Push 已发送');
    setTestOpen(false);
    form.resetFields();
  };

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Space style={{ width: '100%', justifyContent: 'space-between' }} wrap>
        <Alert
          type="info"
          showIcon
          message="用于查看推送设备、发送日志、Provider 分布，并向指定用户发送安全测试 Push。"
        />
        <Button
          icon={<ReloadOutlined />}
          onClick={() => {
            refetchOverview();
            refetchDevices();
            refetchLogs();
            refetchProviderHealth();
            if (selectedUserId) {
              refetchUserDetail();
            }
          }}
        >
          刷新
        </Button>
      </Space>

      <Card title="运维操作">
        <Space wrap>
          <Button
            icon={<PlayCircleOutlined />}
            loading={triggerCronMutation.isPending}
            onClick={() => handleTriggerCron('push.daily-check-in')}
          >
            触发每日签到提醒
          </Button>
          <Button
            icon={<PlayCircleOutlined />}
            loading={triggerCronMutation.isPending}
            onClick={() => handleTriggerCron('push.no-analysis-today')}
          >
            触发今日未分析提醒
          </Button>
          <Button
            icon={<PlayCircleOutlined />}
            loading={triggerCronMutation.isPending}
            onClick={() => handleTriggerCron('push.weekly-report-ready')}
          >
            触发周报提醒
          </Button>
          <Button
            danger
            icon={<SafetyCertificateOutlined />}
            loading={cleanupMutation.isPending}
            onClick={handleCleanupInvalidTokens}
          >
            清理无效 Token
          </Button>
        </Space>
      </Card>

      <Row gutter={16}>
        <Col span={6}>
          <Card loading={overviewLoading}>
            <Statistic
              title="活跃设备"
              value={overview?.activeDevices ?? 0}
              prefix={<BellOutlined />}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card loading={overviewLoading}>
            <Statistic title="失活设备" value={overview?.inactiveDevices ?? 0} />
          </Card>
        </Col>
        <Col span={6}>
          <Card loading={overviewLoading}>
            <Statistic title="发送成功" value={overview?.sentLogs ?? 0} />
          </Card>
        </Col>
        <Col span={6}>
          <Card loading={overviewLoading}>
            <Statistic
              title="发送失败"
              value={overview?.failedLogs ?? 0}
              valueStyle={{ color: '#cf1322' }}
            />
          </Card>
        </Col>
      </Row>

      <Card title="Provider / Region 分布" loading={overviewLoading}>
        <Descriptions bordered size="small" column={2}>
          {providerSummary.map((item) => (
            <Descriptions.Item
              key={`${item.providerType}-${item.pushRegion}-${String(item.isActive)}`}
              label={`${item.providerType} / ${item.pushRegion} / ${item.isActive ? 'active' : 'inactive'}`}
            >
              {item._count._all}
            </Descriptions.Item>
          ))}
        </Descriptions>
      </Card>

      <Card title="Provider 健康 / Fallback" loading={providerHealthLoading}>
        <Table
          rowKey="type"
          pagination={false}
          dataSource={providerHealth ?? []}
          columns={[
            {
              title: 'Provider',
              dataIndex: 'type',
              render: (value: string) => <Tag>{value}</Tag>,
            },
            {
              title: '健康状态',
              dataIndex: 'isAvailable',
              render: (value: boolean) => (
                <Tag color={value ? 'success' : 'error'}>{value ? 'available' : 'unavailable'}</Tag>
              ),
            },
            {
              title: 'Fallback',
              dataIndex: 'fallbackType',
              render: (value: string) => <Tag color="blue">{value}</Tag>,
            },
            { title: '活跃设备', dataIndex: 'activeDevices' },
            { title: '失活设备', dataIndex: 'inactiveDevices' },
            { title: '发送成功', dataIndex: 'sentLogs' },
            {
              title: '发送失败',
              dataIndex: 'failedLogs',
              render: (value: number) => <Text type={value > 0 ? 'danger' : undefined}>{value}</Text>,
            },
          ]}
        />
      </Card>

      <Card
        title="设备 Token"
        extra={
          <Space>
            <Input.Search
              allowClear
              placeholder="按 userId 过滤"
              onSearch={(value) => setFilters((prev) => ({ ...prev, userId: value }))}
              style={{ width: 220 }}
            />
            <Select
              allowClear
              placeholder="Provider"
              style={{ width: 140 }}
              onChange={(value) => setFilters((prev) => ({ ...prev, providerType: value || '' }))}
              options={[
                { label: 'FCM', value: 'FCM' },
                { label: 'JPUSH', value: 'JPUSH' },
                { label: 'HUAWEI', value: 'HUAWEI' },
                { label: 'MOCK', value: 'MOCK' },
              ]}
            />
            <Select
              allowClear
              placeholder="Region"
              style={{ width: 160 }}
              onChange={(value) => setFilters((prev) => ({ ...prev, pushRegion: value || '' }))}
              options={[
                { label: 'GLOBAL', value: 'GLOBAL' },
                { label: 'CHINA_MAINLAND', value: 'CHINA_MAINLAND' },
                { label: 'EU', value: 'EU' },
                { label: 'JAPAN', value: 'JAPAN' },
                { label: 'KOREA', value: 'KOREA' },
              ]}
            />
          </Space>
        }
      >
        <Table<PushDeviceItem>
          rowKey="id"
          loading={devicesLoading}
          dataSource={devices?.list ?? []}
          pagination={false}
          columns={[
            {
              title: 'User',
              dataIndex: 'userId',
              width: 220,
              render: (value) => (
                <Space>
                  <Text copyable>{value}</Text>
                  <Tooltip title="查看用户偏好详情">
                    <Button size="small" type="link" icon={<EyeOutlined />} onClick={() => handleOpenUserDetail(value)} />
                  </Tooltip>
                </Space>
              ),
            },
            {
              title: 'Provider',
              render: (_, record) => (
                <Space>
                  <Tag>{record.providerType}</Tag>
                  <Tag color="blue">{record.pushRegion}</Tag>
                </Space>
              ),
            },
            { title: 'Platform', dataIndex: 'platform', width: 100 },
            { title: 'Locale', dataIndex: 'locale', width: 100 },
            { title: 'Timezone', dataIndex: 'timezone', width: 160 },
            {
              title: '状态',
              dataIndex: 'isActive',
              width: 100,
              render: (value: boolean) => (
                <Tag color={value ? 'success' : 'default'}>{value ? 'active' : 'inactive'}</Tag>
              ),
            },
            {
              title: 'Token',
              dataIndex: 'token',
              render: (value: string) => (
                <Text
                  copyable={{ text: value }}
                >{`${value.slice(0, 16)}...${value.slice(-8)}`}</Text>
              ),
            },
            {
              title: '操作',
              width: 120,
              render: (_, record) => (
                <Popconfirm title="确认禁用该 token？" onConfirm={() => handleDisable(record.id)}>
                  <Button size="small" danger icon={<PoweroffOutlined />} />
                </Popconfirm>
              ),
            },
          ]}
        />
      </Card>

      <Card
        title="发送日志"
        extra={
          <Space>
            <Input.Search
              allowClear
              placeholder="按 userId 过滤"
              onSearch={(value) => setLogFilters((prev) => ({ ...prev, userId: value }))}
              style={{ width: 220 }}
            />
            <Select
              allowClear
              placeholder="状态"
              style={{ width: 140 }}
              onChange={(value) => setLogFilters((prev) => ({ ...prev, status: value || '' }))}
              options={[
                { label: 'SENT', value: 'SENT' },
                { label: 'FAILED', value: 'FAILED' },
                { label: 'SKIPPED', value: 'SKIPPED' },
              ]}
            />
            <Button type="primary" icon={<SendOutlined />} onClick={() => setTestOpen(true)}>
              发送测试 Push
            </Button>
          </Space>
        }
      >
        <Table<PushLogItem>
          rowKey="id"
          loading={logsLoading}
          dataSource={logs?.list ?? []}
          pagination={false}
          columns={[
            {
              title: '时间',
              dataIndex: 'createdAt',
              width: 180,
              render: (value) => new Date(value).toLocaleString('zh-CN'),
            },
            {
              title: 'User',
              dataIndex: 'userId',
              width: 220,
              render: (value) => (
                <Space>
                  <Text copyable>{value}</Text>
                  <Tooltip title="查看用户偏好详情">
                    <Button size="small" type="link" icon={<EyeOutlined />} onClick={() => handleOpenUserDetail(value)} />
                  </Tooltip>
                </Space>
              ),
            },
            { title: '类型', dataIndex: 'notificationType', width: 180 },
            {
              title: '结果',
              render: (_, record) => (
                <Space>
                  <Tag color={record.status === 'SENT' ? 'success' : record.status === 'FAILED' ? 'error' : 'default'}>{record.status}</Tag>
                  <Tag>{record.providerType}</Tag>
                </Space>
              ),
            },
            { title: '标题', dataIndex: 'title', width: 220 },
            { title: '正文', dataIndex: 'body' },
            {
              title: '错误',
              render: (_, record) =>
                record.errorCode || record.errorMessage ? (
                  <Text type="danger">{record.errorCode || record.errorMessage}</Text>
                ) : (
                  '-'
                ),
            },
            {
              title: '操作',
              width: 120,
              render: (_, record) =>
                record.status === 'FAILED' ? (
                  <Button
                    size="small"
                    icon={<SyncOutlined />}
                    loading={retryLogMutation.isPending}
                    onClick={() => handleRetryLog(record.id)}
                  >
                    重试
                  </Button>
                ) : (
                  '-'
                ),
            },
          ]}
        />
      </Card>

      <Drawer
        width={720}
        open={Boolean(selectedUserId)}
        title="用户 Push 偏好详情"
        onClose={() => setSelectedUserId(undefined)}
      >
        {userDetail ? (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Space align="start">
              <Avatar src={userDetail.user.avatar || undefined} size={56}>
                {userDetail.user.nickname?.slice(0, 1) || 'U'}
              </Avatar>
              <Descriptions column={1} size="small">
                <Descriptions.Item label="用户 ID">
                  <Text copyable>{userDetail.user.id}</Text>
                </Descriptions.Item>
                <Descriptions.Item label="昵称">{userDetail.user.nickname || '-'}</Descriptions.Item>
                <Descriptions.Item label="邮箱">{userDetail.user.email || '-'}</Descriptions.Item>
                <Descriptions.Item label="状态">
                  <Tag color={userDetail.user.status === 'active' ? 'success' : 'default'}>
                    {userDetail.user.status}
                  </Tag>
                </Descriptions.Item>
              </Descriptions>
            </Space>

            <Row gutter={16}>
              <Col span={6}>
                <Card>
                  <Statistic title="活跃设备" value={userDetail.summary.activeDeviceCount} />
                </Card>
              </Col>
              <Col span={6}>
                <Card>
                  <Statistic title="失活设备" value={userDetail.summary.inactiveDeviceCount} />
                </Card>
              </Col>
              <Col span={6}>
                <Card>
                  <Statistic title="最近成功" value={userDetail.summary.sentLogCount} />
                </Card>
              </Col>
              <Col span={6}>
                <Card>
                  <Statistic title="最近失败" value={userDetail.summary.failedLogCount} />
                </Card>
              </Col>
            </Row>

            <Descriptions bordered size="small" column={2}>
              <Descriptions.Item label="Push 总开关">
                <Tag color={userDetail.preference.pushEnabled ? 'success' : 'default'}>
                  {String(userDetail.preference.pushEnabled)}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="Locale">{userDetail.preference.locale}</Descriptions.Item>
              <Descriptions.Item label="Timezone">{userDetail.preference.timezone}</Descriptions.Item>
              <Descriptions.Item label="免打扰">
                {userDetail.preference.quietStart} - {userDetail.preference.quietEnd}
              </Descriptions.Item>
              <Descriptions.Item label="Daily Check-In">
                <Tag color={userDetail.preference.dailyCheckInEnabled ? 'success' : 'default'}>
                  {String(userDetail.preference.dailyCheckInEnabled)}
                </Tag>
                {' / '}
                {userDetail.preference.dailyReminderTime}
              </Descriptions.Item>
              <Descriptions.Item label="No Analysis Today">
                <Tag color={userDetail.preference.noAnalysisTodayEnabled ? 'success' : 'default'}>
                  {String(userDetail.preference.noAnalysisTodayEnabled)}
                </Tag>
                {' / '}
                {userDetail.preference.noAnalysisReminderTime}
              </Descriptions.Item>
              <Descriptions.Item label="Weekly Report">
                <Tag color={userDetail.preference.weeklyReportEnabled ? 'success' : 'default'}>
                  {String(userDetail.preference.weeklyReportEnabled)}
                </Tag>
                {' / 周'}
                {userDetail.preference.weeklyReportDay}
                {' / '}
                {userDetail.preference.weeklyReportTime}
              </Descriptions.Item>
              <Descriptions.Item label="Analysis Follow Up">
                <Tag color={userDetail.preference.analysisFollowUpEnabled ? 'success' : 'default'}>
                  {String(userDetail.preference.analysisFollowUpEnabled)}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="Premium Hint">
                <Tag color={userDetail.preference.premiumUpgradeHintEnabled ? 'success' : 'default'}>
                  {String(userDetail.preference.premiumUpgradeHintEnabled)}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="更新时间" span={2}>
                {new Date(userDetail.preference.updatedAt).toLocaleString('zh-CN')}
              </Descriptions.Item>
            </Descriptions>

            <Divider style={{ margin: 0 }} />

            <Card title="最近设备" size="small" loading={userDetailLoading}>
              <Table<PushDeviceItem>
                rowKey="id"
                pagination={false}
                size="small"
                dataSource={userDetail.devices}
                columns={[
                  { title: 'Provider', dataIndex: 'providerType', width: 100 },
                  { title: 'Region', dataIndex: 'pushRegion', width: 140 },
                  { title: 'Platform', dataIndex: 'platform', width: 100 },
                  {
                    title: '状态',
                    dataIndex: 'isActive',
                    width: 100,
                    render: (value: boolean) => (
                      <Tag color={value ? 'success' : 'default'}>{value ? 'active' : 'inactive'}</Tag>
                    ),
                  },
                  {
                    title: '更新时间',
                    dataIndex: 'updatedAt',
                    render: (value: string) => new Date(value).toLocaleString('zh-CN'),
                  },
                ]}
              />
            </Card>

            <Card title="最近日志" size="small" loading={userDetailLoading}>
              <Table<PushLogItem>
                rowKey="id"
                pagination={false}
                size="small"
                dataSource={userDetail.logs}
                columns={[
                  {
                    title: '时间',
                    dataIndex: 'createdAt',
                    render: (value: string) => new Date(value).toLocaleString('zh-CN'),
                  },
                  { title: '类型', dataIndex: 'notificationType', width: 180 },
                  {
                    title: '状态',
                    dataIndex: 'status',
                    width: 120,
                    render: (value: string) => (
                      <Tag color={value === 'SENT' ? 'success' : value === 'FAILED' ? 'error' : 'default'}>
                        {value}
                      </Tag>
                    ),
                  },
                  { title: '错误', dataIndex: 'errorCode', render: (value: string | null) => value || '-' },
                ]}
              />
            </Card>
          </Space>
        ) : (
          <Card loading={userDetailLoading} />
        )}
      </Drawer>

      <Modal
        open={testOpen}
        title="发送测试 Push"
        onCancel={() => setTestOpen(false)}
        onOk={handleSendTest}
        confirmLoading={testMutation.isPending}
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="userId"
            label="目标用户 ID"
            rules={[{ required: true, message: '请输入 userId' }]}
          >
            <Input placeholder="App user UUID" />
          </Form.Item>
          <Form.Item name="type" label="推送类型" initialValue="DAILY_CHECK_IN">
            <Select
              options={[
                { label: 'DAILY_CHECK_IN', value: 'DAILY_CHECK_IN' },
                { label: 'NO_ANALYSIS_TODAY', value: 'NO_ANALYSIS_TODAY' },
                { label: 'WEEKLY_REPORT_READY', value: 'WEEKLY_REPORT_READY' },
                { label: 'ANALYSIS_FOLLOW_UP', value: 'ANALYSIS_FOLLOW_UP' },
                { label: 'PREMIUM_UPGRADE_HINT', value: 'PREMIUM_UPGRADE_HINT' },
              ]}
            />
          </Form.Item>
          <Form.Item name="target" label="跳转目标" initialValue="home">
            <Select
              options={[
                { label: 'home', value: 'home' },
                { label: 'analysis_detail', value: 'analysis_detail' },
                { label: 'weekly_report', value: 'weekly_report' },
                { label: 'premium', value: 'premium' },
              ]}
            />
          </Form.Item>
          <Form.Item name="analysisId" label="analysisId（仅 analysis_detail 使用）">
            <Input placeholder="optional" />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
};

export default PushManagementPage;
