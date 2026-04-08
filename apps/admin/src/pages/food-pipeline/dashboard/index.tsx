import React, { useState } from 'react';
import {
  Card,
  Row,
  Col,
  Statistic,
  Button,
  Space,
  message,
  Progress,
  Tag,
  Descriptions,
  Spin,
  Typography,
  Input,
  InputNumber,
  Select,
  Modal,
  Form,
  Alert,
  Divider,
} from 'antd';
import {
  CloudDownloadOutlined,
  RobotOutlined,
  TranslationOutlined,
  CalculatorOutlined,
  WarningOutlined,
  SyncOutlined,
  CheckCircleOutlined,
  DatabaseOutlined,
  BarcodeOutlined,
  PictureOutlined,
} from '@ant-design/icons';
import {
  useQualityReport,
  useImportUsda,
  useBatchAiLabel,
  useBatchAiTranslate,
  useBatchApplyRules,
  useResolveAllConflicts,
  useLookupBarcode,
} from '@/services/foodPipelineService';

export const routeConfig = {
  name: 'pipeline-dashboard',
  title: '管道总览',
  icon: 'DashboardOutlined',
  order: 1,
  requireAuth: true,
  hideInMenu: false,
};

const { Title, Text } = Typography;

const PipelineDashboard: React.FC = () => {
  const { data: report, isLoading, refetch } = useQualityReport();
  const [usdaModal, setUsdaModal] = useState(false);
  const [barcodeModal, setBarcodeModal] = useState(false);
  const [aiLabelModal, setAiLabelModal] = useState(false);
  const [translateModal, setTranslateModal] = useState(false);

  const [usdaForm] = Form.useForm();
  const [aiLabelForm] = Form.useForm();
  const [translateForm] = Form.useForm();
  const [barcodeValue, setBarcodeValue] = useState('');

  const importUsda = useImportUsda({
    onSuccess: (result) => {
      message.success(`导入完成: 新增 ${result.created}, 更新 ${result.updated}, 跳过 ${result.skipped}`);
      setUsdaModal(false);
      usdaForm.resetFields();
      refetch();
    },
    onError: (e) => message.error(`导入失败: ${e.message}`),
  });

  const batchLabel = useBatchAiLabel({
    onSuccess: (result) => {
      message.success(`标注完成: 成功 ${result.labeled}, 失败 ${result.failed}`);
      setAiLabelModal(false);
      aiLabelForm.resetFields();
      refetch();
    },
    onError: (e) => message.error(`标注失败: ${e.message}`),
  });

  const batchTranslate = useBatchAiTranslate({
    onSuccess: (result) => {
      message.success(`翻译完成: 成功 ${result.translated}, 失败 ${result.failed}`);
      setTranslateModal(false);
      translateForm.resetFields();
      refetch();
    },
    onError: (e) => message.error(`翻译失败: ${e.message}`),
  });

  const batchRules = useBatchApplyRules({
    onSuccess: (result) => {
      message.success(`规则计算完成: 处理了 ${result.processed} 条`);
      refetch();
    },
    onError: (e) => message.error(`规则计算失败: ${e.message}`),
  });

  const resolveConflicts = useResolveAllConflicts({
    onSuccess: () => {
      message.success('冲突自动解决完成');
      refetch();
    },
    onError: (e) => message.error(`冲突解决失败: ${e.message}`),
  });

  const lookupBarcode = useLookupBarcode({
    onSuccess: (data) => {
      message.success(`条形码查询成功: ${data?.name || '已导入'}`);
      setBarcodeModal(false);
      setBarcodeValue('');
      refetch();
    },
    onError: (e) => message.error(`条形码查询失败: ${e.message}`),
  });

  if (isLoading) {
    return <Spin size="large" style={{ display: 'flex', justifyContent: 'center', marginTop: 100 }} />;
  }

  const summary = report?.summary;
  const completeness = report?.completeness;
  const quality = report?.quality;
  const conflicts = report?.conflicts;
  const translations = report?.translations;

  return (
    <div style={{ padding: 0 }}>
      {/* 快捷操作 */}
      <Card
        title="快捷操作"
        extra={<Button icon={<SyncOutlined />} onClick={() => refetch()}>刷新数据</Button>}
        style={{ marginBottom: 16 }}
      >
        <Space wrap size={[12, 12]}>
          <Button type="primary" icon={<CloudDownloadOutlined />} onClick={() => setUsdaModal(true)} loading={importUsda.isPending}>
            USDA 导入
          </Button>
          <Button icon={<BarcodeOutlined />} onClick={() => setBarcodeModal(true)} loading={lookupBarcode.isPending}>
            条形码查询
          </Button>
          <Button icon={<RobotOutlined />} onClick={() => setAiLabelModal(true)} loading={batchLabel.isPending}>
            AI 标注
          </Button>
          <Button icon={<TranslationOutlined />} onClick={() => setTranslateModal(true)} loading={batchTranslate.isPending}>
            AI 翻译
          </Button>
          <Button
            icon={<CalculatorOutlined />}
            onClick={() => batchRules.mutate({ recalcAll: false })}
            loading={batchRules.isPending}
          >
            计算评分
          </Button>
          <Button
            icon={<WarningOutlined />}
            onClick={() => resolveConflicts.mutate()}
            loading={resolveConflicts.isPending}
            danger
          >
            自动解决冲突
          </Button>
        </Space>
      </Card>

      {/* 总览统计 */}
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={12} sm={6}>
          <Card>
            <Statistic title="食物总数" value={summary?.totalFoods || 0} prefix={<DatabaseOutlined />} />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card>
            <Statistic
              title="已验证"
              value={quality?.verifiedCount || 0}
              suffix={`/ ${summary?.totalFoods || 0}`}
              valueStyle={{ color: '#3f8600' }}
              prefix={<CheckCircleOutlined />}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card>
            <Statistic
              title="平均置信度"
              value={((quality?.avgConfidence || 0) * 100).toFixed(1)}
              suffix="%"
            />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card>
            <Statistic
              title="待处理冲突"
              value={conflicts?.pending || 0}
              valueStyle={{ color: conflicts?.pending ? '#cf1322' : '#3f8600' }}
              prefix={<WarningOutlined />}
            />
          </Card>
        </Col>
      </Row>

      {/* 数据完整度 */}
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} md={12}>
          <Card title="数据完整度">
            {completeness && summary?.totalFoods ? (
              <Space direction="vertical" style={{ width: '100%' }} size={8}>
                {[
                  { label: '宏量营养素', value: completeness.hasMacros },
                  { label: '微量营养素', value: completeness.hasMicros },
                  { label: '过敏原', value: completeness.hasAllergens },
                  { label: '食物图片', value: completeness.hasImage },
                  { label: '条形码', value: completeness.hasBarcode },
                  { label: '餐次类型', value: completeness.hasMealTypes },
                  { label: '搭配关系', value: completeness.hasCompatibility },
                ].map(item => (
                  <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <Text style={{ width: 100 }}>{item.label}</Text>
                    <Progress
                      percent={Math.round((item.value / summary.totalFoods) * 100)}
                      size="small"
                      style={{ flex: 1 }}
                    />
                    <Text type="secondary" style={{ width: 60, textAlign: 'right' }}>
                      {item.value}/{summary.totalFoods}
                    </Text>
                  </div>
                ))}
              </Space>
            ) : (
              <Text type="secondary">暂无数据</Text>
            )}
          </Card>
        </Col>

        <Col xs={24} md={12}>
          <Card title="数据分布">
            <Descriptions column={1} size="small">
              <Descriptions.Item label="按状态">
                <Space wrap>
                  {summary?.byStatus && Object.entries(summary.byStatus).map(([status, count]) => (
                    <Tag key={status}>{status}: {count as number}</Tag>
                  ))}
                </Space>
              </Descriptions.Item>
              <Descriptions.Item label="按来源">
                <Space wrap>
                  {summary?.bySource && Object.entries(summary.bySource).map(([source, count]) => (
                    <Tag key={source} color="blue">{source}: {count as number}</Tag>
                  ))}
                </Space>
              </Descriptions.Item>
              <Descriptions.Item label="冲突统计">
                <Space>
                  <Tag color="red">待处理: {conflicts?.pending || 0}</Tag>
                  <Tag color="green">已解决: {conflicts?.resolved || 0}</Tag>
                  <Tag>总计: {conflicts?.total || 0}</Tag>
                </Space>
              </Descriptions.Item>
              <Descriptions.Item label="翻译覆盖">
                <Space wrap>
                  {translations?.byLocale && Object.entries(translations.byLocale).map(([locale, count]) => (
                    <Tag key={locale} color="purple">{locale}: {count as number}</Tag>
                  ))}
                  <Tag color="orange">未翻译: {translations?.untranslatedCount || 0}</Tag>
                </Space>
              </Descriptions.Item>
              <Descriptions.Item label="宏量一致性">
                <Tag color={quality?.macroConsistencyPass && summary?.totalFoods && quality.macroConsistencyPass / summary.totalFoods > 0.8 ? 'green' : 'orange'}>
                  通过: {quality?.macroConsistencyPass || 0}/{summary?.totalFoods || 0}
                </Tag>
              </Descriptions.Item>
            </Descriptions>
          </Card>
        </Col>
      </Row>

      {/* USDA 导入弹窗 */}
      <Modal
        title="USDA 数据导入"
        open={usdaModal}
        onCancel={() => setUsdaModal(false)}
        onOk={() => usdaForm.validateFields().then(v => importUsda.mutate(v))}
        confirmLoading={importUsda.isPending}
      >
        <Alert message="从 USDA FoodData Central 搜索并导入食物数据。需要配置 USDA_API_KEY 环境变量。" type="info" showIcon style={{ marginBottom: 16 }} />
        <Form form={usdaForm} layout="vertical" initialValues={{ maxItems: 50 }}>
          <Form.Item name="query" label="搜索关键词" rules={[{ required: true, message: '请输入搜索关键词' }]}>
            <Input placeholder="例如: chicken breast, rice, apple" />
          </Form.Item>
          <Form.Item name="maxItems" label="最大导入数量">
            <InputNumber min={1} max={500} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>

      {/* 条形码查询弹窗 */}
      <Modal
        title="条形码查询"
        open={barcodeModal}
        onCancel={() => setBarcodeModal(false)}
        onOk={() => { if (barcodeValue) lookupBarcode.mutate(barcodeValue); }}
        confirmLoading={lookupBarcode.isPending}
      >
        <Alert message="通过 Open Food Facts 数据库查询条形码并导入产品信息。" type="info" showIcon style={{ marginBottom: 16 }} />
        <Input
          placeholder="请输入 EAN-13 条形码"
          value={barcodeValue}
          onChange={(e) => setBarcodeValue(e.target.value)}
          prefix={<BarcodeOutlined />}
        />
      </Modal>

      {/* AI 标注弹窗 */}
      <Modal
        title="AI 智能标注"
        open={aiLabelModal}
        onCancel={() => setAiLabelModal(false)}
        onOk={() => aiLabelForm.validateFields().then(v => batchLabel.mutate(v))}
        confirmLoading={batchLabel.isPending}
      >
        <Alert message="使用 DeepSeek V3 AI 对食物进行分类、标签和评分标注。" type="info" showIcon style={{ marginBottom: 16 }} />
        <Form form={aiLabelForm} layout="vertical" initialValues={{ limit: 50, unlabeled: true }}>
          <Form.Item name="category" label="限定分类（可选）">
            <Select allowClear placeholder="全部分类" options={[
              { label: '蛋白质类', value: 'protein' },
              { label: '谷物主食', value: 'grain' },
              { label: '蔬菜', value: 'veggie' },
              { label: '水果', value: 'fruit' },
              { label: '乳制品', value: 'dairy' },
              { label: '油脂坚果', value: 'fat' },
              { label: '饮品', value: 'beverage' },
              { label: '零食甜点', value: 'snack' },
            ]} />
          </Form.Item>
          <Form.Item name="unlabeled" label="仅处理未标注" valuePropName="checked">
            <Select options={[{ label: '是', value: true }, { label: '否', value: false }]} />
          </Form.Item>
          <Form.Item name="limit" label="处理数量">
            <InputNumber min={1} max={500} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>

      {/* AI 翻译弹窗 */}
      <Modal
        title="AI 智能翻译"
        open={translateModal}
        onCancel={() => setTranslateModal(false)}
        onOk={() => translateForm.validateFields().then(v => batchTranslate.mutate(v))}
        confirmLoading={batchTranslate.isPending}
      >
        <Alert message="使用 DeepSeek V3 AI 将食物名称翻译为目标语言。" type="info" showIcon style={{ marginBottom: 16 }} />
        <Form form={translateForm} layout="vertical" initialValues={{ limit: 50, targetLocale: 'en-US', untranslatedOnly: true }}>
          <Form.Item name="targetLocale" label="目标语言" rules={[{ required: true }]}>
            <Select options={[
              { label: '英语 (en-US)', value: 'en-US' },
              { label: '简体中文 (zh-CN)', value: 'zh-CN' },
              { label: '繁体中文 (zh-TW)', value: 'zh-TW' },
              { label: '日语 (ja-JP)', value: 'ja-JP' },
              { label: '韩语 (ko-KR)', value: 'ko-KR' },
            ]} />
          </Form.Item>
          <Form.Item name="untranslatedOnly" label="仅翻译未翻译的">
            <Select options={[{ label: '是', value: true }, { label: '否', value: false }]} />
          </Form.Item>
          <Form.Item name="limit" label="处理数量">
            <InputNumber min={1} max={200} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default PipelineDashboard;
