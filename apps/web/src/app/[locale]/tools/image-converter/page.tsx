import { ImageConverter } from '@/page-components/tools/image-converter';
import { generateToolMetadata, ToolJsonLd } from '@/lib/seo/tool-seo';

export async function generateMetadata() {
  return generateToolMetadata('image-converter');
}

export default function ImageConverterPage() {
  return (
    <div className="container mx-auto py-8 px-4">
      <ToolJsonLd toolSlug="image-converter" />
      <ImageConverter />
    </div>
  );
}
