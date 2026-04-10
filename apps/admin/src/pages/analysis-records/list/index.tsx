import React, { useRef, useState } from 'react';
import {
  Card,
  Button,
  Tag,
  Space,
  Row,
  Col,
  Statistic,
  message,
  Modal,
  Input,
  Radio,
  Tooltip,
  Avatar,
  Progress,
} from 'antd';
import {
  ReloadOutlined,
  EyeOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  BarChartOutlined,
  FileTextOutlined,
  PictureOutlined,
  UserOutlined,
} from '@ant-design/icons';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { ProTable } from '@ant-design/pro-components';
import { useNavigate } from 'react-router-dom';
import {
  analysisRecordApi,
  useAnalysisStatistics,
  useReviewAnalysisRecord,
  type AnalysisRecordDto,
  type ReviewStatus,
  type AnalysisInputType,
} from '@/services/analysisRecordService';

// ==================== 常量配置 ====================

const inputTypeConfig: Record<
  AnalysisInputType,
  { color: string; icon: React.ReactNode; text: string }
> = {
  text: { color: 'blue', icon: <FileTextOutlined />, text: '文本' },
  image: { color: 'green', icon: <PictureOutlined />, text: '图片' },
};

const reviewStatusConfig: Record<ReviewStatus, { color: string; text: string }> = {
  pending: { color: 'default', text: '待审核' },
  approved: { color: 'success', text: '已通过' },
  rejected: { color: 'error', text: '已拒绝' },
};

// ==================== 主组件 ====================

