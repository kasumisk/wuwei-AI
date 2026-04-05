import { PdfToText } from '@/components/features/pdf-to-text';
import { generateToolMetadata, ToolJsonLd } from '@/lib/seo/tool-seo';

export async function generateMetadata() {
  return generateToolMetadata('pdf-to-text');
}

export default function PdfToTextPage() {
  return (
    <div className="container mx-auto py-8 px-4">
      <ToolJsonLd toolSlug="pdf-to-text" />
      <PdfToText />
    </div>
  );
}
