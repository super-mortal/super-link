import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card.tsx';

type ServerNoteCardProps = {
  note: string;
};

/**
 * 备注卡（PRD §5.5，原型 srv-detail-main 的备注卡）。
 * 服务器备注是明文列（servers.note，非账号库那样的密文字段），直接展示、保留换行；
 * 无备注时给占位文案（与账号库备注卡同款处理）。
 */
export const ServerNoteCard = ({ note }: ServerNoteCardProps) => (
  <Card>
    <CardHeader>
      <CardTitle className="text-base">备注</CardTitle>
    </CardHeader>
    <CardContent>
      {note.trim() ? (
        <p className="text-[13px] leading-6 break-all whitespace-pre-line">{note}</p>
      ) : (
        <span className="text-muted-foreground text-sm">暂无备注</span>
      )}
    </CardContent>
  </Card>
);
