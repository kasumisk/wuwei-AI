import React from 'react';
import {
  Card,
  Button,
  Space,
  Tag,
  Descriptions,
  Typography,
  Spin,
  Row,
  Col,
  Table,
  Tooltip,
  Badge,
  Popconfirm,
} from 'antd';
import {
  ArrowLeftOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  SwapOutlined,
  ExclamationCircleOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { useParams, useNavigate } from 'react-router-dom';
import type { ColumnsType } from 'antd/es/table';
import {
  useEnrichmentPreview,
  useApproveStaged,
  useRejectStaged,
  type EnrichmentFieldDiff,
} from '@/services/foodPipelineService';
import globalMessage from '@/utils/message';

const { Text, Title } = Typography;

// ==================== 路由配置 ====================

export const routeConfig = {
  name: 'enrichment-preview',
  title: 'AI补全预览',
  icon: 'EyeOutlined',
  order: 14,
  requireAuth: true,
  hideInMenu: true,
};

// ==================== 工具函数 ====================

/** 判断建议值是否在合理范围内 */
function isInRange(value: any, range: { min: number; max: number } | null): boolean | null {
  if (!range || value === null || value === undefined) return null;
  const num = Number(value);
  if (isNaN(num)) return null;
  return num >= range.min && num <= range.max;
}

/** 计算与同类均值的偏差百分比 */
function deviationPct(suggested: any, avg: number | undefined): string | null {
  if (avg === undefined || avg === null || avg === 0) return null;
  const num = Number(suggested);
  if (isNaN(num)) return null;
  const pct = ((num - avg) / avg) * 100;
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
}

// ==================== 主组件 ====================

const EnrichmentPreviewPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data: preview, isLoading } = useEnrichmentPreview(id!, !!id);

  const approveMutation = useApproveStaged({
    onSuccess: () => {
      globalMessage.success('审核通过，数据已入库');
      navigate('/food-library/enrichment');
    },
    onError: (e) => globalMessage.error(e.message),
  });

  const rejectMutation = useRejectStaged({
    onSuccess: () => {
      globalMessage.success('已拒绝');
      navigate('/food-library/enrichment');
    },
    onError: (e) => globalMessage.error(e.message),
  });

  if (isLoading) {
    return (
      <div style={{ textAlign: 'center', padding: 80 }}>
        <Spin size="large" tip="加载预览数据...">
          <div style={{ padding: 50 }} />
        </Spin>
      </div>
    );
  }

  if (!preview) {
    return (
      <Card>
        <Text type="danger">未找到预览数据</Text>
        <Button type="link" onClick={() => navigate('/food-library/enrichment')}>
          返回补全管理
        </Button>
      </Card>
    );
  }

  const { food, staged, diff, categoryAverage } = preview;

  // ==================== 对比表格列定义 ====================

  const columns: ColumnsType<EnrichmentFieldDiff> = [
    {
      title: '字段',
      dataIndex: 'label',
      width: 140,
      render: (label, record) => (
        <Space>
          <Text strong>{label}</Text>
          {record.unit && <Text type="secondary">({record.unit})</Text>}
        </Space>
      ),
    },
    {
      title: '当前值',
      dataIndex: 'currentValue',
      width: 120,
      render: (val) =>
        val !== null && val !== undefined ? (
          <Text>{String(val)}</Text>
        ) : (
          <Tag color="red">
            <ExclamationCircleOutlined /> 缺失
          </Tag>
        ),
    },
    {
      title: (
        <Space>
          <ThunderboltOutlined style={{ color: '#1677ff' }} />
          <span>AI 建议值</span>
        </Space>
      ),
      dataIndex: 'suggestedValue',
      width: 120,
      render: (val, record) => {
        if (val === null || val === undefined) return <Text type="secondary">-</Text>;
        const inRange = isInRange(val, record.validRange);
        return (
          <Space>
            <Text strong style={{ color: '#1677ff' }}>
              {String(val)}
            </Text>
            {inRange === false && (
              <Tooltip
                title={`超出合理范围 [${record.validRange!.min} - ${record.validRange!.max}]`}
              >
                <ExclamationCircleOutlined style={{ color: '#ff4d4f' }} />
              </Tooltip>
            )}
            {inRange === true && (
              <Tooltip title="在合理范围内">
                <CheckCircleOutlined style={{ color: '#52c41a' }} />
              </Tooltip>
            )}
          </Space>
        );
      },
    },
    {
      title: '同类均值',
      width: 120,
      render: (_, record) => {
        const avg = categoryAverage?.[record.field];
        if (avg === undefined || avg === null) return <Text type="secondary">-</Text>;
        const dev = deviationPct(record.suggestedValue, avg);
        return (
          <Space>
            <Text type="secondary">{Number(avg).toFixed(2)}</Text>
            {dev && (
              <Tag color={dev.startsWith('+') ? 'orange' : 'green'} style={{ fontSize: 11 }}>
                {dev}
              </Tag>
            )}
          </Space>
        );
      },
    },
    {
      title: '变化',
      width: 100,
      render: (_, record) => {
        if (record.currentValue === null || record.currentValue === undefined) {
          return <Tag color="blue">新增</Tag>;
        }
        if (record.currentValue === record.suggestedValue) {
          return <Tag>无变化</Tag>;
        }
        return (
          <Space size={2}>
            <SwapOutlined style={{ color: '#faad14' }} />
            <Tag color="gold">修改</Tag>
          </Space>
        );
      },
    },
    {
      title: '合理范围',
      width: 140,
      render: (_, record) => {
        if (!record.validRange) return <Text type="secondary">-</Text>;
        return (
          <Text type="secondary">
            [{record.validRange.min} ~ {record.validRange.max}]
          </Text>
        );
      },
    },
  ];

  // ==================== 渲染 ====================

  return (
    <div>
      {/* 顶部导航 + 操作按钮 */}
      <Card size="small" style={{ marginBottom: 16 }}>
        <Row justify="space-between" align="middle">
          <Col>
            <Space>
              <Button
                icon={<ArrowLeftOutlined />}
                onClick={() => navigate('/food-library/enrichment')}
              >
                返回补全管理
              </Button>
              <Title level={4} style={{ margin: 0 }}>
                AI补全预览
              </Title>
              <Tag color="blue">{food.name}</Tag>
              {food.nameZh && <Tag>{food.nameZh}</Tag>}
            </Space>
          </Col>
          <Col>
            <Space>
              <Popconfirm
                title="确认拒绝此补全建议？"
                onConfirm={() =>
                  rejectMutation.mutate({ id: staged.logId, reason: '人工审核拒绝' })
                }
              >
                <Button danger icon={<CloseCircleOutlined />} loading={rejectMutation.isPending}>
                  拒绝
                </Button>
              </Popconfirm>
              <Popconfirm
                title="确认通过此补全建议？数据将直接入库。"
                onConfirm={() => approveMutation.mutate({ id: staged.logId })}
              >
                <Button
                  type="primary"
                  icon={<CheckCircleOutlined />}
                  loading={approveMutation.isPending}
                >
                  通过并入库
                </Button>
              </Popconfirm>
            </Space>
          </Col>
        </Row>
      </Card>

      {/* 食物基本信息 + 暂存元信息 */}
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} md={12}>
          <Card title="食物信息" size="small">
            <Descriptions column={2} size="small">
              <Descriptions.Item label="ID">
                <Text copyable style={{ fontSize: 12 }}>
                  {food.id}
                </Text>
              </Descriptions.Item>
              <Descriptions.Item label="名称">{food.name}</Descriptions.Item>
              <Descriptions.Item label="中文名">{food.nameZh ?? '-'}</Descriptions.Item>
              <Descriptions.Item label="分类">{food.category ?? '-'}</Descriptions.Item>
              <Descriptions.Item label="二级分类">{food.subCategory ?? '-'}</Descriptions.Item>
            </Descriptions>
          </Card>
        </Col>
        <Col xs={24} md={12}>
          <Card title="补全信息" size="small">
            <Descriptions column={2} size="small">
              <Descriptions.Item label="暂存ID">
                <Text copyable style={{ fontSize: 12 }}>
                  {staged.logId}
                </Text>
              </Descriptions.Item>
              <Descriptions.Item label="置信度">
                <Badge
                  status={
                    staged.confidence >= 0.8
                      ? 'success'
                      : staged.confidence >= 0.5
                        ? 'warning'
                        : 'error'
                  }
                  text={`${(staged.confidence * 100).toFixed(0)}%`}
                />
              </Descriptions.Item>
              <Descriptions.Item label="目标">
                <Tag>{staged.target}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="阶段">
                {staged.stage != null ? `第 ${staged.stage} 阶段` : '-'}
              </Descriptions.Item>
              <Descriptions.Item label="变更字段数">
                <Text strong style={{ color: '#1677ff' }}>
                  {diff.length}
                </Text>
              </Descriptions.Item>
              <Descriptions.Item label="创建时间">{staged.createdAt}</Descriptions.Item>
            </Descriptions>
          </Card>
        </Col>
      </Row>

      {/* 核心：字段对比表格 */}
      <Card
        title={
          <Space>
            <SwapOutlined />
            <span>字段对比（{diff.length} 个字段）</span>
          </Space>
        }
        size="small"
        extra={
          <Space size={4}>
            <Tag color="blue">
              新增{' '}
              {diff.filter((d) => d.currentValue === null || d.currentValue === undefined).length}
            </Tag>
            <Tag color="gold">
              修改{' '}
              {
                diff.filter(
                  (d) =>
                    d.currentValue !== null &&
                    d.currentValue !== undefined &&
                    d.currentValue !== d.suggestedValue
                ).length
              }
            </Tag>
            {diff.some((d) => isInRange(d.suggestedValue, d.validRange) === false) && (
              <Tag color="red">
                <ExclamationCircleOutlined /> 有超范围值
              </Tag>
            )}
          </Space>
        }
      >
        <Table<EnrichmentFieldDiff>
          dataSource={diff}
          columns={columns}
          rowKey="field"
          size="small"
          pagination={false}
          rowClassName={(record) => {
            if (isInRange(record.suggestedValue, record.validRange) === false) {
              return 'ant-table-row-warning';
            }
            return '';
          }}
        />
      </Card>
    </div>
  );
};

export default EnrichmentPreviewPage;
