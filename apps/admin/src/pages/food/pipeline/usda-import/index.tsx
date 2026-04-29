import React, { useState } from 'react';
import {
  Card,
  Button,
  Space,
  Table,
  Input,
  InputNumber,
  message,
  Tag,
  Typography,
  Form,
  Modal,
  Alert,
  Descriptions,
  Row,
  Col,
} from 'antd';
import { SearchOutlined, CloudDownloadOutlined, DatabaseOutlined } from '@ant-design/icons';
import {
  foodPipelineApi,
  useImportUsda,
  useImportUsdaPreset,
  useUsdaPresets,
  type UsdaSearchResult,
} from '@/services/foodPipelineService';

export const routeConfig = {
  name: 'usda-import',
  title: 'USDA 导入',
  icon: 'CloudDownloadOutlined',
  order: 2,
  requireAuth: true,
  hideInMenu: false,
};

const { Text } = Typography;

const UsdaImportPage: React.FC = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchResult, setSearchResult] = useState<UsdaSearchResult | null>(null);
  const [importModal, setImportModal] = useState(false);
  const [importResult, setImportResult] = useState<any>(null);
  const [presetModal, setPresetModal] = useState(false);
  const [form] = Form.useForm();
  const [presetForm] = Form.useForm();
  const { data: presets, isLoading: presetsLoading } = useUsdaPresets();

  const importUsda = useImportUsda({
    onSuccess: (result) => {
      setImportResult(result);
      message.success(`导入完成: 新增 ${result.created}, 更新 ${result.updated}`);
      setImportModal(false);
      form.resetFields();
    },
    onError: (e) => message.error(`导入失败: ${e.message}`),
  });

  const importUsdaPreset = useImportUsdaPreset({
    onSuccess: (result) => {
      setImportResult(result);
      message.success(`预设导入完成: 新增 ${result.created}, 更新 ${result.updated}`);
      setPresetModal(false);
      presetForm.resetFields();
    },
    onError: (e) => message.error(`预设导入失败: ${e.message}`),
  });

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      message.warning('请输入搜索关键词');
      return;
    }
    setSearchLoading(true);
    try {
      const result = await foodPipelineApi.searchUsda(searchQuery, 50);
      setSearchResult(result);
    } catch (e: any) {
      message.error(`搜索失败: ${e.message}`);
    } finally {
      setSearchLoading(false);
    }
  };

  const handleImport = () => {
    if (!searchQuery.trim()) {
      message.warning('请先搜索');
      return;
    }
    form.setFieldsValue({ query: searchQuery, maxItems: 50 });
    setImportModal(true);
  };

  const columns = [
    {
      title: 'USDA ID',
      dataIndex: 'fdcId',
      width: 100,
      render: (v: number) => <Tag color="blue">{v}</Tag>,
    },
    {
      title: '名称',
      dataIndex: 'description',
      ellipsis: true,
    },
    {
      title: '分类',
      dataIndex: 'foodCategory',
      width: 150,
      render: (v: string) => (v ? <Tag>{v}</Tag> : '-'),
    },
    {
      title: '数据类型',
      dataIndex: 'dataType',
      width: 120,
      render: (v: string) => <Tag color="cyan">{v || '-'}</Tag>,
    },
    {
      title: '品牌',
      dataIndex: 'brandOwner',
      width: 150,
      ellipsis: true,
      render: (v: string) => v || '-',
    },
  ];

  return (
    <div>
      <Card
        title={
          <Space>
            <CloudDownloadOutlined /> USDA FoodData Central 数据导入
          </Space>
        }
        style={{ marginBottom: 16 }}
      >
        <Alert
          message="推荐方式：优先使用预设导入包"
          description="关键词搜索容易漏掉同义词和细分类。日常补库建议直接使用预设包导入，系统会按多组常用查询词批量拉取，再走统一清洗、去重和评分流程。"
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
        />
        <Row gutter={[16, 16]}>
          {(presets || []).map((preset) => (
            <Col xs={24} md={12} xl={8} key={preset.key}>
              <Card size="small" title={preset.label} style={{ height: '100%' }} loading={presetsLoading}>
                <Space direction="vertical" style={{ width: '100%' }}>
                  <Text type="secondary">{preset.description}</Text>
                  <Tag>{preset.queryCount} 组查询词</Tag>
                  <Button
                    type="primary"
                    icon={<CloudDownloadOutlined />}
                    onClick={() => {
                      presetForm.setFieldsValue({
                        presetKey: preset.key,
                        maxItemsPerQuery: 50,
                      });
                      setPresetModal(true);
                    }}
                  >
                    导入这个预设包
                  </Button>
                </Space>
              </Card>
            </Col>
          ))}
        </Row>
      </Card>

      <Card title="高级模式：关键词搜索预览" style={{ marginBottom: 16 }}>
        <Alert
          message="适合补单个食物，不适合建库"
          description="只有在你明确知道要查某个食物时，才建议使用关键词预览。大规模导入请优先用上面的预设包。"
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
        />
        <Space>
          <Input
            placeholder="输入英文食物名称搜索..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onPressEnter={handleSearch}
            style={{ width: 400 }}
            prefix={<SearchOutlined />}
          />
          <Button
            type="primary"
            onClick={handleSearch}
            loading={searchLoading}
            icon={<SearchOutlined />}
          >
            搜索预览
          </Button>
          <Button
            onClick={handleImport}
            icon={<DatabaseOutlined />}
            disabled={!searchQuery.trim()}
            loading={importUsda.isPending}
          >
            关键词导入
          </Button>
        </Space>
      </Card>

      {/* 搜索结果 */}
      {searchResult && (
        <Card
          title={`搜索结果（共 ${searchResult.totalHits} 条，显示前 ${searchResult.foods.length} 条）`}
        >
          <Table
            dataSource={searchResult.foods}
            columns={columns}
            rowKey="fdcId"
            pagination={false}
            scroll={{ y: 500 }}
            size="small"
          />
        </Card>
      )}

      {/* 导入结果 */}
      {importResult && (
        <Card title="最近导入结果" style={{ marginTop: 16 }}>
          <Descriptions column={3}>
            <Descriptions.Item label="总数">{importResult.total}</Descriptions.Item>
            <Descriptions.Item label="新增">
              <Tag color="green">{importResult.created}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="更新">
              <Tag color="blue">{importResult.updated}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="跳过">
              <Tag>{importResult.skipped}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="错误">
              <Tag color="red">{importResult.errors}</Tag>
            </Descriptions.Item>
          </Descriptions>
          {importResult.details?.length > 0 && (
            <div
              style={{
                marginTop: 12,
                maxHeight: 200,
                overflow: 'auto',
                background: '#f5f5f5',
                padding: 12,
                borderRadius: 4,
              }}
            >
              {importResult.details.map((d: string, i: number) => (
                <div key={i}>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {d}
                  </Text>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* 导入弹窗 */}
      <Modal
        title="批量导入 USDA 数据"
        open={importModal}
        onCancel={() => setImportModal(false)}
        onOk={() => form.validateFields().then((v) => importUsda.mutate(v))}
        confirmLoading={importUsda.isPending}
      >
        <Form form={form} layout="vertical" initialValues={{ maxItems: 50 }}>
          <Form.Item name="query" label="搜索关键词" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="maxItems" label="最大导入数量" extra="建议首次不超过 200 条">
            <InputNumber min={1} max={500} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="导入 USDA 预设包"
        open={presetModal}
        onCancel={() => setPresetModal(false)}
        onOk={() => presetForm.validateFields().then((v) => importUsdaPreset.mutate(v))}
        confirmLoading={importUsdaPreset.isPending}
      >
        <Form form={presetForm} layout="vertical" initialValues={{ maxItemsPerQuery: 50 }}>
          <Form.Item name="presetKey" label="预设包" rules={[{ required: true }]}>
            <Input disabled />
          </Form.Item>
          <Form.Item
            name="maxItemsPerQuery"
            label="每组查询词导入上限"
            extra="每个预设包会包含多组查询词，系统会自动聚合并去重"
          >
            <InputNumber min={1} max={200} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default UsdaImportPage;
