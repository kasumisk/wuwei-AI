import { ImageCropper } from '@/page-components/tools/image-cropper';
import { generateToolMetadata, ToolJsonLd } from '@/lib/seo/tool-seo';

export async function generateMetadata() {
  return generateToolMetadata('image-cropper');
}

export default function ImageCropperPage() {
  return (
    <div className="container mx-auto py-8 px-4">
      <ToolJsonLd toolSlug="image-cropper" />
      <ImageCropper />
    </div>
  );
}
