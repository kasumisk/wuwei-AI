import { ImageToPdf } from '@/components/features/image-to-pdf';
import { generateToolMetadata, ToolJsonLd } from '@/lib/seo/tool-seo';

export async function generateMetadata() {
  return generateToolMetadata('image-to-pdf');
}

export default function ImageToPdfPage() {
  return (
    <div className="container mx-auto py-8 px-4">
      <ToolJsonLd toolSlug="image-to-pdf" />
      <ImageToPdf />
    </div>
  );
}
