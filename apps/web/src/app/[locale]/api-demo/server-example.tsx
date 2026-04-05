import { serverGet, serverPost } from '@/lib/api';
import type { User } from '@/lib/api/services';

/**
 * Server Component 示例
 * 在服务端组件中获取数据
 */
export default async function UserListPage() {
  // 在服务端直接调用 API
  const response = await serverGet<User[]>('/users').catch(() => null);
  
  if (!response) {
    return (
      <div className="container mx-auto p-6">
        <div className="text-red-600">
          <h1 className="text-xl font-bold">错误</h1>
          <p>加载用户列表失败</p>
        </div>
      </div>
    );
  }

  const users = response.data;

  return (
    <div className="container mx-auto p-6">
      <h1 className="text-2xl font-bold mb-4">用户列表</h1>
      <div className="grid gap-4">
        {users.map((user) => (
          <div key={user.id} className="border rounded-lg p-4">
            <h2 className="font-semibold">{user.name}</h2>
            <p className="text-gray-600">{user.email}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Server Action 示例
 */
export async function createUserAction(formData: FormData) {
  'use server';
  
  const name = formData.get('name') as string;
  const email = formData.get('email') as string;
  
  try {
    const response = await serverPost<User>('/users', {
      name,
      email,
    });
    
    return {
      success: true,
      data: response.data,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : '创建用户失败',
    };
  }
}
