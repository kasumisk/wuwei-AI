import React, { useState, useCallback } from 'react';
import {
  Card,
  Row,
  Col,
  Button,
  DatePicker,
  Select,
  Table,
  Tag,
  Space,
  Typography,
  Alert,
  Statistic,
  Divider,
  message,
  Tooltip,
} from 'antd';
import {
  DownloadOutlined,
  FileExcelOutlined,
  FileTextOutlined,
  DatabaseOutlined,
  ClockCircleOutlined,
  CheckCircleOutlined,
  BarChartOutlined,
  UserOutlined,
  ShoppingCartOutlined,
  ExperimentOutlined,
  ThunderboltOutlined,
  FundOutlined,
} from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import { downloadReport } from '@/services/analyticsService';

const { Title, Text } = Typography;
const { RangePicker } = DatePicker;

// ==================== 路由配置 ====================

export const routeConfig = {
  name: 'system-export',
  title: '数据导出',
  icon: 'DownloadOutlined',
  order: 5,
  requireAuth: true,
  requireAdmin: true,
};

// ==================== 类型定义 ====================

interface ExportTask {
  id: string;
  name: string;
  type: string;
  format: 'csv' | 'json';
  status: 'success' | 'failed' | 'downloading';
  startTime: string;
  params: Record<string, any>;
  fileSize?: string;
}

interface ExportTemplate {
  key: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  category: 'analytics' | 'user' | 'business' | 'experiment';
  supportedFormats: ('csv' | 'json')[];
  needsDateRange: boolean;
  exportFn: (params: ExportParams) => Promise<void>;
}

interface ExportParams {
  dateRange?: [string, string];
  format: 'csv' | 'json';
}

// ==================== 前端 CSV 生成工具 ====================

// const _generateCsvDownload = (data: Record<string, any>[], filename: string) => {
//   if (!data.length) {
//     message.warning('没有可导出的数据');
//     return;
//   }
//   const headers = Object.keys(data[0]);
//   const csvContent = [
//     headers.join(','),
//     ...data.map((row) =>
//       headers
//         .map((h) => {
//           const val = row[h];
//           if (val === null || val === undefined) return '';
//           const str = String(val);
//           return str.includes(',') || str.includes('"') || str.includes('\n')
//             ? `"${str.replace(/"/g, '""')}"`
//             : str;
//         })
//         .join(',')
//     ),
//   ].join('\n');

//   const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
//   const url = window.URL.createObjectURL(blob);
//   const a = document.createElement('a');
//   a.href = url;
//   a.download = filename;
//   document.body.appendChild(a);
//   a.click();
//   window.URL.revokeObjectURL(url);
//   document.body.removeChild(a);
// };


// ==================== 导出模板定义 ====================

const CATEGORY_LABELS: Record<string, { label: string; color: string }> = {
  analytics: { label: '统计分析', color: 'blue' },
  user: { label: '用户数据', color: 'green' },
  business: { label: '业务数据', color: 'orange' },
  experiment: { label: '实验数据', color: 'purple' },
};

