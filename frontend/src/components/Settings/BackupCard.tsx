import * as React from 'react';
import { Download, Upload } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';

/**
 * 备份板块卡片原语（refinements §4.1）。
 *
 * 纯展示组件：不读 store、不发请求，导出 / 恢复由调用方注入回调，
 * 条数也由调用方按各自数据源算好传入（书签 / Skill / 服务器 / 账号库来源不同）。
 *
 * - `notice` 用于服务器卡片的「含 Token 凭据」告警，配色交给调用方用语义 token 决定；
 * - `children` 用于账号库卡片承载既有的 VaultTransferCard（加密导出导入不重写一份），
 *   传了 children 且不传 onExport / onRestore 时，卡片自身不渲染操作行，避免重复按钮。
 */
export type BackupCardProps = {
  icon: React.ReactNode;
  title: string;
  description: React.ReactNode;
  /** 当前条数，与 countUnit 组成右上角徽章 */
  count: number;
  countUnit: string;
  onExport?: () => void;
  isExporting?: boolean;
  exportDisabled?: boolean;
  onRestore?: () => void;
  restoreDisabled?: boolean;
  notice?: React.ReactNode;
  children?: React.ReactNode;
};

export const BackupCard = ({
  icon,
  title,
  description,
  count,
  countUnit,
  onExport,
  isExporting = false,
  exportDisabled = false,
  onRestore,
  restoreDisabled = false,
  notice,
  children,
}: BackupCardProps) => {
  const hasActions = Boolean(onExport || onRestore);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-lg">
          <span className="text-muted-foreground flex items-center [&_svg]:size-4">{icon}</span>
          <span>{title}</span>
          <Badge variant="secondary" className="ml-auto font-normal">
            {count} {countUnit}
          </Badge>
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {notice}
        {hasActions && (
          <div className="flex flex-wrap gap-2">
            {onExport && (
              <Button variant="outline" onClick={onExport} disabled={exportDisabled || isExporting}>
                {isExporting && <Spinner />}
                <Download className="mr-2 h-4 w-4" />
                导出备份
              </Button>
            )}
            {onRestore && (
              <Button variant="outline" onClick={onRestore} disabled={restoreDisabled}>
                <Upload className="mr-2 h-4 w-4" />
                恢复
              </Button>
            )}
          </div>
        )}
        {children}
      </CardContent>
    </Card>
  );
};
