import React, { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Card,
  Button,
  Space,
  Tag,
  Popconfirm,
  message,
  Row,
  Col,
  Statistic,
  Tooltip,
  Progress,
  Modal,
  Descriptions,
  Typography,
  Alert,
} from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ReloadOutlined,
  EyeOutlined,
  ExportOutlined,
  ThunderboltOutlined,
  CheckOutlined,
  CloseOutlined,
} from '@ant-design/icons';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { ProTable } from '@ant-design/pro-components';
import { useNavigate } from 'react-router-dom';
import {
  foodLibraryApi,
  useDeleteFood,
  useToggleFoodVerified,
  useFoodLibraryStatistics,
  type FoodLibraryDto,
} from '@/services/foodLibraryService';
import { useEnrichNow } from '@/services/foodPipelineService';
import {
  FOOD_CATEGORIES,
  STATUS_MAP,
  SOURCE_MAP,
  CATEGORY_MAP,
  ENRICHMENT_STATUS_MAP,
} from '../constants';

export const routeConfig = {
  name: 'food-list',
  title: '食物列表',
  icon: 'UnorderedListOutlined',
  order: 1,
  requireAuth: true,
  hideInMenu: false,
};

interface EnrichResult {
  totalEnriched: number;
  totalFailed: number;
  completeness?: { score: number };
  stageResults?: Array<{
    stage: number;
    stageName: string;
    enrichedFields: string[];
    failedFields: string[];
  }>;
}

