import { useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card.tsx';

type AccountNotesCardProps = {
  /** 备注明文（解密成功才非 null）；只从调用方内存传入 */
  notes: string | null;
  pending: boolean;
  error: string | null;
  loadNotes: () => Promise<void>;
};

/**
 * 备注区（PRD §10.4）：保留换行展示（whitespace-pre-line），编辑入口在 task12 接入。
 *
 * 备注在详情页挂载后即按需解密：掩码要求只针对密码（PRD §7.4），备注按 §10.4
 * 作为正文直接展示；解密结果同样走 vaultSession 的 60 秒内存缓存。
 */
export const AccountNotesCard = ({ notes, pending, error, loadNotes }: AccountNotesCardProps) => {
  useEffect(() => {
    void loadNotes();
  }, [loadNotes]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">备注</CardTitle>
      </CardHeader>
      <CardContent>
        {pending && notes === null ? <span className="text-muted-foreground text-sm">解密中…</span> : null}
        {error ? <p className="text-destructive text-sm">{error}</p> : null}
        {notes !== null && !error ? (
          notes.trim() ? (
            <p className="text-[13px] leading-6 break-all whitespace-pre-line">{notes}</p>
          ) : (
            <span className="text-muted-foreground text-sm">暂无备注</span>
          )
        ) : null}
      </CardContent>
    </Card>
  );
};
