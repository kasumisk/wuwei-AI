import { QRCodeGenerator } from '@/page-components/tools/qrcode-generator';
import { generateToolMetadata, ToolJsonLd } from '@/lib/seo/tool-seo';

export async function generateMetadata() {
  return generateToolMetadata('qrcode');
}

export default function QRCodePage() {
  return (
    <div className="container mx-auto py-8 px-4 max-w-6xl">
      <ToolJsonLd toolSlug="qrcode" />
      <QRCodeGenerator />
    </div>
  );
}
