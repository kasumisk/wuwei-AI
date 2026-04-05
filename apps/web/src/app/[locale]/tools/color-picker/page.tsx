import { ColorPicker } from '@/page-components/tools/color-picker';
import { generateToolMetadata, ToolJsonLd } from '@/lib/seo/tool-seo';

export async function generateMetadata() {
  return generateToolMetadata('color-picker');
}

export default function ColorPickerPage() {
  return (
    <div className="container mx-auto py-8 px-4">
      <ToolJsonLd toolSlug="color-picker" />
      <ColorPicker />
    </div>
  );
}
