'use client';

import { useUsers } from '@/lib/hooks/use-users';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export function UsersExample() {
  const { data: users, isLoading, error } = useUsers();

  if (isLoading) {
    return <div className="text-center">Loading users...</div>;
  }

  if (error) {
    return <div className="text-center text-destructive">Error loading users</div>;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Users (React Query Example)</CardTitle>
        <CardDescription>
          Fetched from /api/users using @tanstack/react-query
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {users?.map((user: { id: string; name: string; email: string }) => (
            <div
              key={user.id}
              className="flex items-center justify-between rounded-lg border border-[--color-border] p-3"
            >
              <div>
                <p className="font-medium">{user.name}</p>
                <p className="text-sm text-[--color-muted-foreground]">{user.email}</p>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
