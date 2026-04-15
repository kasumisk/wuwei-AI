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
} from 'antd';
import { SearchOutlined, CloudDownloadOutlined, DatabaseOutlined } from '@ant-design/icons';
import {
  foodPipelineApi,
  useImportUsda,
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
  const [form] = Form.useForm();

  const importUsda = useImportUsda({
    onSuccess: (result) => {
      setImportResult(result);
      message.success(`导入完成: 新增 ${result.created}, 更新 ${result.updated}`);
      setImportModal(false);
      form.resetFields();
    },
    onError: (e) => message.error(`导入失败: ${e.message}`),
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
          message="使用说明"
          description="1. 输入英文关键词搜索 USDA 数据库（如 chicken, rice, apple）。2. 预览搜索结果确认数据。3. 点击「批量导入」将数据导入到系统中，系统会自动清洗、去重和计算评分。"
          type="info"
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
            批量导入
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
    </div>
  );
};

export default UsdaImportPage;
