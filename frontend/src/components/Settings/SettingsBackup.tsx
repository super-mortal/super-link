import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../ui/card';
import React, { useContext, useRef, useState } from 'react';
import { StoreContext } from '@/store/storeContext';
import { Spinner } from '@/components/ui/spinner.tsx';
import { Download, Upload } from 'lucide-react';

export const SettingsBackup = ({ onSuccess }: { onSuccess?: () => void }) => {
  const store = useContext(StoreContext);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const handleExport = async () => {
    setIsExporting(true);
    await store.exportData();
    setIsExporting(false);
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    setSelectedFile(file);
  };

  const handleImport = async () => {
    setIsImporting(true);
    const success = await store.importData(selectedFile);
    setSelectedFile(null);
    if (inputRef.current) {
      inputRef.current.value = '';
    }
    setIsImporting(false);

    if (success && onSuccess) {
      onSuccess();
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">导出数据</CardTitle>
          <CardDescription>将所有标签和书签导出为 JSON 备份文件。</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-900/20">
            <ul className="ml-4 list-disc space-y-2 text-sm">
              <li>导出内容包括所有标签及其层级关系、颜色和固定状态。</li>
              <li>导出内容包括所有书签及其标题、网址、描述、备注和标签关联。</li>
              <li>导出的 JSON 文件可用于后续的数据恢复。</li>
            </ul>
          </div>
        </CardContent>
        <CardFooter>
          <Button className="w-full" onClick={handleExport} disabled={isExporting}>
            {isExporting && <Spinner />}
            <Download className="mr-2 h-4 w-4" />
            导出备份
          </Button>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">导入数据</CardTitle>
          <CardDescription>从之前导出的 JSON 备份文件中恢复数据。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3">
            <Label htmlFor="backup-json">JSON 备份文件</Label>
            <Input
              id="backup-json"
              accept=".json"
              type="file"
              ref={inputRef}
              onChange={handleFileChange}
              disabled={isImporting}
            />
            <p className="text-muted-foreground text-sm">选择之前导出的 JSON 备份文件。</p>
          </div>

          <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-900/20">
            <ul className="ml-4 list-disc space-y-2 text-sm">
              <li>将恢复所有标签及其层级关系、颜色和固定状态。</li>
              <li>将恢复所有书签及其标题、网址、描述、备注和标签关联。</li>
              <li>如果标签名称与现有标签重复，将自动跳过。</li>
            </ul>
          </div>
        </CardContent>
        <CardFooter>
          <Button className="w-full" onClick={handleImport} disabled={!selectedFile || isImporting}>
            {isImporting && <Spinner />}
            <Upload className="mr-2 h-4 w-4" />
            导入备份
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
};