const FoodLibraryList: React.FC = () => {
  const actionRef = useRef<ActionType>(null);
  const navigate = useNavigate();

  // AI补全 — 结果弹窗状态
  const [enrichModal, setEnrichModal] = useState<{
    open: boolean;
    foodName: string;
    result?: EnrichResult;
  }>({ open: false, foodName: '' });
  const [enrichingId, setEnrichingId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const enrichNowMutation = useEnrichNow({
    onSuccess: (res) => {
      setEnrichingId(null);
      if (res) {
        setEnrichModal((prev) => ({ ...prev, open: true, result: res }));
      } else {
        message.success('补全完成');
      }
      actionRef.current?.reload();
    },
    onError: (e: any) => {
      setEnrichingId(null);
      const isTimeout = e?.code === 'ECONNABORTED' || e?.message?.includes('timeout');
      if (isTimeout) {
        // request.ts 拦截器已弹出通用超时 toast，这里用 info 提示替代，避免重叠
        // 服务端在客户端超时后仍会继续补全并入库，刷新列表以显示最新状态
        message.info('AI补全正在后台运行，请稍后刷新查看结果', 5);
        queryClient.invalidateQueries({ queryKey: ['foodLibrary'] });
        actionRef.current?.reload();
      } else {
        message.error(`AI补全失败: ${e.message}`);
      }
    },
  });

  const handleEnrichNow = (record: FoodLibraryDto) => {
    setEnrichingId(record.id);
    setEnrichModal({ open: false, foodName: record.name });
    enrichNowMutation.mutate({ foodId: record.id });
  };

  const deleteMutation = useDeleteFood({
    onSuccess: () => {
      message.success('已删除');
      actionRef.current?.reload();
    },
    onError: (e: any) => message.error(`删除失败: ${e.message}`),
  });
  const toggleVerifiedMutation = useToggleFoodVerified({
    onSuccess: () => {
      message.success('状态已更新');
      actionRef.current?.reload();
    },
  });

  const { data: stats } = useFoodLibraryStatistics();

  const columns: ProColumns<FoodLibraryDto>[] = [
    {
      title: '编码',
      dataIndex: 'code',
      width: 140,
      fixed: 'left',
      copyable: true,
    },
    {
      title: '名称',
      dataIndex: 'name',
      width: 140,
      fixed: 'left',
      render: (_, record) => (
        <a onClick={() => navigate(`/food-library/detail/${record.id}`)}>{record.name}</a>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      render: (_, r) => {
        const s = STATUS_MAP[r.status] || { text: r.status, color: 'default' };
        return <Tag color={s.color}>{s.text}</Tag>;
      },
      valueEnum: Object.fromEntries(
        Object.entries(STATUS_MAP).map(([k, v]) => [k, { text: v.text }])
      ),
    },
    {
      title: '分类',
      dataIndex: 'category',
      width: 100,
      valueEnum: Object.fromEntries(FOOD_CATEGORIES.map((c) => [c.value, { text: c.label }])),
      render: (_, r) => <Tag>{CATEGORY_MAP[r.category] || r.category}</Tag>,
    },
    {
      title: '热量',
      dataIndex: 'calories',
      width: 90,
      sorter: true,
      search: false,
      render: (v) => `${v} kcal`,
    },
    {
      title: '蛋白质',
      dataIndex: 'protein',
      width: 75,
      search: false,
      render: (v) => (v ? `${v}g` : '-'),
    },
    {
      title: '脂肪',
      dataIndex: 'fat',
      width: 75,
      search: false,
      render: (v) => (v ? `${v}g` : '-'),
    },
    {
      title: '碳水',
      dataIndex: 'carbs',
      width: 75,
      search: false,
      render: (v) => (v ? `${v}g` : '-'),
    },
    {
      title: '品质分',
      dataIndex: 'qualityScore',
      width: 75,
      search: false,
      render: (v) => v || '-',
    },
    {
      title: '已验证',
      dataIndex: 'isVerified',
      width: 85,
      valueEnum: { true: { text: '已验证' }, false: { text: '未验证' } },
      render: (_, record) => (
        <Tooltip title="点击切换验证状态">
          <Tag
            color={record.isVerified ? 'success' : 'default'}
            style={{ cursor: 'pointer' }}
            onClick={() => toggleVerifiedMutation.mutate(record.id)}
          >
            {record.isVerified ? (
              <>
                <CheckCircleOutlined /> 是
              </>
            ) : (
              <>
                <CloseCircleOutlined /> 否
              </>
            )}
          </Tag>
        </Tooltip>
      ),
    },
    {
      title: '来源',
      dataIndex: 'primarySource',
      width: 100,
      valueEnum: Object.fromEntries(Object.entries(SOURCE_MAP).map(([k, v]) => [k, { text: v }])),
      render: (_, r) => <Tag>{SOURCE_MAP[r.primarySource] || r.primarySource}</Tag>,
    },
    {
      title: '版本',
      dataIndex: 'dataVersion',
      width: 60,
      search: false,
    },
    {
      title: '标签',
      dataIndex: 'tags',
      width: 180,
      search: false,
      render: (_, record) => (
        <Space wrap size={[0, 4]}>
          {record.tags?.slice(0, 3).map((t) => (
            <Tag key={t} color="blue">
              {t}
            </Tag>
          ))}
          {record.tags?.length > 3 && <Tag>+{record.tags.length - 3}</Tag>}
        </Space>
      ),
    },
    {
      title: '完整度',
      dataIndex: 'dataCompleteness',
      width: 110,
      search: false,
      sorter: true,
      render: (_, record) => {
        const val = record.dataCompleteness ?? 0;
        const color = val >= 80 ? '#52c41a' : val >= 50 ? '#faad14' : '#ff4d4f';
        return (
          <Tooltip title={`${val}%`}>
            <Progress
              percent={val}
              size="small"
              strokeColor={color}
              format={(p) => `${p}%`}
              style={{ width: 80 }}
            />
          </Tooltip>
        );
      },
    },
    {
      title: '补全状态',
      dataIndex: 'enrichmentStatus',
      width: 100,
      valueEnum: Object.fromEntries(
        Object.entries(ENRICHMENT_STATUS_MAP).map(([k, v]) => [k, { text: v.text }])
      ),
      render: (_, r) => {
        const s = ENRICHMENT_STATUS_MAP[r.enrichmentStatus || 'pending'] || {
          text: r.enrichmentStatus || '待补全',
          color: 'default',
        };
        return <Tag color={s.color}>{s.text}</Tag>;
      },
    },
    {
      title: '操作',
      width: 240,
      fixed: 'right',
      search: false,
      render: (_, record) => (
        <Space>
          <Button
            type="link"
            size="small"
            icon={<EyeOutlined />}
            onClick={() => navigate(`/food-library/detail/${record.id}`)}
          >
            详情
          </Button>
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            onClick={() => navigate(`/food-library/edit/${record.id}`)}
          >
            编辑
          </Button>
          <Tooltip title="立即用AI补全该食物缺失字段">
            <Button
              type="link"
              size="small"
              icon={<ThunderboltOutlined />}
              loading={enrichNowMutation.isPending && enrichingId === record.id}
              onClick={() => handleEnrichNow(record)}
            >
              AI补全
            </Button>
          </Tooltip>
          <Popconfirm title="确认删除？" onConfirm={() => deleteMutation.mutate(record.id)}>
            <Button type="link" size="small" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <>
      {stats && (
        <>
          {/* 第一行：基础数量卡片 */}
          <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
            <Col span={4}>
              <Card size="small">
                <Statistic title="食物总数" value={stats.total} />
              </Card>
            </Col>
            <Col span={4}>
              <Card size="small">
                <Statistic
                  title="已验证"
                  value={stats.verified}
                  valueStyle={{ color: '#3f8600' }}
                />
              </Card>
            </Col>
            <Col span={4}>
              <Card size="small">
                <Statistic
                  title="未验证"
                  value={stats.unverified}
                  valueStyle={stats.unverified > 0 ? { color: '#cf1322' } : undefined}
                />
              </Card>
            </Col>
            <Col span={4}>
              <Card size="small">
                <Statistic title="分类数" value={stats.byCategory?.length || 0} />
              </Card>
            </Col>
            <Col span={4}>
              <Card size="small">
                <Statistic title="数据来源" value={stats.bySource?.length || 0} />
              </Card>
            </Col>
            <Col span={4}>
              <Card size="small">
                <Statistic
                  title="待处理冲突"
                  value={stats.pendingConflicts || 0}
                  valueStyle={stats.pendingConflicts ? { color: '#cf1322' } : undefined}
                />
              </Card>
            </Col>
          </Row>

          {/* 第二行：补全状态 + 完整度分布 + 审核状态 */}
          <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
            {/* 补全状态分布 */}
            {stats.enrichmentStatus && (
              <Col span={10}>
                <Card size="small" title="AI 补全状态">
                  <Row gutter={[8, 8]}>
                    {[
                      { key: 'completed', label: '已完成', color: '#52c41a' },
                      { key: 'partial', label: '部分补全', color: '#1677ff' },
                      { key: 'pending', label: '待补全', color: '#8c8c8c' },
                      { key: 'failed', label: '失败', color: '#ff4d4f' },
                      { key: 'staged', label: '待审核', color: '#fa8c16' },
                      { key: 'rejected', label: '已拒绝', color: '#cf1322' },
                    ].map(({ key, label, color }) => {
                      const val =
                        stats.enrichmentStatus[key as keyof typeof stats.enrichmentStatus] ?? 0;
                      const pct = stats.total > 0 ? Math.round((val / stats.total) * 100) : 0;
                      return (
                        <Col span={8} key={key}>
                          <div style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: 20, fontWeight: 600, color }}>{val}</div>
                            <div style={{ fontSize: 11, color: '#8c8c8c' }}>{label}</div>
                            <Progress
                              percent={pct}
                              size="small"
                              showInfo={false}
                              strokeColor={color}
                              style={{ marginTop: 2 }}
                            />
                          </div>
                        </Col>
                      );
                    })}
                  </Row>
                </Card>
              </Col>
            )}

            {/* 完整度分布 */}
            {stats.completenessDistribution && (
              <Col span={7}>
                <Card
                  size="small"
                  title={
                    <span>
                      数据完整度
                      {stats.avgCompleteness != null && (
                        <span
                          style={{ marginLeft: 8, fontSize: 12, color: '#1677ff', fontWeight: 400 }}
                        >
                          均值 {stats.avgCompleteness}%
                        </span>
                      )}
                    </span>
                  }
                >
                  {[
                    { key: 'high', label: '高质量 ≥80%', color: '#52c41a' },
                    { key: 'mid', label: '中等 30-79%', color: '#fa8c16' },
                    { key: 'low', label: '低质量 <30%', color: '#ff4d4f' },
                  ].map(({ key, label, color }) => {
                    const val =
                      stats.completenessDistribution[
                        key as keyof typeof stats.completenessDistribution
                      ] ?? 0;
                    const pct = stats.total > 0 ? Math.round((val / stats.total) * 100) : 0;
                    return (
                      <div key={key} style={{ marginBottom: 6 }}>
                        <div
                          style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}
                        >
                          <span style={{ color: '#595959' }}>{label}</span>
                          <span style={{ color, fontWeight: 600 }}>
                            {val}{' '}
                            <span style={{ color: '#8c8c8c', fontWeight: 400 }}>({pct}%)</span>
                          </span>
                        </div>
                        <Progress percent={pct} size="small" showInfo={false} strokeColor={color} />
                      </div>
                    );
                  })}
                </Card>
              </Col>
            )}

            {/* 审核状态分布 */}
            {stats.reviewStatusCounts && (
              <Col span={7}>
                <Card size="small" title="审核状态">
                  {[
                    { key: 'pending', label: '待审核', color: '#fa8c16' },
                    { key: 'approved', label: '已通过', color: '#52c41a' },
                    { key: 'rejected', label: '已拒绝', color: '#ff4d4f' },
                  ].map(({ key, label, color }) => {
                    const val =
                      stats.reviewStatusCounts[key as keyof typeof stats.reviewStatusCounts] ?? 0;
                    const pct = stats.total > 0 ? Math.round((val / stats.total) * 100) : 0;
                    return (
                      <div key={key} style={{ marginBottom: 6 }}>
                        <div
                          style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}
                        >
                          <span style={{ color: '#595959' }}>{label}</span>
                          <span style={{ color, fontWeight: 600 }}>
                            {val}{' '}
                            <span style={{ color: '#8c8c8c', fontWeight: 400 }}>({pct}%)</span>
                          </span>
                        </div>
                        <Progress percent={pct} size="small" showInfo={false} strokeColor={color} />
                      </div>
                    );
                  })}
                </Card>
              </Col>
            )}
          </Row>
        </>
      )}

      <ProTable<FoodLibraryDto>
        columns={columns}
        actionRef={actionRef}
        request={async (params) => {
          const { current, pageSize, isVerified, enrichmentStatus, ...rest } = params;
          const res = await foodLibraryApi.getList({
            page: current,
            pageSize,
            // isVerified 从 ProTable 传来是字符串 "true"/"false"，需转为布尔
            ...(isVerified !== undefined && isVerified !== ''
              ? { isVerified: isVerified === 'true' || isVerified === true }
              : {}),
            ...(enrichmentStatus ? { enrichmentStatus } : {}),
            ...rest,
          });
          return { data: res.list, total: res.total, success: true };
        }}
        rowKey="id"
        scroll={{ x: 1900 }}
        search={{ labelWidth: 'auto', defaultCollapsed: false }}
        pagination={{ defaultPageSize: 20, showSizeChanger: true }}
        headerTitle="全球化食物库"
        toolBarRender={() => [
          <Button
            key="add"
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => navigate('/food-library/create')}
          >
            新增食物
          </Button>,
          <Button
            key="enrichment"
            icon={<ThunderboltOutlined />}
            onClick={() => navigate('/food-library/enrichment')}
          >
            AI补全
          </Button>,
          <Button
            key="conflicts"
            icon={<ExportOutlined />}
            onClick={() => navigate('/food-library/conflicts')}
          >
            冲突管理
          </Button>,
          <Button
            key="reload"
            icon={<ReloadOutlined />}
            onClick={() => actionRef.current?.reload()}
          >
            刷新
          </Button>,
        ]}
      />

      {/* AI 补全结果弹窗 */}
      <Modal
        title={
          <Space>
            <ThunderboltOutlined style={{ color: '#faad14' }} />
            AI补全结果 — {enrichModal.foodName}
          </Space>
        }
        open={enrichModal.open}
        footer={
          <Button type="primary" onClick={() => setEnrichModal((s) => ({ ...s, open: false }))}>
            关闭
          </Button>
        }
        onCancel={() => setEnrichModal((s) => ({ ...s, open: false }))}
        width={600}
      >
        {enrichModal.result && (
          <>
            {enrichModal.result.totalEnriched === 0 && enrichModal.result.totalFailed === 0 ? (
              <Alert message="所有字段已有值，无需补全" type="info" showIcon />
            ) : (
              <>
                <Descriptions size="small" column={3} style={{ marginBottom: 16 }}>
                  <Descriptions.Item label="补全字段">
                    <Typography.Text type="success">
                      <CheckOutlined /> {enrichModal.result.totalEnriched}
                    </Typography.Text>
                  </Descriptions.Item>
                  <Descriptions.Item label="失败字段">
                    <Typography.Text
                      type={enrichModal.result.totalFailed > 0 ? 'danger' : 'secondary'}
                    >
                      <CloseOutlined /> {enrichModal.result.totalFailed}
                    </Typography.Text>
                  </Descriptions.Item>
                  {enrichModal.result.completeness?.score != null && (
                    <Descriptions.Item label="完整度">
                      {enrichModal.result.completeness.score}%
                    </Descriptions.Item>
                  )}
                </Descriptions>
                {enrichModal.result.stageResults?.map((stage) => (
                  <Card
                    key={stage.stage}
                    size="small"
                    title={`阶段 ${stage.stage}：${stage.stageName}`}
                    style={{ marginBottom: 8 }}
                  >
                    {stage.enrichedFields.length > 0 && (
                      <div style={{ marginBottom: 4 }}>
                        <Typography.Text type="success" style={{ fontSize: 12 }}>
                          已补全：
                        </Typography.Text>
                        <Space wrap size={[4, 4]}>
                          {stage.enrichedFields.map((f) => (
                            <Tag key={f} color="success" style={{ fontSize: 11 }}>
                              {f}
                            </Tag>
                          ))}
                        </Space>
                      </div>
                    )}
                    {stage.failedFields.length > 0 && (
                      <div>
                        <Typography.Text type="danger" style={{ fontSize: 12 }}>
                          失败：
                        </Typography.Text>
                        <Space wrap size={[4, 4]}>
                          {stage.failedFields.map((f) => (
                            <Tag key={f} color="error" style={{ fontSize: 11 }}>
                              {f}
                            </Tag>
                          ))}
                        </Space>
                      </div>
                    )}
                    {stage.enrichedFields.length === 0 && stage.failedFields.length === 0 && (
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        该阶段无需处理
                      </Typography.Text>
                    )}
                  </Card>
                ))}
              </>
            )}
          </>
        )}
      </Modal>
    </>
  );
};

export default FoodLibraryList;
