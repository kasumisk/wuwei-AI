# RESTful API 统一接口封装使用指南

## 🎯 技术方案

我们采用 **Axios + @tanstack/react-query** 的组合方案：

- ✅ **Axios**: 处理 HTTP 请求、拦截器、错误处理
- ✅ **React Query**: 处理数据获取、缓存、状态管理、重试机制

## 📁 架构设计

```
src/
├── utils/
│   └── request.ts          # Axios 封装
├── services/
│   ├── userService.ts      # 用户相关 API + Hooks
│   ├── postService.ts      # 文章相关 API + Hooks
│   └── ...                 # 其他业务模块
└── pages/
    └── user-management/    # 使用示例
```

## 🔧 核心特性

### 1. 统一的请求响应处理

```typescript
// 响应格式统一
interface ApiResponse<T> {
  code: number;
  data: T;
  message: string;
  success: boolean;
}

// 分页响应格式
interface PageResponse<T> {
  list: T[];
  total: number;
  page: number;
  pageSize: number;
}
```

### 2. 完善的错误处理

```typescript
// 自动处理各种错误情况
- 401: 自动跳转登录页
- 403: 权限不足提示
- 404: 资源不存在
- 500: 服务器错误
- 超时: 请求超时重试
```

### 3. 智能缓存管理

```typescript
// 查询键工厂，统一管理缓存键
export const queryKeys = {
  users: ['users'] as const,
  userList: (params?: PageParams) => [...queryKeys.users, 'list', params] as const,
  userDetail: (id: string) => [...queryKeys.users, 'detail', id] as const,
};
```

## 📝 使用示例

### 1. 基础 API 定义

```typescript
// 在 services/userService.ts 中定义
export const userApi = {
  // 获取用户列表
  getUsers: (params?: PageParams): Promise<PageResponse<User>> =>
    request.get<PageResponse<User>>('/users', params),

  // 获取用户详情
  getUserById: (id: string): Promise<User> =>
    request.get<User>(`/users/${id}`),

  // 创建用户
  createUser: (data: CreateUserParams): Promise<User> =>
    request.post<User>('/users', data),
};
```

### 2. React Query Hooks

```typescript
// 查询 Hook
export const useUsers = (params?: PageParams) => {
  return useQuery({
    queryKey: queryKeys.userList(params),
    queryFn: () => userApi.getUsers(params),
    staleTime: 5 * 60 * 1000, // 5分钟缓存
  });
};

// 变更 Hook
export const useCreateUser = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: userApi.createUser,
    onSuccess: () => {
      // 创建成功后自动刷新列表
      queryClient.invalidateQueries({ queryKey: queryKeys.users });
    },
  });
};
```

### 3. 在组件中使用

```typescript
const UserManagement = () => {
  const [pagination, setPagination] = useState({ page: 1, pageSize: 10 });
  
  // 获取数据
  const { data, isLoading, error, refetch } = useUsers(pagination);
  
  // 删除操作
  const deleteUser = useDeleteUser({
    onSuccess: () => message.success('删除成功'),
  });
  
  return (
    <Table
      dataSource={data?.list}
      loading={isLoading}
      pagination={{
        current: pagination.page,
        total: data?.total,
        onChange: (page, pageSize) => setPagination({ page, pageSize }),
      }}
    />
  );
};
```

## 🚀 高级功能

### 1. 乐观更新

```typescript
const useUpdateUser = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: userApi.updateUser,
    onMutate: async (variables) => {
      // 取消正在进行的查询
      await queryClient.cancelQueries({ queryKey: queryKeys.userDetail(variables.id) });
      
      // 获取当前数据
      const previousUser = queryClient.getQueryData(queryKeys.userDetail(variables.id));
      
      // 乐观更新
      queryClient.setQueryData(queryKeys.userDetail(variables.id), {
        ...previousUser,
        ...variables,
      });
      
      return { previousUser };
    },
    onError: (error, variables, context) => {
      // 错误时回滚
      if (context?.previousUser) {
        queryClient.setQueryData(queryKeys.userDetail(variables.id), context.previousUser);
      }
    },
  });
};
```

### 2. 预取数据

```typescript
const { prefetchUser } = useUserMutations();

// 鼠标悬停时预取数据
<a onMouseEnter={() => prefetchUser(userId)}>
  {username}
</a>
```

### 3. 并行查询

```typescript
const UserDashboard = ({ userId }: { userId: string }) => {
  // 并行获取多个数据
  const userQuery = useUser(userId);
  const postsQuery = useUserPosts(userId);
  const statsQuery = useUserStats(userId);
  
  if (userQuery.isLoading || postsQuery.isLoading || statsQuery.isLoading) {
    return <Loading />;
  }
  
  return (
    <div>
      <UserInfo user={userQuery.data} />
      <UserPosts posts={postsQuery.data} />
      <UserStats stats={statsQuery.data} />
    </div>
  );
};
```

### 4. 无限滚动

```typescript
export const useInfiniteUsers = () => {
  return useInfiniteQuery({
    queryKey: queryKeys.users,
    queryFn: ({ pageParam = 1 }) => userApi.getUsers({ page: pageParam }),
    getNextPageParam: (lastPage, pages) => {
      return lastPage.list.length === 10 ? pages.length + 1 : undefined;
    },
  });
};
```

## 🎛️ 配置选项

### 1. 环境变量配置

```bash
# .env.development
VITE_API_BASE_URL=http://localhost:8080/api

# .env.production
VITE_API_BASE_URL=https://api.example.com
```

### 2. 全局 React Query 配置

```typescript
// 在 main.tsx 中
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,                    // 重试次数
      staleTime: 5 * 60 * 1000,   // 5分钟缓存
      refetchOnWindowFocus: false, // 窗口聚焦时不重新获取
    },
    mutations: {
      retry: 0,                    // 变更操作不重试
    },
  },
});
```

## 📊 性能优化

### 1. 智能缓存策略

- **列表查询**: 5分钟缓存
- **详情查询**: 10分钟缓存
- **用户操作**: 立即更新相关缓存

### 2. 网络优化

- **请求去重**: 相同请求自动去重
- **并发控制**: 自动管理并发请求
- **离线重试**: 网络恢复后自动重试

### 3. 内存管理

- **自动垃圾回收**: 不活跃数据自动清理
- **缓存大小限制**: 防止内存溢出
- **查询失效**: 数据变更后自动失效相关查询

## 🛠️ 调试工具

### 1. React Query DevTools

```typescript
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';

// 开发环境启用调试工具
{import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
```

### 2. 请求日志

在开发环境自动打印请求和响应信息，方便调试。

## 🎯 最佳实践

1. ✅ **使用 TypeScript**: 完整的类型定义
2. ✅ **查询键工厂**: 统一管理缓存键
3. ✅ **错误边界**: 优雅的错误处理
4. ✅ **Loading 状态**: 友好的加载提示
5. ✅ **乐观更新**: 提升用户体验
6. ✅ **数据预取**: 减少等待时间

通过这套封装方案，可以大大提高开发效率，减少样板代码，提供更好的用户体验！🚀