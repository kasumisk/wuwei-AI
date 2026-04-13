import React from 'react';
import {
  Card,
  Descriptions,
  Tag,
  Spin,
  Typography,
  Button,
  Space,
  Tabs,
  Progress,
  Empty,
} from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { useParams, useNavigate } from 'react-router-dom';
import { useAnalysisRecordDetail } from '@/services/analysisRecordService';
import type { ReviewStatus, AnalysisInputType } from '@/services/analysisRecordService';

// ==================== 常量 ====================

const inputTypeLabel: Record<AnalysisInputType, string> = { text: '文本', image: '图片' };
const reviewStatusConfig: Record<ReviewStatus, { color: string; text: string }> = {
  pending: { color: 'default', text: '待审核' },
  approved: { color: 'success', text: '已通过' },
  rejected: { color: 'error', text: '已拒绝' },
};

// ==================== JSON 渲染 ====================

const JsonBlock: React.FC<{ data: unknown; title?: string }> = ({ data, title }) => {
  if (!data || (typeof data === 'object' && Object.keys(data as object).length === 0)) {
    return <Empty description={`暂无${title || ''}数据`} image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  }
  return (
    <pre
      style={{
        background: '#f5f5f5',
        padding: 16,
        borderRadius: 8,
        fontSize: 12,
        maxHeight: 400,
        overflow: 'auto',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-all',
      }}
    >
      {JSON.stringify(data, null, 2)}
    </pre>
  );
};

// ==================== 主组件 ====================

const AnalysisRecordDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data: record, isLoading } = useAnalysisRecordDetail(id!, !!id);

  if (isLoading) {
    return (
      <div style={{ textAlign: 'center', padding: 80 }}>
        <Spin size="large" />
      </div>
    );
  }

  if (!record) {
    return (
      <Card>
        <Typography.Text type="danger">未找到分析记录</Typography.Text>
        <br />
        <Button onClick={() => navigate('/analysis-records/list')} style={{ marginTop: 16 }}>
          返回列表
        </Button>
      </Card>
    );
  }

  const confidencePercent = Math.round(Number(record.confidenceScore) * 100);
  const confidenceColor =
    confidencePercent >= 80 ? '#52c41a' : confidencePercent >= 60 ? '#faad14' : '#ff4d4f';
  const rCfg = reviewStatusConfig[record.reviewStatus];

  return (
    <div>
      {/* 头部 */}
      <Card style={{ marginBottom: 16 }}>
        <Space>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/analysis-records/list')}>
            返回列表
          </Button>
          <Typography.Title level={4} style={{ margin: 0 }}>
            分析记录详情
          </Typography.Title>
        </Space>
      </Card>

      {/* 基本信息 */}
      <Card style={{ marginBottom: 16 }}>
        <Descriptions title="基本信息" bordered column={2}>
          <Descriptions.Item label="记录ID">{record.id}</Descriptions.Item>
          <Descriptions.Item label="用户">
            {record.user?.nickname || '匿名'} ({record.userId.slice(0, 8)}...)
          </Descriptions.Item>
          <Descriptions.Item label="输入类型">
            <Tag color={record.inputType === 'text' ? 'blue' : 'green'}>
              {inputTypeLabel[record.inputType]}
            </Tag>
          </Descriptions.Item>
          <Descriptions.Item label="置信度">
            <Space>
              <Progress
                type="circle"
                size={40}
                percent={confidencePercent}
                strokeColor={confidenceColor}
              />
              <span>{confidencePercent}%</span>
            </Space>
          </Descriptions.Item>
          <Descriptions.Item label="审核状态">
            <Tag color={rCfg.color}>{rCfg.text}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="创建时间">
            {new Date(record.createdAt).toLocaleString('zh-CN')}
          </Descriptions.Item>
          {record.reviewedBy && (
            <Descriptions.Item label="审核人">{record.reviewedBy}</Descriptions.Item>
          )}
          {record.reviewedAt && (
            <Descriptions.Item label="审核时间">
              {new Date(record.reviewedAt).toLocaleString('zh-CN')}
            </Descriptions.Item>
          )}
          {record.reviewNote && (
            <Descriptions.Item label="审核备注" span={2}>
              {record.reviewNote}
            </Descriptions.Item>
          )}
        </Descriptions>
      </Card>

      {/* 详细数据（Tabs） */}
      <Card>
        <Tabs
          defaultActiveKey="recognized"
          items={[
            {
              key: 'recognized',
              label: '食物识别结果',
              children: <JsonBlock data={record.recognizedPayload} title="识别结果" />,
            },
            {
              key: 'normalized',
              label: '标准化数据',
              children: <JsonBlock data={record.normalizedPayload} title="标准化数据" />,
            },
            {
              key: 'nutrition',
              label: '营养分析',
              children: <JsonBlock data={record.nutritionPayload} title="营养分析" />,
            },
            {
              key: 'decision',
              label: '决策数据',
              children: <JsonBlock data={record.decisionPayload} title="决策数据" />,
            },
          ]}
        />
      </Card>
    </div>
  );
};

export default AnalysisRecordDetail;

export const routeConfig = {
  name: 'analysis-record-detail',
  title: '分析记录详情',
  icon: 'EyeOutlined',
  order: 2,
  requireAuth: true,
  hideInMenu: true,
};
