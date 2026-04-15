import React, { useRef } from 'react';
import { Card, Tag, Button, Row, Col, Statistic } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { ProTable } from '@ant-design/pro-components';
import { useQuery } from '@tanstack/react-query';
import {
  contentApi,
  contentQueryKeys,
  type RecommendationFeedbackDto,
} from '@/services/contentManagementService';

export const routeConfig = {
  name: 'recommendation-feedback',
  title: '推荐反馈',
  icon: 'LikeOutlined',
  order: 4,
  requireAuth: true,
};

const actionMap: Record<string, { text: string; color: string }> = {
  accepted: { text: '接受', color: 'success' },
  replaced: { text: '替换', color: 'warning' },
  skipped: { text: '跳过', color: 'default' },
};

const mealTypeMap: Record<string, string> = {
  breakfast: '早餐',
  lunch: '午餐',
  dinner: '晚餐',
  snack: '加餐',
};

const RecommendationFeedbackPage: React.FC = () => {
  const actionRef = useRef<ActionType>(null);

  const { data: stats } = useQuery({
    queryKey: contentQueryKeys.feedback.statistics,
    queryFn: () => contentApi.getFeedbackStatistics(),
    staleTime: 5 * 60 * 1000,
  });

  const columns: ProColumns<RecommendationFeedbackDto>[] = [
    {
      title: '用户ID',
      dataIndex: 'userId',
      width: 120,
      render: (v) => (v as string)?.slice(0, 8) + '...',
    },
    {
      title: '餐次',
      dataIndex: 'mealType',
      width: 80,
      valueEnum: Object.fromEntries(Object.entries(mealTypeMap).map(([k, v]) => [k, { text: v }])),
      render: (_, r) => mealTypeMap[r.mealType] || r.mealType,
    },
    { title: '推荐食物', dataIndex: 'foodName', width: 120 },
    {
      title: '操作',
      dataIndex: 'action',
      width: 80,
      valueEnum: Object.fromEntries(
        Object.entries(actionMap).map(([k, v]) => [k, { text: v.text }])
      ),
      render: (_, r) => {
        const a = actionMap[r.action];
        return a ? <Tag color={a.color}>{a.text}</Tag> : r.action;
      },
    },
    {
      title: '替换食物',
      dataIndex: 'replacementFood',
      width: 120,
      search: false,
      render: (v) => v || '-',
    },
    {
      title: '推荐分数',
      dataIndex: 'recommendationScore',
      width: 80,
      search: false,
      render: (v) => (v ? Number(v).toFixed(2) : '-'),
    },
    { title: '目标类型', dataIndex: 'goalType', width: 80, search: false },
    { title: '时间', dataIndex: 'createdAt', width: 160, valueType: 'dateTime', search: false },
  ];

  return (
    <>
      {stats && (
        <Row gutter={16} style={{ marginBottom: 16 }}>
          <Col span={6}>
            <Card>
              <Statistic title="总反馈数" value={stats.total} />
            </Card>
          </Col>
          <Col span={6}>
            <Card>
              <Statistic
                title="接受率"
                value={stats.acceptRate}
                suffix="%"
                valueStyle={{ color: '#3f8600' }}
              />
            </Card>
          </Col>
          {stats.byAction?.map((a: any) => (
            <Col span={6} key={a.action}>
              <Card>
                <Statistic title={actionMap[a.action]?.text || a.action} value={a.count} />
              </Card>
            </Col>
          ))}
        </Row>
      )}

      <ProTable<RecommendationFeedbackDto>
        columns={columns}
        actionRef={actionRef}
        request={async (params) => {
          const { current, pageSize, ...rest } = params;
          const res = await contentApi.getRecommendationFeedback({
            page: current,
            pageSize,
            ...rest,
          });
          return { data: res.list, total: res.total, success: true };
        }}
        rowKey="id"
        scroll={{ x: 900 }}
        search={{ labelWidth: 'auto' }}
        pagination={{ defaultPageSize: 20, showSizeChanger: true }}
        headerTitle="推荐反馈列表"
        toolBarRender={() => [
          <Button
            key="reload"
            icon={<ReloadOutlined />}
            onClick={() => actionRef.current?.reload()}
          >
            刷新
          </Button>,
        ]}
      />
    </>
  );
};

export default RecommendationFeedbackPage;
