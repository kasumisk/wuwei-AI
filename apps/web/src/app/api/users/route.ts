import { NextResponse } from 'next/server';

// 模拟用户数据
const users = [
  { id: '1', name: 'Alice', email: 'alice@example.com', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: '2', name: 'Bob', email: 'bob@example.com', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
];

export async function GET() {
  return NextResponse.json({
    success: true,
    data: users,
  });
}

export async function POST(request: Request) {
  const body = await request.json();
  
  const newUser = {
    id: String(users.length + 1),
    ...body,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  
  users.push(newUser);
  
  return NextResponse.json({
    success: true,
    data: newUser,
  });
}
