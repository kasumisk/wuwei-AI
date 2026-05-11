import React, { useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Col,
  Descriptions,
  Form,
  Image,
  Input,
  InputNumber,
  Modal,
  Pagination,
  Popconfirm,
  Progress,
  Row,
  Select,
  Space,
  Statistic,
  Switch,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import globalModal from '@/utils/modal';
import {
  CheckCircleOutlined,
  CheckOutlined,
  CloseCircleOutlined,
  CloseOutlined,
  DeleteOutlined,
  LoadingOutlined,
  PictureOutlined,
  ReloadOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import {
  useImageEnrichmentScan,
  useImageEnrichmentJobs,
  useImageEnrichmentEnqueue,
  useImageEnrichmentNow,
  useImageEnrichmentClear,
  useImageEnrichmentQueueClear,
  useImageEnrichmentCandidates,
  useImageEnrichmentApprove,
  useImageEnrichmentReject,
  useUsdaCategories,
  type ImageEnrichmentEnqueueParams,
  type ImageEnrichmentClearParams,
  type ImageEnrichmentNowResult,
  type ImageEnrichmentCandidate,
} from '@/services/foodPipelineService';
import globalMessage from '@/utils/message';

export const routeConfig = {
  name: 'image-enrichment',
  title: '图片生成',
  icon: 'PictureOutlined',
  order: 6,
  requireAuth: true,
  hideInMenu: false,
};

const { Text } = Typography;

const PRIMARY_SOURCE_OPTIONS = [
  { value: 'usda', label: 'USDA' },
  { value: 'cfsb', label: '中国食物成分表' },
  { value: 'manual', label: '人工录入' },
  { value: 'ai', label: 'AI 生成' },
  { value: 'import', label: '批量导入' },
];

const DISH_TYPE_OPTIONS = [
  { value: 'dish', label: '成品菜 (dish)' },
  { value: 'ingredient', label: '原材料 (ingredient)' },
  { value: 'semi_prepared', label: '半成品 (semi_prepared)' },
];

const ImageEnrichmentPage: React.FC = () => {
  const [enqueueForm] = Form.useForm<ImageEnrichmentEnqueueParams>();
  const [clearForm] = Form.useForm<ImageEnrichmentClearParams>();
  const [singleFoodId, setSingleFoodId] = useState('');
  const [lastNowResult, setLastNowResult] = useState<ImageEnrichmentNowResult | null>(null);
  const [pollingEnabled, setPollingEnabled] = useState(false);

  // 候选图审核状态
  const [candidateStatus, setCandidateStatus] = useState<string[]>(['uploaded', 'review_needed']);
  const [candidatePage, setCandidatePage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const { data: usdaCategories, isLoading: usdaCategoriesLoading } = useUsdaCategories();
  const { data: scan, refetch: refetchScan, isFetching: scanFetching } = useImageEnrichmentScan();
  const { data: jobs } = useImageEnrichmentJobs(pollingEnabled);

  const { data: candidatesData, isFetching: candidatesFetching, refetch: refetchCandidates } =
    useImageEnrichmentCandidates({ status: candidateStatus, page: candidatePage, pageSize: 30 });

  const enqueue = useImageEnrichmentEnqueue({
    onSuccess: (result) => {
      globalMessage.success(`已入队 ${result.enqueued} 个，跳过 ${result.skipped} 个`);
      setPollingEnabled(true);
    },
    onError: (e) => globalMessage.error(`入队失败: ${e.message}`),
  });

  const enrichNow = useImageEnrichmentNow({
    onSuccess: (result) => {
      setLastNowResult(result);
      globalMessage.success('图片生成成功');
      refetchScan();
    },
    onError: (e) => globalMessage.error(`生成失败: ${e.message}`),
  });

  const clearImages = useImageEnrichmentClear({
    onSuccess: (result) => {
      globalMessage.success(`已清空 ${result.cleared} 条食物的图片字段`);
      refetchScan();
    },
    onError: (e) => globalMessage.error(`清空失败: ${e.message}`),
  });

  const clearQueue = useImageEnrichmentQueueClear({
    onSuccess: (result) => {
      globalMessage.success(`队列已清空，移除 ${result.cleared} 个任务`);
    },
    onError: (e) => globalMessage.error(`清空队列失败: ${e.message}`),
  });

  const approve = useImageEnrichmentApprove({
    onSuccess: (result) => {
      globalMessage.success(`已审批 ${result.length} 张图片并写入食物库`);
      setSelectedIds([]);
      refetchScan();
    },
    onError: (e) => globalMessage.error(`审批失败: ${e.message}`),
  });

  const reject = useImageEnrichmentReject({
    onSuccess: (result) => {
      globalMessage.success(`已拒绝 ${result.length} 张候选图`);
      setSelectedIds([]);
      setRejectModalOpen(false);
      setRejectReason('');
    },
    onError: (e) => globalMessage.error(`拒绝失败: ${e.message}`),
  });

  const handleClear = (values: { category?: string; limit?: number }) => {
    globalModal.confirm({
      title: '确认清空图片字段？',
      content: '此操作将把匹配食物的 imageUrl / thumbnailUrl 置为 null，不可恢复，请确认。',
      okText: '确认清空',
      okType: 'danger',
      cancelText: '取消',
      onOk: () => clearImages.mutate(values),
    });
  };

  const toggleSelect = (id: string) =>
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );

  const handleApprove = () => {
    if (!selectedIds.length) return;
    globalModal.confirm({
      title: `确认审批 ${selectedIds.length} 张图片？`,
      content: '审批后图片将写入食物主表，作为正式图片对外展示。',
      okText: '确认审批',
      cancelText: '取消',
      onOk: () => approve.mutate(selectedIds),
    });
  };

  const counts = jobs?.counts;
  const isRunning = (counts?.active ?? 0) > 0 || (counts?.waiting ?? 0) > 0;

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="large">

      {/* ── 覆盖率概览 ── */}
      <Card
        title={<Space><PictureOutlined />图片覆盖率</Space>}
        extra={
          <Button icon={<ReloadOutlined />} onClick={() => refetchScan()} loading={scanFetching}>
            刷新
          </Button>
        }
      >
        <Row gutter={24} style={{ marginBottom: 16 }}>
          <Col span={6}><Statistic title="食物总数" value={scan?.totalFoods ?? 0} /></Col>
          <Col span={6}>
            <Statistic title="有图" value={scan?.covered ?? 0} valueStyle={{ color: '#52c41a' }} />
          </Col>
          <Col span={6}>
            <Statistic
              title="缺图"
              value={scan?.missingImage ?? 0}
              valueStyle={{ color: (scan?.missingImage ?? 0) > 0 ? '#ff4d4f' : undefined }}
            />
          </Col>
          <Col span={6}>
            <Statistic
              title="覆盖率"
              value={scan?.coveragePercent ?? 0}
              suffix="%"
              valueStyle={{ color: (scan?.coveragePercent ?? 0) >= 80 ? '#52c41a' : '#faad14' }}
            />
          </Col>
        </Row>
        <Progress
          percent={scan?.coveragePercent ?? 0}
          strokeColor={(scan?.coveragePercent ?? 0) >= 80 ? '#52c41a' : '#faad14'}
        />
        {(scan?.missingThumbnail ?? 0) > 0 && (
          <div style={{ marginTop: 8 }}>
            <Text type="secondary">另有 {scan!.missingThumbnail} 条缺缩略图</Text>
          </div>
        )}
      </Card>

      {/* ── 队列进度面板 ── */}
      <Card
        title={
          <Space>
            {isRunning ? <LoadingOutlined spin /> : <CheckCircleOutlined />}
            队列实时进度
            <Switch
              size="small"
              checked={pollingEnabled}
              onChange={setPollingEnabled}
              checkedChildren="轮询中"
              unCheckedChildren="暂停"
            />
          </Space>
        }
        extra={
          <Popconfirm
            title="确认清空队列？"
            description="将移除所有等待中和延迟中的任务，操作不可撤销。"
            okText="确认清空"
            okType="danger"
            cancelText="取消"
            onConfirm={() => clearQueue.mutate()}
          >
            <Button danger size="small" loading={clearQueue.isPending} icon={<DeleteOutlined />}>
              清空队列
            </Button>
          </Popconfirm>
        }
      >
        <Row gutter={16} style={{ marginBottom: 16 }}>
          {[
            { label: '等待中', key: 'waiting', color: '#1677ff' },
            { label: '处理中', key: 'active', color: '#fa8c16' },
            { label: '已完成', key: 'completed', color: '#52c41a' },
            { label: '失败', key: 'failed', color: '#ff4d4f' },
            { label: '延迟', key: 'delayed', color: '#722ed1' },
          ].map(({ label, key, color }) => (
            <Col span={4} key={key}>
              <Statistic
                title={label}
                value={(counts as any)?.[key] ?? 0}
                valueStyle={{ color, fontSize: 20 }}
              />
            </Col>
          ))}
        </Row>

        {/* 正在处理 */}
        {(jobs?.active?.length ?? 0) > 0 && (
          <div style={{ marginBottom: 16 }}>
            <Text strong>正在生成：</Text>
            <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {jobs!.active.map((j) => (
                <Tag key={j.jobId} icon={<LoadingOutlined />} color="processing">
                  {j.foodName}
                </Tag>
              ))}
            </div>
          </div>
        )}

        {/* 最近结果图片画廊 */}
        {(jobs?.recent?.length ?? 0) > 0 && (
          <>
            <Text strong>最近结果：</Text>
            <div
              style={{
                marginTop: 12,
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
                gap: 12,
              }}
            >
              {jobs!.recent.map((item) => {
                const candidateLabelMap: Record<string, string> = {
                  uploaded: 'AI通过',
                  review_needed: '待人工',
                  approved: '已审批',
                  rejected: '已拒绝',
                };
                const candidateBadge: Record<string, 'success' | 'warning' | 'default' | 'error'> = {
                  uploaded: 'success',
                  review_needed: 'warning',
                  approved: 'success',
                  rejected: 'error',
                };
                return (
                  <div
                    key={item.jobId}
                    style={{
                      border: `1px solid ${item.status === 'failed' ? '#ffccc7' : '#f0f0f0'}`,
                      borderRadius: 8,
                      overflow: 'hidden',
                      background: item.status === 'failed' ? '#fff2f0' : '#fff',
                    }}
                  >
                    {/* 图片区 */}
                    {item.imageUrl ? (
                      <Image
                        src={item.imageUrl}
                        width="100%"
                        height={140}
                        style={{ objectFit: 'cover', display: 'block' }}
                        preview={{ src: item.imageUrl }}
                      />
                    ) : (
                      <div
                        style={{
                          width: '100%',
                          height: 140,
                          background: item.status === 'failed' ? '#fff1f0' : '#fafafa',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 4,
                        }}
                      >
                        <CloseCircleOutlined style={{ fontSize: 28, color: item.status === 'failed' ? '#ff4d4f' : '#d9d9d9' }} />
                        <Text style={{ fontSize: 11 }} type={item.status === 'failed' ? 'danger' : 'secondary'}>
                          {item.status === 'failed' ? '生成失败' : '无图'}
                        </Text>
                      </div>
                    )}

                    {/* 信息区 */}
                    <div style={{ padding: '8px 10px' }}>
                      {/* 食物名 */}
                      <Tooltip title={item.foodName}>
                        <Text
                          ellipsis
                          style={{ fontSize: 12, display: 'block', marginBottom: 4 }}
                          type={item.status === 'failed' ? 'danger' : undefined}
                        >
                          {item.foodName || item.foodId.slice(0, 8)}
                        </Text>
                      </Tooltip>

                      {/* 分数 + 候选状态 */}
                      {item.status === 'completed' && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                          <Badge status={item.candidateStatus ? candidateBadge[item.candidateStatus] ?? 'default' : 'default'} />
                          <Text style={{ fontSize: 11 }} type="secondary">
                            {item.qualityScore >= 0 ? `${item.qualityScore} 分` : '-- 分'}
                          </Text>
                          {item.candidateStatus && (
                            <Tag
                              style={{ fontSize: 10, padding: '0 4px', margin: 0, lineHeight: '16px' }}
                              color={item.candidateStatus === 'review_needed' ? 'warning' : item.candidateStatus === 'uploaded' ? 'success' : undefined}
                            >
                              {candidateLabelMap[item.candidateStatus] ?? item.candidateStatus}
                            </Tag>
                          )}
                        </div>
                      )}

                      {/* 失败原因 */}
                      {item.status === 'failed' && (
                        <Tooltip title={item.error}>
                          <Text style={{ fontSize: 11 }} type="danger" ellipsis>
                            {item.error ?? '未知错误'}
                          </Text>
                        </Tooltip>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {!pollingEnabled && (counts?.active ?? 0) === 0 && (jobs?.recent?.length ?? 0) === 0 && (
          <Text type="secondary">开启轮询或触发入队后显示实时进度</Text>
        )}
      </Card>

      {/* ── 批量入队 ── */}
      <Card title={<Space><ReloadOutlined />批量入队生成</Space>}>
        <Alert
          message="入队后由后台 Worker 异步处理，默认并发 2 个，每个约 15-30 秒。开启上方「轮询」可实时查看进度。"
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
        />
        <Form
          form={enqueueForm}
          layout="vertical"
          onFinish={(v) => {
            // 过滤掉空数组，避免后端 { in: [] } 匹配不到任何记录
            const cleaned = Object.fromEntries(
              Object.entries(v).filter(([, val]) => !Array.isArray(val) || val.length > 0)
            ) as typeof v;
            enqueue.mutate(cleaned);
          }}
          initialValues={{ onlyMissing: true, premiumThreshold: 80 }}
        >
          <Row gutter={16}>
            <Col span={4}>
              <Form.Item name="onlyMissing" label="仅缺图" valuePropName="checked">
                <Switch />
              </Form.Item>
            </Col>
            <Col span={4}>
              <Form.Item name="force" label="强制覆盖" valuePropName="checked">
                <Switch />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="foodGroup" label="USDA 食物组（可多选）">
                <Select
                  mode="multiple"
                  allowClear
                  showSearch
                  placeholder="不限（全部分类）"
                  loading={usdaCategoriesLoading}
                  options={usdaCategories}
                  optionFilterProp="label"
                  maxTagCount="responsive"
                />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="primarySource" label="数据来源（可多选）">
                <Select mode="multiple" allowClear placeholder="不限" options={PRIMARY_SOURCE_OPTIONS} maxTagCount="responsive" />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="dishType" label="食物形态（可多选）">                <Select mode="multiple" allowClear placeholder="不限" options={DISH_TYPE_OPTIONS} maxTagCount="responsive" />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="isVerified" label="已人工核验">
                <Select allowClear placeholder="不限" options={[
                  { value: true, label: '是' },
                  { value: false, label: '否' },
                ]} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item
                label={
                  <Tooltip title="dishPriority：成品菜推荐优先级 0-100，值越高越优先推荐；仅 dish/semi_prepared 类型的食物有此字段，原材料类为 null。">
                    优先级范围 <Text type="secondary" style={{ fontSize: 12 }}>dishPriority (?)</Text>
                  </Tooltip>
                }
              >
                <Space.Compact>
                  <Form.Item name="minDishPriority" noStyle>
                    <InputNumber min={0} max={100} placeholder="最小" style={{ width: 80 }} />
                  </Form.Item>
                  <Input disabled value="—" style={{ width: 30, textAlign: 'center', pointerEvents: 'none' }} />
                  <Form.Item name="maxDishPriority" noStyle>
                    <InputNumber min={0} max={100} placeholder="最大" style={{ width: 80 }} />
                  </Form.Item>
                </Space.Compact>
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="premiumThreshold" label="高品质模型阈值">
                <InputNumber min={0} max={100} style={{ width: '100%' }} addonAfter="分" />
              </Form.Item>
            </Col>
            <Col span={4}>
              <Form.Item name="limit" label="最多入队">
                <InputNumber min={1} max={5000} placeholder="不限" style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item>
                <Button type="primary" htmlType="submit" loading={enqueue.isPending} icon={<ReloadOutlined />}>
                  开始入队
                </Button>
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Card>

      {/* ── 单条立即生成 ── */}
      <Card title={<Space><ThunderboltOutlined />单条立即生成（同步）</Space>}>
        <Alert
          message="同步调用 Replicate 生成并写库，用于测试或紧急补图，请勿批量使用。"
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
        />
        <Space>
          <Input
            placeholder="Food ID (UUID)"
            value={singleFoodId}
            onChange={(e) => setSingleFoodId(e.target.value)}
            style={{ width: 320 }}
          />
          <Button
            type="primary"
            danger
            icon={<ThunderboltOutlined />}
            loading={enrichNow.isPending}
            disabled={!singleFoodId.trim()}
            onClick={() => enrichNow.mutate(singleFoodId.trim())}
          >
            立即生成
          </Button>
        </Space>

        {lastNowResult && (
          <Row gutter={24} style={{ marginTop: 16 }}>
            <Col>
              <Image
                src={lastNowResult.imageUrl}
                width={180}
                height={180}
                style={{ objectFit: 'cover', borderRadius: 8 }}
              />
            </Col>
            <Col>
              <Descriptions bordered size="small" column={1}>
                <Descriptions.Item label="Food ID">{lastNowResult.foodId}</Descriptions.Item>
                <Descriptions.Item label="图片 URL">
                  <Text copyable style={{ fontSize: 12 }}>{lastNowResult.imageUrl}</Text>
                </Descriptions.Item>
                <Descriptions.Item label="Vision 评分">
                  <Tag color={lastNowResult.visionScore >= 70 ? 'success' : 'warning'}>
                    {lastNowResult.visionScore}
                  </Tag>
                </Descriptions.Item>
                <Descriptions.Item label="Vision 匹配">
                  <Tag color={lastNowResult.visionMatch ? 'success' : 'error'}>
                    {lastNowResult.visionMatch ? '匹配' : '不匹配'}
                  </Tag>
                </Descriptions.Item>
              </Descriptions>
            </Col>
          </Row>
        )}
      </Card>

      {/* ── 候选图审核 ── */}
      <Card
        title={<Space><CheckCircleOutlined />候选图审核</Space>}
        extra={
          <Space>
            <Select
              mode="multiple"
              value={candidateStatus}
              onChange={(v) => { setCandidateStatus(v); setCandidatePage(1); setSelectedIds([]); }}
              options={[
                { value: 'uploaded', label: 'AI 通过' },
                { value: 'review_needed', label: '待人工审核' },
                { value: 'approved', label: '已审批' },
                { value: 'rejected', label: '已拒绝' },
                { value: 'pending', label: '待审核' },
              ]}
              style={{ width: 240 }}
              placeholder="筛选状态"
            />
            <Button icon={<ReloadOutlined />} onClick={() => refetchCandidates()} loading={candidatesFetching}>
              刷新
            </Button>
          </Space>
        }
      >
        {selectedIds.length > 0 && (
          <div style={{ marginBottom: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
            <Text>已选 {selectedIds.length} 张</Text>
            <Button
              type="primary"
              icon={<CheckOutlined />}
              loading={approve.isPending}
              onClick={handleApprove}
            >
              审批写入
            </Button>
            <Button
              danger
              icon={<CloseOutlined />}
              onClick={() => setRejectModalOpen(true)}
            >
              拒绝
            </Button>
            <Button size="small" onClick={() => setSelectedIds([])}>取消选择</Button>
          </div>
        )}

        {(candidatesData?.items?.length ?? 0) === 0 && !candidatesFetching ? (
          <Text type="secondary">暂无候选图</Text>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
              gap: 12,
            }}
          >
            {(candidatesData?.items ?? []).map((item: ImageEnrichmentCandidate) => {
              const selected = selectedIds.includes(item.id);
              const statusColor: Record<string, string> = {
                approved: 'blue',
                uploaded: 'success',
                review_needed: 'warning',
                rejected: 'error',
                pending: 'default',
              };
              return (
                <div
                  key={item.id}
                  onClick={() => toggleSelect(item.id)}
                  style={{
                    border: `2px solid ${selected ? '#1677ff' : '#f0f0f0'}`,
                    borderRadius: 8,
                    overflow: 'hidden',
                    background: selected ? '#e6f4ff' : '#fff',
                    cursor: 'pointer',
                    transition: 'border-color 0.15s',
                  }}
                >
                  {item.storedUrl ? (
                    <Image
                      src={item.storedUrl}
                      width="100%"
                      height={140}
                      style={{ objectFit: 'cover', display: 'block' }}
                      preview={{ src: item.storedUrl }}
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <div
                      style={{
                        width: '100%',
                        height: 140,
                        background: '#fafafa',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <CloseCircleOutlined style={{ fontSize: 32, color: '#d9d9d9' }} />
                    </div>
                  )}
                  <div style={{ padding: '6px 8px' }}>
                    <Tooltip title={item.foodName}>
                      <Text ellipsis style={{ fontSize: 12, display: 'block' }}>
                        {item.foodName}
                      </Text>
                    </Tooltip>
                    <Space size={4} style={{ marginTop: 4, flexWrap: 'wrap' }}>
                      <Tag color={statusColor[item.status] ?? 'default'} style={{ fontSize: 11 }}>
                        {{ uploaded: 'AI通过', review_needed: '待人工', approved: '已审批', rejected: '已拒绝', pending: '待审核' }[item.status] ?? item.status}
                      </Tag>
                      {item.finalScore != null && (
                        <Text style={{ fontSize: 11 }} type="secondary">
                          {item.finalScore}分
                        </Text>
                      )}
                    </Space>
                    {item.aiReason && (
                      <Tooltip title={item.aiReason}>
                        <Text style={{ fontSize: 10, display: 'block', marginTop: 2 }} type="secondary" ellipsis>
                          {item.aiReason}
                        </Text>
                      </Tooltip>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {(candidatesData?.total ?? 0) > 30 && (
          <div style={{ marginTop: 16, textAlign: 'right' }}>
            <Pagination
              current={candidatePage}
              pageSize={30}
              total={candidatesData?.total ?? 0}
              onChange={(p) => { setCandidatePage(p); setSelectedIds([]); }}
              showTotal={(t) => `共 ${t} 条`}
              size="small"
            />
          </div>
        )}
      </Card>

      {/* 拒绝理由弹窗 */}
      <Modal
        title="填写拒绝理由（可选）"
        open={rejectModalOpen}
        onOk={() => reject.mutate({ ids: selectedIds, reason: rejectReason || undefined })}
        onCancel={() => { setRejectModalOpen(false); setRejectReason(''); }}
        okText="确认拒绝"
        okButtonProps={{ danger: true, loading: reject.isPending }}
        cancelText="取消"
      >
        <Input.TextArea
          rows={3}
          placeholder="如：图片与食物不符、AI 伪影明显……"
          value={rejectReason}
          onChange={(e) => setRejectReason(e.target.value)}
        />
      </Modal>

      {/* ── 清空图片字段 ── */}
      <Card title={<Space><DeleteOutlined />清空图片字段（重置重跑）</Space>}>
        <Alert
          message="将匹配食物的 imageUrl / thumbnailUrl 置为 null，之后可通过「批量入队」重新生成。操作不可撤销。"
          type="error"
          showIcon
          style={{ marginBottom: 16 }}
        />
        <Form form={clearForm} layout="vertical" onFinish={handleClear} initialValues={{ limit: 500 }}>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="foodGroup" label="USDA 食物组（可多选）">
                <Select
                  mode="multiple"
                  allowClear
                  showSearch
                  placeholder="不限（全部分类）"
                  loading={usdaCategoriesLoading}
                  options={usdaCategories}
                  optionFilterProp="label"
                  maxTagCount="responsive"
                />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="primarySource" label="数据来源（可多选）">
                <Select mode="multiple" allowClear placeholder="不限" options={PRIMARY_SOURCE_OPTIONS} maxTagCount="responsive" />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="dishType" label="食物形态（可多选）">                <Select mode="multiple" allowClear placeholder="不限" options={DISH_TYPE_OPTIONS} maxTagCount="responsive" />
              </Form.Item>
            </Col>
            <Col span={4}>
              <Form.Item name="isVerified" label="已人工核验">
                <Select allowClear placeholder="不限" options={[
                  { value: true, label: '是' },
                  { value: false, label: '否' },
                ]} />
              </Form.Item>
            </Col>
            <Col span={4}>
              <Form.Item name="limit" label="最多清空">
                <InputNumber min={1} max={50000} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item>
                <Button danger htmlType="submit" loading={clearImages.isPending} icon={<DeleteOutlined />}>
                  清空图片字段
                </Button>
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Card>

    </Space>
  );
};

export default ImageEnrichmentPage;
