import React, { useRef } from 'react';
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

const FoodLibraryList: React.FC = () => {
  const actionRef = useRef<ActionType>(null);
  const navigate = useNavigate();

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
      width: 180,
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
        <Row gutter={16} style={{ marginBottom: 16 }}>
          <Col span={4}>
            <Card size="small">
              <Statistic title="食物总数" value={stats.total} />
            </Card>
          </Col>
          <Col span={4}>
            <Card size="small">
              <Statistic title="已验证" value={stats.verified} valueStyle={{ color: '#3f8600' }} />
            </Card>
          </Col>
          <Col span={4}>
            <Card size="small">
              <Statistic
                title="未验证"
                value={stats.total - stats.verified}
                valueStyle={stats.total - stats.verified > 0 ? { color: '#cf1322' } : undefined}
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
    </>
  );
};

export default FoodLibraryList;
