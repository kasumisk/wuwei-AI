'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { userService, fileService, type User, type CreateUserDto } from '@/lib/api/services';
import { useToast } from '@/lib/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Client Component 示例 - 使用 React Query
 */
export function UserList() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // 查询用户列表
  const {
    data: response,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['users'],
    queryFn: () => userService.getUsers(),
  });

  // 创建用户
  const createMutation = useMutation({
    mutationFn: (data: CreateUserDto) => userService.createUser(data),
    onSuccess: () => {
      // 刷新列表
      queryClient.invalidateQueries({ queryKey: ['users'] });
      toast({
        title: '成功',
        description: '用户创建成功',
      });
    },
    onError: (error) => {
      toast({
        variant: 'destructive',
        title: '错误',
        description: error.message,
      });
    },
  });

  // 删除用户
  const deleteMutation = useMutation({
    mutationFn: (id: string) => userService.deleteUser(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      toast({
        title: '成功',
        description: '用户删除成功',
      });
    },
    onError: (error) => {
      toast({
        variant: 'destructive',
        title: '错误',
        description: error.message,
      });
    },
  });

  const handleCreateUser = () => {
    createMutation.mutate({
      name: '新用户',
      email: 'newuser@example.com',
      password: 'password123',
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-red-600">
        <p>加载失败: {error.message}</p>
      </div>
    );
  }

  const users = response?.data || [];

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-bold">用户列表</h2>
        <Button onClick={handleCreateUser} disabled={createMutation.isPending}>
          {createMutation.isPending ? '创建中...' : '创建用户'}
        </Button>
      </div>

      <div className="grid gap-4">
        {users.map((user: User) => (
          <div
            key={user.id}
            className="flex justify-between items-center border rounded-lg p-4"
          >
            <div>
              <h3 className="font-semibold">{user.name}</h3>
              <p className="text-sm text-gray-600">{user.email}</p>
            </div>
            <Button
              variant="destructive"
              onClick={() => deleteMutation.mutate(user.id)}
              disabled={deleteMutation.isPending}
            >
              删除
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * 文件上传示例
 */
export function FileUploadDemo() {
  const { toast } = useToast();
  const [uploadProgress, setUploadProgress] = useState(0);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const response = await fileService.uploadFile(file, (progress) => {
        setUploadProgress(progress);
      });

      toast({
        title: '上传成功',
        description: `文件已上传: ${response.data.filename}`,
      });

      setUploadProgress(0);
    } catch (error) {
      toast({
        variant: 'destructive',
        title: '上传失败',
        description: error instanceof Error ? error.message : '未知错误',
      });
      setUploadProgress(0);
    }
  };

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">文件上传</h2>
      <input type="file" onChange={handleFileChange} />
      {uploadProgress > 0 && (
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div
            className="bg-blue-600 h-2 rounded-full transition-all"
            style={{ width: `${uploadProgress}%` }}
          />
        </div>
      )}
    </div>
  );
}
