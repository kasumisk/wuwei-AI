import { RegexTester } from '@/page-components/tools/regex-tester';
import { generateToolMetadata, ToolJsonLd } from '@/lib/seo/tool-seo';

export async function generateMetadata() {
  return generateToolMetadata('regex');
}

export default function RegexTesterPage() {
  return (
    <div className="container mx-auto py-8 px-4">
      <ToolJsonLd toolSlug="regex" />
      <RegexTester />
    </div>
  );
}
