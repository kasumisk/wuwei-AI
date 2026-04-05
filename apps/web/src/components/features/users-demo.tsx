'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useUsers, useCreateUser } from '@/lib/hooks/use-api';
import { Loader2 } from 'lucide-react';

export function UsersDemo() {
  const { data, isLoading, error } = useUsers();
  const createUser = useCreateUser();

  const handleCreateUser = () => {
    createUser.mutate({
      name: 'New User',
      email: `user${Date.now()}@example.com`,
    });
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center p-6">
          <Loader2 className="h-6 w-6 animate-spin" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="p-6 text-destructive">
          Error: {error.message}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>React Query Demo</CardTitle>
        <CardDescription>
          实时用户数据获取和缓存
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          {data?.data?.map((user: { id: string; name: string; email: string }) => (
            <div
              key={user.id}
              className="flex items-center justify-between rounded-md border p-3"
            >
              <div>
                <p className="font-medium">{user.name}</p>
                <p className="text-sm text-muted-foreground">{user.email}</p>
              </div>
            </div>
          ))}
        </div>
        <Button
          onClick={handleCreateUser}
          disabled={createUser.isPending}
          className="w-full"
        >
          {createUser.isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              创建中...
            </>
          ) : (
            '添加新用户'
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