const createExportTemplates = (): ExportTemplate[] => [
  {
    key: 'analytics-overview',
    name: '统计总览报表',
    description: '导出指定时间范围内的平台核心指标（请求数、活跃客户、成功率、成本等）',
    icon: <BarChartOutlined style={{ fontSize: 24, color: '#1890ff' }} />,
    category: 'analytics',
    supportedFormats: ['csv', 'json'],
    needsDateRange: true,
    exportFn: async (params) => {
      const filename = `analytics_overview_${dayjs().format('YYYYMMDD_HHmmss')}`;
      await downloadReport(
        {
          startDate: params.dateRange?.[0],
          endDate: params.dateRange?.[1],
          type: 'overview',
        },
        `${filename}.${params.format}`
      );
    },
  },
  {
    key: 'analytics-timeseries',
    name: '时序趋势数据',
    description: '导出按时间维度的指标趋势数据（请求量、延迟、错误率等随时间变化）',
    icon: <FundOutlined style={{ fontSize: 24, color: '#52c41a' }} />,
    category: 'analytics',
    supportedFormats: ['csv', 'json'],
    needsDateRange: true,
    exportFn: async (params) => {
      const filename = `analytics_timeseries_${dayjs().format('YYYYMMDD_HHmmss')}`;
      await downloadReport(
        {
          startDate: params.dateRange?.[0],
          endDate: params.dateRange?.[1],
          type: 'timeseries',
        },
        `${filename}.${params.format}`
      );
    },
  },
  {
    key: 'analytics-cost',
    name: '成本分析报表',
    description: '导出 AI 服务调用的成本明细（按能力类型、模型分组的 token 消耗和费用）',
    icon: <ShoppingCartOutlined style={{ fontSize: 24, color: '#fa8c16' }} />,
    category: 'analytics',
    supportedFormats: ['csv', 'json'],
    needsDateRange: true,
    exportFn: async (params) => {
      const filename = `cost_analysis_${dayjs().format('YYYYMMDD_HHmmss')}`;
      await downloadReport(
        {
          startDate: params.dateRange?.[0],
          endDate: params.dateRange?.[1],
          type: 'cost',
        },
        `${filename}.${params.format}`
      );
    },
  },
  {
    key: 'analytics-errors',
    name: '错误分析报表',
    description: '导出指定时间范围内的错误日志摘要（错误类型、频率、影响范围）',
    icon: <ThunderboltOutlined style={{ fontSize: 24, color: '#f5222d' }} />,
    category: 'analytics',
    supportedFormats: ['csv', 'json'],
    needsDateRange: true,
    exportFn: async (params) => {
      const filename = `error_analysis_${dayjs().format('YYYYMMDD_HHmmss')}`;
      await downloadReport(
        {
          startDate: params.dateRange?.[0],
          endDate: params.dateRange?.[1],
          type: 'errors',
        },
        `${filename}.${params.format}`
      );
    },
  },
  {
    key: 'top-clients',
    name: '客户端排行报表',
    description: '导出按请求量/错误率排名的客户端统计数据',
    icon: <UserOutlined style={{ fontSize: 24, color: '#722ed1' }} />,
    category: 'user',
    supportedFormats: ['csv', 'json'],
    needsDateRange: true,
    exportFn: async (params) => {
      const filename = `top_clients_${dayjs().format('YYYYMMDD_HHmmss')}`;
      await downloadReport(
        {
          startDate: params.dateRange?.[0],
          endDate: params.dateRange?.[1],
          type: 'clients',
        },
        `${filename}.${params.format}`
      );
    },
  },
  {
    key: 'capability-usage',
    name: '能力使用统计',
    description: '导出各 AI 能力（分析、推荐、对话等）的调用量和成功率统计',
    icon: <DatabaseOutlined style={{ fontSize: 24, color: '#13c2c2' }} />,
    category: 'business',
    supportedFormats: ['csv', 'json'],
    needsDateRange: true,
    exportFn: async (params) => {
      const filename = `capability_usage_${dayjs().format('YYYYMMDD_HHmmss')}`;
      await downloadReport(
        {
          startDate: params.dateRange?.[0],
          endDate: params.dateRange?.[1],
          type: 'capability',
        },
        `${filename}.${params.format}`
      );
    },
  },
  {
    key: 'experiment-results',
    name: 'A/B 实验结果',
    description: '导出 A/B 实验的各组指标对比数据（接受率、替换率、样本量、p值等）',
    icon: <ExperimentOutlined style={{ fontSize: 24, color: '#eb2f96' }} />,
    category: 'experiment',
    supportedFormats: ['csv', 'json'],
    needsDateRange: false,
    exportFn: async (params) => {
      const filename = `ab_experiments_${dayjs().format('YYYYMMDD_HHmmss')}`;
      await downloadReport({ type: 'experiments' }, `${filename}.${params.format}`);
    },
  },
];

// ==================== 主组件 ====================

