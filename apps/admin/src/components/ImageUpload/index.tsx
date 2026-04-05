import React, { useState } from 'react';
import { Upload, message } from 'antd';
import { PlusOutlined, LoadingOutlined } from '@ant-design/icons';
import type { UploadProps, UploadFile } from 'antd';
import { useUploadImage, type UploadParams } from '@/services/admin';

interface ImageUploadProps {
  value?: string;
  onChange?: (value: string | undefined) => void;
  disabled?: boolean;
  maxCount?: number;
  accept?: string;
  listType?: 'text' | 'picture' | 'picture-card' | 'picture-circle';
  category?: UploadParams['category'];
}

const ImageUpload: React.FC<ImageUploadProps> = ({
  value,
  onChange,
  disabled = false,
  maxCount = 1,
  accept = 'image/*',
  listType = 'picture-card',
  category = 'image' as UploadParams['category'],
}) => {
  const [loading, setLoading] = useState(false);
  
  const uploadMutation = useUploadImage({
    onSuccess: (response) => {
      setLoading(false);
      onChange?.(response.url);
      message.success('上传成功');
    },
    onError: (error) => {
      setLoading(false);
      message.error(`上传失败: ${error.message}`);
    },
  });

  const handleUpload: UploadProps['beforeUpload'] = (file) => {
    // 文件类型检查
    const isImage = file.type.startsWith('image/');
    if (!isImage) {
      message.error('只能上传图片文件!');
      return false;
    }

    // 文件大小检查 (5MB)
    const isLt5M = file.size / 1024 / 1024 < 5;
    if (!isLt5M) {
      message.error('图片大小不能超过 5MB!');
      return false;
    }

    setLoading(true);
    uploadMutation.mutate({ file, category });
    return false; // 阻止默认上传
  };

  const handleRemove = () => {
    onChange?.(undefined);
    return true;
  };

  // 构造fileList
  const fileList: UploadFile[] = value ? [
    {
      uid: '1',
      name: 'image',
      status: 'done',
      url: value,
    }
  ] : [];

  const uploadButton = (
    <div>
      {loading ? <LoadingOutlined /> : <PlusOutlined />}
      <div style={{ marginTop: 8 }}>Upload</div>
    </div>
  );

  return (
    <Upload
      name="file"
      listType={listType}
      fileList={fileList}
      beforeUpload={handleUpload}
      onRemove={handleRemove}
      disabled={disabled || loading}
      maxCount={maxCount}
      accept={accept}
      showUploadList={{
        showPreviewIcon: false,
        showRemoveIcon: !disabled,
      }}
    >
      {fileList.length >= maxCount ? null : uploadButton}
    </Upload>
  );
};

export default ImageUpload;