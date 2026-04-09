import React, { useState } from 'react';
import {
  Card,
  Button,
  Space,
  message,
  Upload,
  Input,
  Typography,
  Alert,
  Tag,
  Table,
  Divider,
  Row,
  Col,
} from 'antd';
import { PictureOutlined, UploadOutlined, LinkOutlined, CameraOutlined } from '@ant-design/icons';
import type { UploadFile } from 'antd';
import {
  useRecognizeImage,
  useRecognizeImageByUrl,
  type ImageRecognitionResult,
} from '@/services/foodPipelineService';

export const routeConfig = {
  name: 'image-recognition',
  title: '图片识别',
  icon: 'CameraOutlined',
  order: 7,
  requireAuth: true,
  hideInMenu: false,
};

const { Title, Text } = Typography;

const ImageRecognitionPage: React.FC = () => {
  const [imageUrl, setImageUrl] = useState('');
  const [result, setResult] = useState<ImageRecognitionResult | null>(null);
  const [previewSrc, setPreviewSrc] = useState<string>('');

  const recognizeImage = useRecognizeImage({
    onSuccess: (data) => {
      setResult(data);
      message.success('识别完成');
    },
    onError: (e) => message.error(`识别失败: ${e.message}`),
  });

  const recognizeByUrl = useRecognizeImageByUrl({
    onSuccess: (data) => {
      setResult(data);
      message.success('识别完成');
    },
    onError: (e) => message.error(`识别失败: ${e.message}`),
  });

  const handleUpload = (file: File) => {
    // Preview
    const reader = new FileReader();
    reader.onload = (e) => setPreviewSrc(e.target?.result as string);
    reader.readAsDataURL(file);
    recognizeImage.mutate(file);
    return false;
  };

  const handleUrlRecognize = () => {
    if (!imageUrl.trim()) {
      message.warning('请输入图片 URL');
      return;
    }
    setPreviewSrc(imageUrl);
    recognizeByUrl.mutate(imageUrl);
  };

  const resultColumns = [
    {
      title: '食物名称',
      dataIndex: 'name',
      key: 'name',
      render: (v: string) => <Tag color="blue">{v}</Tag>,
    },
    {
      title: '置信度',
      dataIndex: 'confidence',
      key: 'confidence',
      render: (v: number) => (
        <Tag color={v > 0.8 ? 'green' : v > 0.5 ? 'orange' : 'red'}>{(v * 100).toFixed(1)}%</Tag>
      ),
    },
    {
      title: '估算热量',
      dataIndex: 'estimatedCalories',
      key: 'estimatedCalories',
      render: (v: number) => (v ? `${v} kcal` : '-'),
    },
    {
      title: '估算份量',
      dataIndex: 'estimatedPortion',
      key: 'estimatedPortion',
      render: (v: string) => v || '-',
    },
  ];

  return (
    <div>
      <Alert
        message="食物图片识别（VLM API）"
        description="上传食物图片或提供图片 URL，使用视觉语言模型（DeepSeek-VL / GPT-4o-mini）识别图片中的食物，并估算热量和份量。需要配置 FOOD_IMAGE_PROVIDER 环境变量。"
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
      />

      <Row gutter={[16, 16]}>
        {/* 上传图片 */}
        <Col xs={24} md={12}>
          <Card
            title={
              <Space>
                <UploadOutlined /> 上传图片识别
              </Space>
            }
          >
            <Upload.Dragger
              accept="image/*"
              showUploadList={false}
              beforeUpload={handleUpload}
              disabled={recognizeImage.isPending}
            >
              <p className="ant-upload-drag-icon">
                <PictureOutlined style={{ fontSize: 48, color: '#1890ff' }} />
              </p>
              <p className="ant-upload-text">点击或拖拽图片到此区域</p>
              <p className="ant-upload-hint">支持 JPG、PNG、WebP 格式</p>
            </Upload.Dragger>
          </Card>
        </Col>

        {/* URL 识别 */}
        <Col xs={24} md={12}>
          <Card
            title={
              <Space>
                <LinkOutlined /> URL 图片识别
              </Space>
            }
          >
            <Space direction="vertical" style={{ width: '100%' }}>
              <Input
                placeholder="输入图片 URL"
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                prefix={<LinkOutlined />}
                onPressEnter={handleUrlRecognize}
              />
              <Button
                type="primary"
                onClick={handleUrlRecognize}
                loading={recognizeByUrl.isPending}
                icon={<CameraOutlined />}
                block
              >
                开始识别
              </Button>
            </Space>
          </Card>
        </Col>
      </Row>

      {/* 预览和结果 */}
      {(previewSrc || result) && (
        <Card title="识别结果" style={{ marginTop: 16 }}>
          <Row gutter={[16, 16]}>
            {previewSrc && (
              <Col xs={24} md={8}>
                <img
                  src={previewSrc}
                  alt="food preview"
                  style={{
                    width: '100%',
                    maxHeight: 300,
                    objectFit: 'contain',
                    borderRadius: 8,
                    border: '1px solid #f0f0f0',
                  }}
                />
              </Col>
            )}
            <Col xs={24} md={previewSrc ? 16 : 24}>
              {recognizeImage.isPending || recognizeByUrl.isPending ? (
                <div style={{ textAlign: 'center', padding: 40 }}>
                  <CameraOutlined style={{ fontSize: 32, color: '#1890ff' }} spin />
                  <div style={{ marginTop: 8 }}>
                    <Text type="secondary">正在识别中...</Text>
                  </div>
                </div>
              ) : result?.foods?.length ? (
                <Table
                  dataSource={result.foods}
                  columns={resultColumns}
                  rowKey="name"
                  pagination={false}
                  size="small"
                />
              ) : result ? (
                <div style={{ textAlign: 'center', padding: 40 }}>
                  <Text type="secondary">未识别到食物</Text>
                </div>
              ) : null}
            </Col>
          </Row>
        </Card>
      )}
    </div>
  );
};

export default ImageRecognitionPage;
