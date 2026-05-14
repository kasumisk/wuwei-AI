export default function ShareLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-[#050807] text-white antialiased">{children}</body>
    </html>
  );
}
