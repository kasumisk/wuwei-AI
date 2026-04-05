import React, { useState } from 'react';
import { Card, Row, Col, Statistic, DatePicker, Space, Table, Empty, Spin } from 'antd';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import type { ColumnsType } from 'antd/es/table';
import { useClientUsageStats } from '@/services/clientService';
import dayjs, { type Dayjs } from 'dayjs';

const { RangePicker } = DatePicker;

interface ClientUsageStatsProps {
  clientId: string;
}

const ClientUsageStats: React.FC<ClientUsageStatsProps> = ({ clientId }) => {
  // 默认查询最近30天
  const [dateRange, setDateRange] = useState<[Dayjs, Dayjs]>([
    dayjs().subtract(30, 'days'),
    dayjs(),
  ]);

  const { data: stats, isLoading } = useClientUsageStats(clientId, {
    startDate: dateRange[0].format('YYYY-MM-DD'),
    endDate: dateRange[1].format('YYYY-MM-DD'),
  });

  // 能力使用表格列定义
  const capabilityColumns: ColumnsType<any> = [
    {
      title: '能力类型',
      dataIndex: 'capabilityType',
      key: 'capabilityType',
    },
    {
      title: '请求数',
      dataIndex: 'requestCount',
      key: 'requestCount',
      render: (value: number) => value.toLocaleString(),
    },
    {
      title: '成本（美元）',
      dataIndex: 'cost',
      key: 'cost',
      render: (value: number) => `$${value.toFixed(4)}`,
    },
    {
      title: 'Tokens',
      dataIndex: 'tokens',
      key: 'tokens',
      render: (value: number) => value.toLocaleString(),
    },
  ];

  // 日期范围选择预设
  const rangePresets = [
    { label: '最近7天', value: [dayjs().subtract(7, 'days'), dayjs()] as [Dayjs, Dayjs] },
    { label: '最近30天', value: [dayjs().subtract(30, 'days'), dayjs()] as [Dayjs, Dayjs] },
    { label: '最近90天', value: [dayjs().subtract(90, 'days'), dayjs()] as [Dayjs, Dayjs] },
    { label: '本月', value: [dayjs().startOf('month'), dayjs()] as [Dayjs, Dayjs] },
    {
      label: '上月',
      value: [
        dayjs().subtract(1, 'month').startOf('month'),
        dayjs().subtract(1, 'month').endOf('month'),
      ] as [Dayjs, Dayjs],
    },
  ];

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Spin size="large" />
      </div>
    );
  }

  if (!stats) {
    return <Empty description="暂无数据" />;
  }

  return (
    <div className="space-y-4">
      {/* 日期范围选择 */}
      <Card size="small">
        <Space>
          <span className="font-medium">时间范围:</span>
          <RangePicker
            value={dateRange}
            onChange={(dates) => {
              if (dates && dates[0] && dates[1]) {
                setDateRange([dates[0], dates[1]]);
              }
            }}
            presets={rangePresets}
            format="YYYY-MM-DD"
          />
        </Space>
      </Card>

      {/* 统计概览 */}
      <Row gutter={16}>
        <Col span={6}>
          <Card>
            <Statistic title="总请求数" value={stats.totalRequests} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="成功率" value={stats.successRate} precision={2} suffix="%" />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="平均响应时间" value={stats.avgResponseTime} suffix="ms" />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="总成本" value={stats.totalCost} precision={4} prefix="$" />
          </Card>
        </Col>
      </Row>

      <Row gutter={16}>
        <Col span={6}>
          <Card>
            <Statistic
              title="成功请求"
              value={stats.successRequests}
              valueStyle={{ color: '#3f8600' }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="失败请求"
              value={stats.failedRequests}
              valueStyle={{ color: '#cf1322' }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="输入 Tokens" value={stats.totalInputTokens.toLocaleString()} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="输出 Tokens" value={stats.totalOutputTokens.toLocaleString()} />
          </Card>
        </Col>
      </Row>

      {/* 时间序列图表 */}
      {stats.timeSeries && stats.timeSeries.length > 0 && (
        <Card title="使用趋势" className="mt-4">
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={stats.timeSeries}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" />
              <YAxis yAxisId="left" />
              <YAxis yAxisId="right" orientation="right" />
              <Tooltip />
              <Legend />
              <Line
                yAxisId="left"
                type="monotone"
                dataKey="requests"
                stroke="#8884d8"
                name="请求数"
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="cost"
                stroke="#82ca9d"
                name="成本 ($)"
              />
            </LineChart>
          </ResponsiveContainer>
        </Card>
      )}

      {/* 按能力类型统计表格 */}
      {stats.byCapability && stats.byCapability.length > 0 && (
        <Card title="能力使用统计" className="mt-4">
          <Table
            columns={capabilityColumns}
            dataSource={stats.byCapability}
            rowKey="capabilityType"
            pagination={false}
          />
        </Card>
      )}
    </div>
  );
};

export default ClientUsageStats;