const DataExportCenter: React.FC = () => {
  const [dateRange, setDateRange] = useState<[Dayjs, Dayjs]>([
    dayjs().subtract(30, 'day'),
    dayjs(),
  ]);
  const [selectedFormat, setSelectedFormat] = useState<'csv' | 'json'>('csv');
  const [exportHistory, setExportHistory] = useState<ExportTask[]>([]);
  const [loadingKeys, setLoadingKeys] = useState<Set<string>>(new Set());

  const templates = createExportTemplates();

  const handleExport = useCallback(
    async (template: ExportTemplate) => {
      const taskId = `${template.key}_${Date.now()}`;
      const loadKey = template.key;

      setLoadingKeys((prev) => new Set(prev).add(loadKey));

      const newTask: ExportTask = {
        id: taskId,
        name: template.name,
        type: template.category,
        format: selectedFormat,
        status: 'downloading',
        startTime: dayjs().format('YYYY-MM-DD HH:mm:ss'),
        params: {
          dateRange: template.needsDateRange
            ? [dateRange[0].format('YYYY-MM-DD'), dateRange[1].format('YYYY-MM-DD')]
            : undefined,
          format: selectedFormat,
        },
      };

      setExportHistory((prev) => [newTask, ...prev]);

      try {
        await template.exportFn({
          dateRange: template.needsDateRange
            ? [dateRange[0].format('YYYY-MM-DD'), dateRange[1].format('YYYY-MM-DD')]
            : undefined,
          format: selectedFormat,
        });

        setExportHistory((prev) =>
          prev.map((t) => (t.id === taskId ? { ...t, status: 'success' as const } : t))
        );
        message.success(`${template.name} 导出成功`);
      } catch (error) {
        setExportHistory((prev) =>
          prev.map((t) => (t.id === taskId ? { ...t, status: 'failed' as const } : t))
        );
        message.error(`${template.name} 导出失败`);
      } finally {
        setLoadingKeys((prev) => {
          const next = new Set(prev);
          next.delete(loadKey);
          return next;
        });
      }
    },
    [dateRange, selectedFormat]
  );

  // 按分类分组
  const groupedTemplates = templates.reduce(
    (acc, t) => {
      if (!acc[t.category]) acc[t.category] = [];
      acc[t.category].push(t);
      return acc;
    },
    {} as Record<string, ExportTemplate[]>
  );

  const historyColumns = [
    {
      title: '报表名称',
      dataIndex: 'name',
      key: 'name',
      render: (name: string, record: ExportTask) => (
        <Space>
          <FileTextOutlined />
          <Text strong>{name}</Text>
          <Tag>{record.format.toUpperCase()}</Tag>
        </Space>
      ),
    },
    {
      title: '分类',
      dataIndex: 'type',
      key: 'type',
      width: 100,
      render: (type: string) => {
        const cat = CATEGORY_LABELS[type];
        return cat ? <Tag color={cat.color}>{cat.label}</Tag> : <Tag>{type}</Tag>;
      },
    },
    {
      title: '导出时间',
      dataIndex: 'startTime',
      key: 'startTime',
      width: 180,
      render: (time: string) => (
        <Space>
          <ClockCircleOutlined />
          <Text type="secondary">{time}</Text>
        </Space>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status: ExportTask['status']) => {
        switch (status) {
          case 'success':
            return (
              <Tag color="success" icon={<CheckCircleOutlined />}>
                成功
              </Tag>
            );
          case 'failed':
            return <Tag color="error">失败</Tag>;
          case 'downloading':
            return <Tag color="processing">导出中</Tag>;
          default:
            return <Tag>{status}</Tag>;
        }
      },
    },
  ];

  return (
    <div style={{ padding: 0 }}>
      {/* 说明 */}
      <Alert
        type="info"
        showIcon
        icon={<DatabaseOutlined />}
        message="数据导出中心"
        description="选择报表模板、时间范围和格式，一键导出平台运营数据。后端导出返回文件流直接下载。"
        style={{ marginBottom: 16 }}
      />

      {/* 全局参数行 */}
      <Card size="small" style={{ marginBottom: 16 }}>
        <Row gutter={16} align="middle">
          <Col>
            <Text strong>时间范围：</Text>
          </Col>
          <Col>
            <RangePicker
              value={dateRange}
              onChange={(dates) => {
                if (dates && dates[0] && dates[1]) {
                  setDateRange([dates[0], dates[1]]);
                }
              }}
              presets={[
                { label: '最近7天', value: [dayjs().subtract(7, 'day'), dayjs()] },
                { label: '最近30天', value: [dayjs().subtract(30, 'day'), dayjs()] },
                { label: '最近90天', value: [dayjs().subtract(90, 'day'), dayjs()] },
                { label: '本月', value: [dayjs().startOf('month'), dayjs()] },
                {
                  label: '上月',
                  value: [
                    dayjs().subtract(1, 'month').startOf('month'),
                    dayjs().subtract(1, 'month').endOf('month'),
                  ],
                },
              ]}
            />
          </Col>
          <Col>
            <Text strong>格式：</Text>
          </Col>
          <Col>
            <Select
              value={selectedFormat}
              onChange={setSelectedFormat}
              style={{ width: 120 }}
              options={[
                { label: 'CSV 文件', value: 'csv' },
                { label: 'JSON 文件', value: 'json' },
              ]}
            />
          </Col>
          <Col flex="auto" />
          <Col>
            <Space>
              <Statistic
                title="本次会话导出"
                value={exportHistory.length}
                suffix="次"
                valueStyle={{ fontSize: 16 }}
              />
              <Divider type="vertical" style={{ height: 40 }} />
              <Statistic
                title="成功"
                value={exportHistory.filter((t) => t.status === 'success').length}
                valueStyle={{ fontSize: 16, color: '#52c41a' }}
              />
            </Space>
          </Col>
        </Row>
      </Card>

      {/* 导出模板 - 按分类展示 */}
      {Object.entries(groupedTemplates).map(([category, categoryTemplates]) => {
        const catInfo = CATEGORY_LABELS[category];
        return (
          <div key={category} style={{ marginBottom: 16 }}>
            <Title level={5} style={{ marginBottom: 12 }}>
              <Tag color={catInfo?.color}>{catInfo?.label || category}</Tag>
            </Title>
            <Row gutter={[12, 12]}>
              {categoryTemplates.map((template) => {
                const isLoading = loadingKeys.has(template.key);
                return (
                  <Col xs={24} sm={12} lg={8} xl={6} key={template.key}>
                    <Card
                      hoverable
                      size="small"
                      style={{ height: '100%' }}
                      styles={{ body: { padding: '16px' } }}
                    >
                      <Space direction="vertical" style={{ width: '100%' }} size={8}>
                        <Space>
                          {template.icon}
                          <Text strong>{template.name}</Text>
                        </Space>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {template.description}
                        </Text>
                        <Space size={4}>
                          {template.supportedFormats.map((fmt) => (
                            <Tag key={fmt} style={{ fontSize: 11 }}>
                              {fmt === 'csv' ? (
                                <FileExcelOutlined style={{ marginRight: 2 }} />
                              ) : (
                                <FileTextOutlined style={{ marginRight: 2 }} />
                              )}
                              {fmt.toUpperCase()}
                            </Tag>
                          ))}
                          {!template.needsDateRange && (
                            <Tooltip title="此报表不需要时间范围参数">
                              <Tag color="default" style={{ fontSize: 11 }}>
                                全量
                              </Tag>
                            </Tooltip>
                          )}
                        </Space>
                        <Button
                          type="primary"
                          icon={<DownloadOutlined />}
                          loading={isLoading}
                          onClick={() => handleExport(template)}
                          block
                          size="small"
                        >
                          导出
                        </Button>
                      </Space>
                    </Card>
                  </Col>
                );
              })}
            </Row>
          </div>
        );
      })}

      {/* 导出历史 */}
      <Card
        title={
          <Space>
            <ClockCircleOutlined />
            <span>本次会话导出记录</span>
          </Space>
        }
        size="small"
        style={{ marginTop: 8 }}
      >
        {exportHistory.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '24px 0', color: '#999' }}>
            <DatabaseOutlined style={{ fontSize: 32, marginBottom: 8 }} />
            <br />
            <Text type="secondary">暂无导出记录，选择上方模板开始导出</Text>
          </div>
        ) : (
          <Table
            dataSource={exportHistory}
            columns={historyColumns}
            rowKey="id"
            size="small"
            pagination={false}
          />
        )}
      </Card>
    </div>
  );
};

export default DataExportCenter;
