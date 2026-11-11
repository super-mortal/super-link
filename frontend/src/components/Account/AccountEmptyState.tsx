import { PlusIcon } from 'lucide-react';
import { Button } from '@/components/ui/button.tsx';

type AccountEmptyStateProps = {
  /** empty：账号库本身为空；platform：平台筛选无结果；search：搜索无结果 */
  variant: 'empty' | 'platform' | 'search';
  onAdd: () => void;
  onClearPlatform: () => void;
  onClearSearch: () => void;
};

/**
 * 账号库空态（PRD §10.6）：
 * - 空账号库：「账号库还是空的，先添加第一个账号吧」+ 添加按钮；
 * - 平台筛选为空：「该平台下暂无账号」+ 清除筛选按钮；
 * - 搜索无结果：沿用通用空态（附清除搜索按钮）。
 */
export const AccountEmptyState = ({ variant, onAdd, onClearPlatform, onClearSearch }: AccountEmptyStateProps) => (
  <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-4 px-4 text-center text-lg">
    <p>
      {variant === 'empty'
        ? '账号库还是空的，先添加第一个账号吧'
        : variant === 'platform'
          ? '该平台下暂无账号'
          : '没有匹配的账号。'}
    </p>
    {variant === 'empty' ? (
      <Button variant="default" onClick={onAdd}>
        <PlusIcon />
        添加账号
      </Button>
    ) : variant === 'platform' ? (
      <Button variant="outline" onClick={onClearPlatform}>
        清除平台筛选
      </Button>
    ) : (
      <Button variant="outline" onClick={onClearSearch}>
        清除搜索
      </Button>
    )}
  </div>
);
