import React, { useRef, useState } from 'react';
import {
  Card,
  Tag,
  Button,
  Modal,
  Descriptions,
  Row,
  Col,
  Statistic,
} from 'antd';
import {
  EyeOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { ProTable } from '@ant-design/pro-components';
import {
  contentApi,
  type DailyPlanDto,
} from '@/services/contentManagementService';

export const routeConfig = {
  name: 'daily-plans',
  title: '每日计划',
  icon: 'CalendarOutlined',
  order: 22,
  requireAuth: true,
};

const DailyPlansPage: React.FC = () => {
  const actionRef = useRef<ActionType>(null);
  const [detailVisible, setDetailVisible] = useState(false);
  const [currentPlan, setCurrentPlan] = useState<DailyPlanDto | null>(null);

  const handleViewDetail = async (id: string) => {
    const data = await contentApi.getDailyPlanDetail(id);
    setCurrentPlan(data);
    setDetailVisible(true);
  };

  const renderMealPlan = (plan: any, title: string) => {
    if (!plan) return null;
    return (
      <Card size="small" title={title} style={{ marginBottom: 8 }}>
        <p><strong>食物：</strong>{plan.foods}</p>
        <Row gutter={16}>
          <Col span={6}><Statistic title="热量" value={plan.calories} suffix="kcal" /></Col>
          <Col span={6}><Statistic title="蛋白质" value={plan.protein} suffix="g" /></Col>
          <Col span={6}><Statistic title="脂肪" value={plan.fat} suffix="g" /></Col>
          <Col span={6}><Statistic title="碳水" value={plan.carbs} suffix="g" /></Col>
        </Row>
        {plan.tip && <p style={{ marginTop: 8, color: '#888' }}>{plan.tip}</p>}
      </Card>
    );
  };

  const columns: ProColumns<DailyPlanDto>[] = [
    { title: '用户ID', dataIndex: 'userId', width: 120, render: (v) => (v as string)?.slice(0, 8) + '...' },
    { title: '日期', dataIndex: 'date', width: 120, valueType: 'date' },
    { title: '总预算', dataIndex: 'totalBudget', width: 100, search: false, render: (v) => v ? `${v} kcal` : '-' },
    { title: '策略', dataIndex: 'strategy', width: 200, search: false, ellipsis: true },
    { title: '调整次数', dataIndex: 'adjustments', width: 80, search: false, render: (_, r) => r.adjustments?.length || 0 },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      width: 160,
      valueType: 'dateTime',
      search: false,
    },
    {
      title: '操作',
      width: 80,
      search: false,
      render: (_, record) => (
        <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => handleViewDetail(record.id)}>
          查看
        </Button>
      ),
    },
  ];

  return (
    <>
      <ProTable<DailyPlanDto>
        columns={columns}
        actionRef={actionRef}
        request={async (params) => {
          const { current, pageSize, ...rest } = params;
          const res = await contentApi.getDailyPlans({ page: current, pageSize, ...rest });
          return { data: res.list, total: res.total, success: true };
        }}
        rowKey="id"
        scroll={{ x: 900 }}
        search={{ labelWidth: 'auto' }}
        pagination={{ defaultPageSize: 20, showSizeChanger: true }}
        headerTitle="每日计划列表"
        toolBarRender={() => [
          <Button key="reload" icon={<ReloadOutlined />} onClick={() => actionRef.current?.reload()}>刷新</Button>,
        ]}
      />

      <Modal
        title="计划详情"
        open={detailVisible}
        onCancel={() => setDetailVisible(false)}
        footer={null}
        width={800}
      >
        {currentPlan && (
          <>
            <Descriptions bordered size="small" column={2} style={{ marginBottom: 16 }}>
              <Descriptions.Item label="日期">{currentPlan.date}</Descriptions.Item>
              <Descriptions.Item label="总预算">{currentPlan.totalBudget} kcal</Descriptions.Item>
              <Descriptions.Item label="策略" span={2}>{currentPlan.strategy}</Descriptions.Item>
            </Descriptions>
            {renderMealPlan(currentPlan.morningPlan, '🌅 早餐')}
            {renderMealPlan(currentPlan.lunchPlan, '☀️ 午餐')}
            {renderMealPlan(currentPlan.dinnerPlan, '🌙 晚餐')}
            {renderMealPlan(currentPlan.snackPlan, '🍎 加餐')}
          </>
        )}
      </Modal>
    </>
  );
};

export default DailyPlansPage;
