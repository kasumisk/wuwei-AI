import { PdfMergeSplit } from '@/components/features/pdf-merge-split';
import { generateToolMetadata, ToolJsonLd } from '@/lib/seo/tool-seo';

export async function generateMetadata() {
  return generateToolMetadata('pdf-merge-split');
}

export default function PdfMergeSplitPage() {
  return (
    <div className="container mx-auto py-8 px-4">
      <ToolJsonLd toolSlug="pdf-merge-split" />
      <PdfMergeSplit />
    </div>
  );
}
