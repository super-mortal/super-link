import { useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button.tsx';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card.tsx';
import { Spinner } from '@/components/ui/spinner.tsx';
import { Textarea } from '@/components/ui/textarea.tsx';

/** 长度上限与后端 ServerPayload 对齐（MAX_NOTE_LENGTH = 2000），前端先拦 */
const MAX_NOTE_LENGTH = 2000;

type ServerNoteCardProps = {
  note: string;
  /**
   * 保存备注（空串等价清空——后端 optionalText 允许空串，列 NOT NULL DEFAULT ''）。
   * 返回是否成功：失败时调用方已按后端 message toast，卡片保留编辑态供重试。
   */
  onSave: (note: string) => Promise<boolean>;
};

/**
 * 备注卡（PRD §5.5 / refinements §3，原型 srv-detail-main 的备注卡）。
 * 常驻展示：空备注给「还没有备注」+ 添加入口，有备注给内容 + 编辑入口；
 * 编辑态为内联 textarea + 保存 / 取消，不做自动保存 / 防抖（保存由页面接线到 updateServer）。
 * 服务器备注是明文列（servers.note，非账号库那样的密文字段），直接展示、保留换行。
 */
export const ServerNoteCard = ({ note, onSave }: ServerNoteCardProps) => {
  const [editing, setEditing] = useState(false);
  /** 编辑草稿：进入编辑态时灌入当前值，取消即丢弃——期间 30s 轮询刷新 note 不影响草稿 */
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  const hasNote = note.trim() !== '';

  const startEdit = () => {
    setDraft(note);
    setEditing(true);
  };

  /**
   * 取消只退出编辑态：不写库、不 toast（保存成功提示由 updateServer 的响应 message 负责）。
   * 保存失败保持编辑态，用户改完可直接重试。
   */
  const handleSave = async () => {
    if (saving) {
      return;
    }
    setSaving(true);

    try {
      const ok = await onSave(draft);
      if (ok) {
        setEditing(false);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">备注</CardTitle>
        {!editing ? (
          <CardAction>
            <Button variant="ghost" size="sm" onClick={startEdit}>
              {hasNote ? <Pencil /> : <Plus />}
              {hasNote ? '编辑' : '添加'}
            </Button>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent>
        {editing ? (
          <div className="flex flex-col gap-3">
            <Textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              rows={3}
              maxLength={MAX_NOTE_LENGTH}
              placeholder="用途、位置等（可选）；留空保存即清空备注"
              disabled={saving}
              autoFocus
              className="max-h-40 min-h-16"
            />
            <div className="flex items-center justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setEditing(false)} disabled={saving}>
                取消
              </Button>
              <Button type="button" size="sm" onClick={() => void handleSave()} disabled={saving}>
                {saving && <Spinner />}
                {saving ? '保存中…' : '保存'}
              </Button>
            </div>
          </div>
        ) : hasNote ? (
          <p className="text-[13px] leading-6 break-all whitespace-pre-line">{note}</p>
        ) : (
          <span className="text-muted-foreground text-sm">还没有备注</span>
        )}
      </CardContent>
    </Card>
  );
};