const AnalysisRecordList: React.FC = () => {
  const navigate = useNavigate();
  const actionRef = useRef<ActionType>(null);
  const [statsVisible, setStatsVisible] = useState(false);
  const [reviewModalVisible, setReviewModalVisible] = useState(false);
  const [reviewingRecord, setReviewingRecord] = useState<AnalysisRecordDto | null>(null);
  const [reviewStatus, setReviewStatus] = useState<ReviewStatus>('approved');
  const [reviewNote, setReviewNote] = useState('');

  const { data: stats } = useAnalysisStatistics({ enabled: statsVisible });

  const reviewMutation = useReviewAnalysisRecord({
    onSuccess: () => {
      message.success('审核成功');
      setReviewModalVisible(false);
      setReviewingRecord(null);
      setReviewNote('');
      actionRef.current?.reload();
    },
    onError: (error: any) => message.error(`审核失败: ${error.message}`),
  });

  // ==================== 事件处理 ====================

  const handleReview = (record: AnalysisRecordDto) => {
    setReviewingRecord(record);
    setReviewStatus('approved');
    setReviewNote('');
    setReviewModalVisible(true);
  };

  const handleReviewSubmit = () => {
    if (!reviewingRecord) return;
    reviewMutation.mutate({
      id: reviewingRecord.id,
      data: { reviewStatus, reviewNote: reviewNote || undefined },
    });
  };

  // ==================== 表格列定义 ====================

  const columns: ProColumns<AnalysisRecordDto>[] = [
    {
      title: '用户',
      dataIndex: 'userId',
      width: 180,
      render: (_: unknown, record: AnalysisRecordDto) => (
        <Space>
          <Avatar size={28} src={record.user?.avatar} icon={<UserOutlined />} />
          <div>
            <div style={{ fontWeight: 500, lineHeight: 1.4, fontSize: 13 }}>
              {record.user?.nickname || <span style={{ color: '#bbb' }}>匿名</span>}
            </div>
            <div style={{ fontSize: 11, color: '#999' }}>
              <Tooltip title={record.userId}>{record.userId.slice(0, 8)}...</Tooltip>
            </div>
          </div>
        </Space>
      ),
    },
    {
      title: '输入类型',
      dataIndex: 'inputType',
      width: 100,
      valueType: 'select',
      valueEnum: {
        text: { text: '文本' },
        image: { text: '图片' },
      },
      render: (_: unknown, record: AnalysisRecordDto) => {
        const cfg = inputTypeConfig[record.inputType];
        return (
          <Tag color={cfg.color} icon={cfg.icon}>
            {cfg.text}
          </Tag>
        );
      },
    },
    {
      title: '置信度',
      dataIndex: 'confidenceScore',
      width: 140,
      search: false,
      sorter: true,
      render: (_: unknown, record: AnalysisRecordDto) => {
        const score = Number(record.confidenceScore) * 100;
        const color = score >= 80 ? '#52c41a' : score >= 60 ? '#faad14' : '#ff4d4f';
        return (
          <Space>
            <Progress
              type="circle"
              size={32}
              percent={Math.round(score)}
              strokeColor={color}
              format={(p) => `${p}`}
            />
            <span style={{ fontSize: 12, color: '#666' }}>{score.toFixed(1)}%</span>
          </Space>
        );
      },
    },
    {
      title: '审核状态',
      dataIndex: 'reviewStatus',
      width: 100,
      valueType: 'select',
      valueEnum: {
        pending: { text: '待审核', status: 'Default' },
        approved: { text: '已通过', status: 'Success' },
        rejected: { text: '已拒绝', status: 'Error' },
      },
      render: (_: unknown, record: AnalysisRecordDto) => {
        const cfg = reviewStatusConfig[record.reviewStatus];
        return <Tag color={cfg.color}>{cfg.text}</Tag>;
      },
    },
    {
      title: '分析时间',
      dataIndex: 'createdAt',
      width: 170,
      valueType: 'dateTime',
      search: false,
      sorter: true,
    },
    {
      title: '操作',
      key: 'actions',
      fixed: 'right',
      width: 180,
      search: false,
      render: (_: unknown, record: AnalysisRecordDto) => (
        <Space size="small">
          <Button
            type="link"
            size="small"
            icon={<EyeOutlined />}
            onClick={() => navigate(`/analysis-records/detail/${record.id}`)}
          >
            详情
          </Button>
          {record.reviewStatus === 'pending' && (
            <Button
              type="link"
              size="small"
              icon={<CheckCircleOutlined />}
              style={{ color: '#52c41a' }}
              onClick={() => handleReview(record)}
            >
              审核
            </Button>
          )}
        </Space>
      ),
    },
  ];

  // ==================== 渲染 ====================

  return (
    <Card>
      <ProTable<AnalysisRecordDto>
        actionRef={actionRef}
        rowKey="id"
        headerTitle="AI 分析记录"
        columns={columns}
        scroll={{ x: 1000 }}
        request={async (params, sort) => {
          try {
            const { list, total } = await analysisRecordApi.getRecords({
              page: params.current,
              pageSize: params.pageSize,
              inputType: params.inputType || undefined,
              reviewStatus: params.reviewStatus || undefined,
              userId: params.userId || undefined,
            });
            return { data: list || [], total: total || 0, success: true };
          } catch {
            return { data: [], total: 0, success: false };
          }
        }}
        toolBarRender={() => [
          <Button key="stats" icon={<BarChartOutlined />} onClick={() => setStatsVisible(true)}>
            统计
          </Button>,
          <Button
            key="refresh"
            icon={<ReloadOutlined />}
            onClick={() => actionRef.current?.reload()}
          >
            刷新
          </Button>,
        ]}
        pagination={{
          defaultPageSize: 20,
          showSizeChanger: true,
          showTotal: (total: number) => `共 ${total} 条记录`,
        }}
        search={{ labelWidth: 'auto' }}
      />

      {/* 审核弹窗 */}
      <Modal
        title="审核分析记录"
        open={reviewModalVisible}
        onOk={handleReviewSubmit}
        confirmLoading={reviewMutation.isPending}
        onCancel={() => {
          setReviewModalVisible(false);
          setReviewingRecord(null);
          setReviewNote('');
        }}
        width={480}
      >
        <div style={{ marginBottom: 16 }}>
          <div style={{ marginBottom: 8, fontWeight: 500 }}>审核结果</div>
          <Radio.Group value={reviewStatus} onChange={(e) => setReviewStatus(e.target.value)}>
            <Radio.Button value="approved">
              <CheckCircleOutlined style={{ color: '#52c41a' }} /> 通过
            </Radio.Button>
            <Radio.Button value="rejected">
              <CloseCircleOutlined style={{ color: '#ff4d4f' }} /> 拒绝
            </Radio.Button>
          </Radio.Group>
        </div>
        <div>
          <div style={{ marginBottom: 8, fontWeight: 500 }}>审核备注</div>
          <Input.TextArea
            value={reviewNote}
            onChange={(e) => setReviewNote(e.target.value)}
            placeholder="请输入审核备注（可选）"
            rows={3}
          />
        </div>
      </Modal>

      {/* 统计弹窗 */}
      <Modal
        title="分析记录统计"
        open={statsVisible}
        onCancel={() => setStatsVisible(false)}
        footer={null}
        width={560}
      >
        {stats && (
          <>
            <Row gutter={[16, 16]}>
              <Col span={8}>
                <Statistic title="总记录数" value={stats.total} />
              </Col>
              <Col span={8}>
                <Statistic
                  title="今日新增"
                  value={stats.todayCount}
                  valueStyle={{ color: '#1677ff' }}
                />
              </Col>
              <Col span={8}>
                <Statistic
                  title="平均置信度"
                  value={(stats.avgConfidence * 100).toFixed(1)}
                  suffix="%"
                  valueStyle={{ color: stats.avgConfidence >= 0.8 ? '#52c41a' : '#faad14' }}
                />
              </Col>
            </Row>
            <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
              <Col span={12}>
                <Card size="small" title="输入类型分布">
                  <Statistic title="文本识别" value={stats.byInputType.text} />
                  <Statistic
                    title="图片识别"
                    value={stats.byInputType.image}
                    style={{ marginTop: 8 }}
                  />
                </Card>
              </Col>
              <Col span={12}>
                <Card size="small" title="审核状态分布">
                  <Statistic title="待审核" value={stats.byReviewStatus.pending} />
                  <Statistic
                    title="已通过"
                    value={stats.byReviewStatus.approved}
                    valueStyle={{ color: '#52c41a' }}
                    style={{ marginTop: 8 }}
                  />
                  <Statistic
                    title="已拒绝"
                    value={stats.byReviewStatus.rejected}
                    valueStyle={{ color: '#ff4d4f' }}
                    style={{ marginTop: 8 }}
                  />
                </Card>
              </Col>
            </Row>
          </>
        )}
      </Modal>
    </Card>
  );
};

export default AnalysisRecordList;

export const routeConfig = {
  name: 'analysis-records-list',
  title: '分析记录列表',
  icon: 'UnorderedListOutlined',
  order: 1,
  requireAuth: true,
  requireAdmin: true,
};
