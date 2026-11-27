import { useContext, useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { PlusIcon } from 'lucide-react';
import { Button } from '@/components/ui/button.tsx';
import { Input } from '@/components/ui/input.tsx';
import { StoreContext } from '@/store/storeContext.ts';

type TodoQuickAddProps = {
  /** 工具栏处于搜索态时隐藏（PRD §5.2） */
  searching: boolean;
};

/**
 * 待办快速录入（PRD §5.2，原型 todoQuick）。
 *
 * 单行输入 + 「添加」按钮，回车与按钮等价；空输入（trim 后）不提交。
 * 提交成功后清空输入并保持焦点，便于连续录入；失败保留原文（runRequest 已 toast 错误）。
 * 搜索态、或侧栏筛选「已完成」时整块隐藏，回到默认 / 未完成视图后恢复。
 */
export const TodoQuickAdd = observer(({ searching }: TodoQuickAddProps) => {
  const store = useContext(StoreContext);
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  /** 搜索中 / 已完成筛选下不提供录入入口（store.todoFilter 由侧栏概览维护） */
  const hidden = searching || store.todoFilter === 'done';

  // 进入待办模块（组件挂载）以及从隐藏态恢复时聚焦输入框，光标就位即可录入
  useEffect(() => {
    if (!hidden) {
      inputRef.current?.focus();
    }
  }, [hidden]);

  const submit = async () => {
    const trimmed = text.trim();
    // 空输入回车不产生记录（PRD §5.2 / 验收 3）
    if (!trimmed || submitting) {
      return;
    }

    setSubmitting(true);
    const todo = await store.createTodo(trimmed);
    setSubmitting(false);

    // 成功才清空：失败时保留原文，避免用户重敲
    if (todo !== null) {
      setText('');
    }
    // 提交后保持焦点，可连续录入
    inputRef.current?.focus();
  };

  if (hidden) {
    return null;
  }

  return (
    <form
      // 吸顶：内容区是内部滚动容器，列表滚很长时依然可直接录入
      className="bg-card focus-within:border-ring focus-within:ring-ring/50 sticky top-0 z-40 flex items-center gap-2 rounded-lg border p-1.5 pl-3 shadow-xs transition-[color,box-shadow] focus-within:ring-[3px]"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <PlusIcon className="text-muted-foreground h-4 w-4 shrink-0" />
      <Input
        ref={inputRef}
        value={text}
        onChange={(event) => setText(event.target.value)}
        maxLength={200}
        placeholder="写下要做的事，回车保存"
        aria-label="写下要做的事"
        className="h-8 flex-1 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0 dark:bg-transparent"
      />
      {/* 文字始终显示（含移动端，不折叠成纯图标，PRD §5.2） */}
      <Button type="submit" disabled={submitting} className="shrink-0">
        <PlusIcon />
        <span>添加</span>
      </Button>
    </form>
  );
});
