import { useTranslations } from 'next-intl';
import { UserList } from './client-example';
import { AppFileUploadDemo } from './upload-example';

export default function ApiDemoPage() {
  const t = useTranslations('apiDemo');

  return (
    <div className="container mx-auto p-6 space-y-8">
      <div>
        <h1 className="text-3xl font-bold mb-2">{t('title')}</h1>
        <p className="text-gray-600">{t('description')}</p>
      </div>

      <div className="border rounded-lg p-6">
        <h2 className="text-2xl font-bold mb-4">{t('fileUpload.title')}</h2>
        <p className="text-sm text-gray-600 mb-4">
          {t('fileUpload.description')}
        </p>
        <AppFileUploadDemo />
      </div>

      <div className="border rounded-lg p-6">
        <h2 className="text-2xl font-bold mb-4">{t('clientExample.title')}</h2>
        <p className="text-sm text-gray-600 mb-4">
          {t('clientExample.description')}
        </p>
        <UserList />
      </div>

      <div className="border rounded-lg p-6">
        <h2 className="text-2xl font-bold mb-4">{t('features.title')}</h2>
        <div className="grid md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <h3 className="font-semibold text-lg">{t('features.auth.title')}</h3>
            <ul className="text-sm text-gray-600 space-y-1">
              {(t.raw('features.auth.items') as string[]).map((item: string, i: number) => (
                <li key={i}>• {item}</li>
              ))}
            </ul>
          </div>

          <div className="space-y-2">
            <h3 className="font-semibold text-lg">{t('features.request.title')}</h3>
            <ul className="text-sm text-gray-600 space-y-1">
              {(t.raw('features.request.items') as string[]).map((item: string, i: number) => (
                <li key={i}>• {item}</li>
              ))}
            </ul>
          </div>

          <div className="space-y-2">
            <h3 className="font-semibold text-lg">{t('features.error.title')}</h3>
            <ul className="text-sm text-gray-600 space-y-1">
              {(t.raw('features.error.items') as string[]).map((item: string, i: number) => (
                <li key={i}>• {item}</li>
              ))}
            </ul>
          </div>

          <div className="space-y-2">
            <h3 className="font-semibold text-lg">{t('features.types.title')}</h3>
            <ul className="text-sm text-gray-600 space-y-1">
              {(t.raw('features.types.items') as string[]).map((item: string, i: number) => (
                <li key={i}>• {item}</li>
              ))}
            </ul>
          </div>

          <div className="space-y-2">
            <h3 className="font-semibold text-lg">{t('features.files.title')}</h3>
            <ul className="text-sm text-gray-600 space-y-1">
              {(t.raw('features.files.items') as string[]).map((item: string, i: number) => (
                <li key={i}>• {item}</li>
              ))}
            </ul>
          </div>

          <div className="space-y-2">
            <h3 className="font-semibold text-lg">{t('features.logging.title')}</h3>
            <ul className="text-sm text-gray-600 space-y-1">
              {(t.raw('features.logging.items') as string[]).map((item: string, i: number) => (
                <li key={i}>• {item}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      <div className="border rounded-lg p-6 bg-blue-50 dark:bg-blue-900/20">
        <h2 className="text-xl font-bold mb-2">{t('docs.title')}</h2>
        <p className="text-sm mb-4">
          {t('docs.description')}{' '}
          <code className="bg-black/10 px-2 py-1 rounded">API_GUIDE.md</code>
        </p>
        <div className="space-y-2 text-sm">
          <div>
            <strong>{t('docs.clientCall')}</strong>
            <pre className="bg-black/10 p-2 rounded mt-1 overflow-x-auto">
              {`import { clientGet } from '@/lib/api';
const response = await clientGet<User[]>('/users');`}
            </pre>
          </div>
          <div>
            <strong>{t('docs.serverCall')}</strong>
            <pre className="bg-black/10 p-2 rounded mt-1 overflow-x-auto">
              {`import { serverGet } from '@/lib/api';
const response = await serverGet<User[]>('/users');`}
            </pre>
          </div>
          <div>
            <strong>{t('docs.serviceLayer')}</strong>
            <pre className="bg-black/10 p-2 rounded mt-1 overflow-x-auto">
              {`import { userService } from '@/lib/api/services';
const response = await userService.getUsers();`}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
