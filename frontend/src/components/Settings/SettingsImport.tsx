import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import React, { useContext, useRef, useState } from 'react';
import { StoreContext } from '@/store/storeContext';
import {
  IconBrandChrome,
  IconBrandEdge,
  IconBrandFirefox,
  IconBrandPocket,
  IconBrandSafari,
  IconCloud,
} from '@tabler/icons-react';
import { Spinner } from '@/components/ui/spinner.tsx';

enum ImportSource {
  POCKET = 'Pocket',
  BROWSER = 'Browser',
  RAINDROP_IO = 'Raindrop.io',
}

export const SettingsImport = ({ onSuccess }: { onSuccess?: () => void }) => {
  const store = useContext(StoreContext);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<ImportSource>(ImportSource.BROWSER);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    setSelectedFile(file);
  };

  const submit = async () => {
    let success;
    setIsLoading(true);

    if (activeTab === ImportSource.POCKET) {
      success = await store.importPocketBookmarks(selectedFile);
    } else if (activeTab === ImportSource.BROWSER) {
      success = await store.importBrowserBookmarks(selectedFile);
    } else if (activeTab === ImportSource.RAINDROP_IO) {
      success = await store.importRaindropIoBookmarks(selectedFile);
    }

    setIsLoading(false);

    if (success && onSuccess) {
      onSuccess();
    }
  };

  const resetFile = () => {
    setSelectedFile(null);
    if (inputRef.current) {
      inputRef.current.value = '';
    }
  };

  const handleTabChange = (value: ImportSource) => {
    setActiveTab(value);
    resetFile();
  };

  return (
    <Card className="touch-pan-y">
      <CardHeader>
        <CardTitle className="text-lg">导入书签</CardTitle>
        <CardDescription>将书签导入到 Super-Link。</CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs value={activeTab} onValueChange={handleTabChange}>
          <TabsList className="@container/tablist h-auto w-full items-stretch">
            <TabsTrigger value={ImportSource.BROWSER} className="flex flex-col flex-wrap @sm/tablist:flex-row">
              <div className="inline-flex items-center gap-0.5">
                <IconBrandChrome className="h-4 w-4" />
              </div>
              <span>
                <span className="hidden @lg/tablist:inline">从</span> 浏览器
              </span>
            </TabsTrigger>
            <TabsTrigger value={ImportSource.RAINDROP_IO} className="flex flex-col flex-wrap @sm/tablist:flex-row">
              <div className="inline-flex items-center gap-0.5">
                <IconCloud className="h-4 w-4" />
              </div>
              <span>
                <span className="hidden @lg/tablist:inline">从</span> Raindrop.io
              </span>
            </TabsTrigger>
            <TabsTrigger value={ImportSource.POCKET} className="flex flex-col flex-wrap @sm/tablist:flex-row">
              <IconBrandPocket className="h-4 w-4" />
              <span>
                <span className="hidden @lg/tablist:inline">从</span> Pocket
              </span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value={ImportSource.POCKET} className="mt-4 space-y-4">
            <div className="space-y-3">
              <Label htmlFor="pocket-zip">Pocket ZIP 归档文件</Label>
              <Input
                id="pocket-zip"
                accept=".zip"
                type="file"
                ref={inputRef}
                onChange={handleFileChange}
                disabled={isLoading}
              />
              <p className="text-muted-foreground text-sm">选择您从 Pocket 导出的 ZIP 文件。</p>
            </div>

            <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-900/20">
              <div className="mb-2 flex items-center gap-2">
                <div className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-500">
                  <span className="text-xs font-semibold text-white">i</span>
                </div>
                <h3 className="text-lg font-semibold tracking-tight dark:text-blue-200">将导入以下内容：</h3>
              </div>
              <ul className="mt-3 ml-4 list-disc space-y-2 text-sm">
                <li>所有 Pocket 书签、标签、集合和备注。</li>
                <li>未读和已归档的书签将被分配到"状态"父标签下的相应标签。</li>
                <li>所有导入的书签将带有"从 Pocket 导入"标签。</li>
                <li>集合将被导入为"集合"父标签下的标签。</li>
                <li>集合描述将被保留为标签描述。</li>
                <li>集合书签备注将被保存为项目评论。</li>
              </ul>
            </div>
          </TabsContent>

          <TabsContent value={ImportSource.BROWSER} className="mt-4 space-y-4">
            <div className="space-y-3">
              <Label htmlFor="browser-bookmarks-html">书签 HTML 文件</Label>
              <Input
                id="browser-bookmarks-html"
                accept=".html,.htm"
                type="file"
                ref={inputRef}
                onChange={handleFileChange}
                disabled={isLoading}
              />
              <p className="text-muted-foreground text-sm">选择您的 HTML 格式导出的书签文件。</p>
              <p className="text-muted-foreground text-sm">
                支持 <IconBrandChrome className="ml-1 inline h-4 w-4 align-text-top" /> Chrome、
                <IconBrandFirefox className="ml-1 inline h-4 w-4 align-text-top" /> Firefox、
                <IconBrandSafari className="ml-1 inline h-4 w-4 align-text-top" /> Safari、
                <IconBrandEdge className="ml-1 inline h-4 w-4 align-text-top" /> Edge 以及大多数其他浏览器。
              </p>
            </div>

            <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-900/20">
              <div className="mb-2 flex items-center gap-2">
                <div className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-500">
                  <span className="text-xs font-semibold text-white">i</span>
                </div>
                <h3 className="text-lg font-semibold tracking-tight dark:text-blue-200">将导入以下内容：</h3>
              </div>
              <ul className="mt-3 ml-4 list-disc space-y-2 text-sm">
                <li>所有浏览器书签和文件夹。</li>
                <li>书签文件夹将被转换为标签。</li>
                <li>文件夹层级将被保留。嵌套文件夹将成为嵌套标签。</li>
                <li>所有书签将带有"从浏览器导入"标签。</li>
              </ul>
            </div>
          </TabsContent>

          <TabsContent value={ImportSource.RAINDROP_IO} className="mt-4 space-y-4">
            <div className="space-y-3">
              <Label htmlFor="raindropio-bookmarks-html">Raindrop.io HTML 文件</Label>
              <Input
                id="raindropio-bookmarks-html"
                accept=".html,.htm"
                type="file"
                ref={inputRef}
                onChange={handleFileChange}
                disabled={isLoading}
              />
              <p className="text-muted-foreground text-sm">选择您的 Raindrop.io 书签 HTML 文件。</p>
            </div>

            <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-900/20">
              <div className="mb-2 flex items-center gap-2">
                <div className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-500">
                  <span className="text-xs font-semibold text-white">i</span>
                </div>
                <h3 className="text-lg font-semibold tracking-tight dark:text-blue-200">将导入以下内容：</h3>
              </div>
              <ul className="mt-3 ml-4 list-disc space-y-2 text-sm">
                <li>所有 Raindrop.io 书签、集合和标签。</li>
                <li>书签集合将被转换为标签。</li>
                <li>所有书签将带有"从 Raindrop.io 导入"标签。</li>
              </ul>
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
      <CardFooter>
        <Button className="w-full" onClick={submit} disabled={!selectedFile || isLoading} type="submit">
          {isLoading && <Spinner />}
          导入 {activeTab} 书签
        </Button>
      </CardFooter>
    </Card>
  );
};
