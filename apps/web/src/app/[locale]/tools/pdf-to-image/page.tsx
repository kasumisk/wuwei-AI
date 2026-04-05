import { PdfToImage } from '@/components/features/pdf-to-image';
import { generateToolMetadata, ToolJsonLd } from '@/lib/seo/tool-seo';

export async function generateMetadata() {
  return generateToolMetadata('pdf-to-image');
}

export default function PdfToImagePage() {
  return (
    <div className="container mx-auto py-8 px-4">
      <ToolJsonLd toolSlug="pdf-to-image" />
      <PdfToImage />
    </div>
  );
}
