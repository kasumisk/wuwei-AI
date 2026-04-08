import React, { useRef } from 'react';
import {
  Card,
  Tag,
  Space,
  Row,
  Col,
  Statistic,
  Popconfirm,
  message,
  Button,
  Image,
} from 'antd';
import {
  DeleteOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { ProTable } from '@ant-design/pro-components';
import { useQuery } from '@tanstack/react-query';
import {
  contentApi,
  contentQueryKeys,
  useDeleteFoodRecord,
  type FoodRecordDto,
} from '@/services/contentManagementService';

export const routeConfig = {
  name: 'food-records',
  title: '饮食记录',
  icon: 'ProfileOutlined',
  order: 21,
  requireAuth: true,
};

const mealTypeMap: Record<string, { text: string; color: string }> = {
  breakfast: { text: '早餐', color: 'orange' },
  lunch: { text: '午餐', color: 'green' },
  dinner: { text: '晚餐', color: 'blue' },
  snack: { text: '加餐', color: 'purple' },
};

const decisionMap: Record<string, { text: string; color: string }> = {
  SAFE: { text: 'SAFE', color: 'success' },
  OK: { text: 'OK', color: 'processing' },
  LIMIT: { text: 'LIMIT', color: 'warning' },
  AVOID: { text: 'AVOID', color: 'error' },
};

const FoodRecordsPage: React.FC = () => {
  const actionRef = useRef<ActionType>(null);
  const deleteMutation = useDeleteFoodRecord({
    onSuccess: () => { message.success('已删除'); actionRef.current?.reload(); },
    onError: (e: any) => message.error(`删除失败: ${e.message}`),
  });

  const { data: stats } = useQuery({
    queryKey: contentQueryKeys.foodRecords.statistics,
    queryFn: () => contentApi.getFoodRecordStatistics(),
    staleTime: 5 * 60 * 1000,
  });

  const columns: ProColumns<FoodRecordDto>[] = [
    {
      title: '用户',
      dataIndex: 'userId',
      width: 120,
      render: (_, record) => record.user?.nickname || record.user?.email || record.userId?.slice(0, 8),
    },
    {
      title: '餐次',
      dataIndex: 'mealType',
      width: 80,
      valueEnum: Object.fromEntries(
        Object.entries(mealTypeMap).map(([k, v]) => [k, { text: v.text }]),
      ),
      render: (_, record) => {
        const m = mealTypeMap[record.mealType];
        return m ? <Tag color={m.color}>{m.text}</Tag> : record.mealType;
      },
    },
    {
      title: '食物',
      dataIndex: 'foods',
      width: 200,
      search: false,
      render: (_, record) => (
        <Space wrap size={[0, 4]}>
          {record.foods?.slice(0, 3).map((f, i) => (
            <Tag key={i}>{f.name} ({f.calories}kcal)</Tag>
          ))}
          {record.foods?.length > 3 && <Tag>+{record.foods.length - 3}</Tag>}
        </Space>
      ),
    },
    { title: '总热量', dataIndex: 'totalCalories', width: 90, search: false, render: (v) => `${v} kcal` },
    {
      title: '决策',
      dataIndex: 'decision',
      width: 80,
      valueEnum: Object.fromEntries(Object.entries(decisionMap).map(([k, v]) => [k, { text: v.text }])),
      render: (_, record) => {
        const d = decisionMap[record.decision];
        return d ? <Tag color={d.color}>{d.text}</Tag> : record.decision;
      },
    },
    { title: '营养评分', dataIndex: 'nutritionScore', width: 80, search: false },
    { title: '来源', dataIndex: 'source', width: 80, render: (v) => <Tag>{v as string}</Tag> },
    {
      title: '图片',
      dataIndex: 'imageUrl',
      width: 80,
      search: false,
      render: (_, record) => record.imageUrl
        ? <Image src={record.imageUrl} width={40} height={40} style={{ objectFit: 'cover', borderRadius: 4 }} />
        : '-',
    },
    {
      title: '记录时间',
      dataIndex: 'recordedAt',
      width: 160,
      valueType: 'dateTime',
      search: false,
    },
    {
      title: '操作',
      width: 80,
      search: false,
      render: (_, record) => (
        <Popconfirm title="确认删除？" onConfirm={() => deleteMutation.mutate(record.id)}>
          <Button type="link" size="small" danger icon={<DeleteOutlined />}>删除</Button>
        </Popconfirm>
      ),
    },
  ];

  return (
    <>
      {stats && (
        <Row gutter={16} style={{ marginBottom: 16 }}>
          <Col span={8}><Card><Statistic title="总记录数" value={stats.total} /></Card></Col>
          <Col span={8}><Card><Statistic title="今日记录" value={stats.todayCount} valueStyle={{ color: '#3f8600' }} /></Card></Col>
          <Col span={8}>
            <Card>
              <Space wrap>
                {stats.byMealType?.map((m: any) => (
                  <Statistic key={m.mealType} title={mealTypeMap[m.mealType]?.text || m.mealType} value={m.count} />
                ))}
              </Space>
            </Card>
          </Col>
        </Row>
      )}

      <ProTable<FoodRecordDto>
        columns={columns}
        actionRef={actionRef}
        request={async (params) => {
          const { current, pageSize, ...rest } = params;
          const res = await contentApi.getFoodRecords({ page: current, pageSize, ...rest });
          return { data: res.list, total: res.total, success: true };
        }}
        rowKey="id"
        scroll={{ x: 1200 }}
        search={{ labelWidth: 'auto' }}
        pagination={{ defaultPageSize: 20, showSizeChanger: true }}
        headerTitle="饮食记录列表"
        toolBarRender={() => [
          <Button key="reload" icon={<ReloadOutlined />} onClick={() => actionRef.current?.reload()}>刷新</Button>,
        ]}
      />
    </>
  );
};

export default FoodRecordsPage;
