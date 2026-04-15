import React, { useRef, useState } from 'react';
import { Card, Tag, Button, Row, Col, Statistic, Modal } from 'antd';
import { EyeOutlined, ReloadOutlined } from '@ant-design/icons';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { ProTable } from '@ant-design/pro-components';
import { useQuery } from '@tanstack/react-query';
import {
  contentApi,
  contentQueryKeys,
  type AiDecisionLogDto,
} from '@/services/contentManagementService';

export const routeConfig = {
  name: 'ai-decision-logs',
  title: 'AI决策日志',
  icon: 'AuditOutlined',
  order: 5,
  requireAuth: true,
};

const decisionMap: Record<string, { text: string; color: string }> = {
  SAFE: { text: 'SAFE', color: 'success' },
  OK: { text: 'OK', color: 'processing' },
  LIMIT: { text: 'LIMIT', color: 'warning' },
  AVOID: { text: 'AVOID', color: 'error' },
};

const riskMap: Record<string, string> = {
  '🟢': 'success',
  '🟡': 'warning',
  '🟠': 'warning',
  '🔴': 'error',
};

const AiDecisionLogsPage: React.FC = () => {
  const actionRef = useRef<ActionType>(null);
  const [detailVisible, setDetailVisible] = useState(false);
  const [currentLog, setCurrentLog] = useState<AiDecisionLogDto | null>(null);

  const { data: stats } = useQuery({
    queryKey: contentQueryKeys.aiLogs.statistics,
    queryFn: () => contentApi.getAiLogStatistics(),
    staleTime: 5 * 60 * 1000,
  });

  const columns: ProColumns<AiDecisionLogDto>[] = [
    {
      title: '用户ID',
      dataIndex: 'userId',
      width: 120,
      render: (v) => (v as string)?.slice(0, 8) + '...',
    },
    {
      title: '决策',
      dataIndex: 'decision',
      width: 80,
      valueEnum: Object.fromEntries(
        Object.entries(decisionMap).map(([k, v]) => [k, { text: v.text }])
      ),
      render: (_, r) => {
        const d = decisionMap[r.decision || ''];
        return d ? <Tag color={d.color}>{d.text}</Tag> : r.decision || '-';
      },
    },
    {
      title: '风险等级',
      dataIndex: 'riskLevel',
      width: 80,
      render: (_, r) =>
        r.riskLevel ? <Tag color={riskMap[r.riskLevel] || 'default'}>{r.riskLevel}</Tag> : '-',
    },
    {
      title: '用户是否执行',
      dataIndex: 'userFollowed',
      width: 100,
      search: false,
      render: (_, r) =>
        r.userFollowed === null ? (
          '-'
        ) : r.userFollowed ? (
          <Tag color="success">是</Tag>
        ) : (
          <Tag color="error">否</Tag>
        ),
    },
    {
      title: '用户反馈',
      dataIndex: 'userFeedback',
      width: 100,
      search: false,
      render: (v) => v || '-',
    },
    { title: '时间', dataIndex: 'createdAt', width: 160, valueType: 'dateTime', search: false },
    {
      title: '操作',
      width: 80,
      search: false,
      render: (_, record) => (
        <Button
          type="link"
          size="small"
          icon={<EyeOutlined />}
          onClick={() => {
            setCurrentLog(record);
            setDetailVisible(true);
          }}
        >
          详情
        </Button>
      ),
    },
  ];

  return (
    <>
      {stats && (
        <Row gutter={16} style={{ marginBottom: 16 }}>
          <Col span={6}>
            <Card>
              <Statistic title="总决策数" value={stats.total} />
            </Card>
          </Col>
          {stats.byDecision?.slice(0, 3).map((d: any) => (
            <Col span={6} key={d.decision}>
              <Card>
                <Statistic title={d.decision || '未知'} value={d.count} />
              </Card>
            </Col>
          ))}
        </Row>
      )}

      <ProTable<AiDecisionLogDto>
        columns={columns}
        actionRef={actionRef}
        request={async (params) => {
          const { current, pageSize, ...rest } = params;
          const res = await contentApi.getAiDecisionLogs({ page: current, pageSize, ...rest });
          return { data: res.list, total: res.total, success: true };
        }}
        rowKey="id"
        scroll={{ x: 900 }}
        search={{ labelWidth: 'auto' }}
        pagination={{ defaultPageSize: 20, showSizeChanger: true }}
        headerTitle="AI 决策日志"
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

      <Modal
        title="决策详情"
        open={detailVisible}
        onCancel={() => setDetailVisible(false)}
        footer={null}
        width={700}
      >
        {currentLog && (
          <div>
            <h4>输入上下文</h4>
            <pre
              style={{
                background: '#f5f5f5',
                padding: 12,
                borderRadius: 6,
                maxHeight: 200,
                overflow: 'auto',
              }}
            >
              {JSON.stringify(currentLog.inputContext, null, 2) || '无'}
            </pre>
            <h4 style={{ marginTop: 16 }}>完整AI响应</h4>
            <pre
              style={{
                background: '#f5f5f5',
                padding: 12,
                borderRadius: 6,
                maxHeight: 300,
                overflow: 'auto',
              }}
            >
              {JSON.stringify(currentLog.fullResponse, null, 2) || '无'}
            </pre>
          </div>
        )}
      </Modal>
    </>
  );
};

export default AiDecisionLogsPage;
