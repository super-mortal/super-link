import { PlusIcon, ServerCog } from 'lucide-react';
import { Button } from '@/components/ui/button.tsx';

type ServerEmptyStateProps = {
  /** empty：还没有任何服务器；search：搜索无结果；group：侧栏分组筛选无结果 */
  variant: 'empty' | 'search' | 'group';
  onAdd: () => void;
  onClearSearch: () => void;
  onClearGroup: () => void;
};

/**
 * 服务器列表空态（PRD §5.1 / §5.5，原型 serverEmptyHtml + 搜索无结果态）。
 *
 * 与账号库空态的差异：无服务器时是完整接入引导（一行安装命令的说明摘要）——
 * 添加服务器只是第一步，用户还需要知道要去被监控机器上执行命令（PRD §5.1）。
 * 「分组为空」一档是本项目特有：分组筛选下推了后端，store.servers 即过滤结果，
 * 不能用它判断「是否一台都没有」，需与搜索无结果区分开。
 */
export const ServerEmptyState = ({ variant, onAdd, onClearSearch, onClearGroup }: ServerEmptyStateProps) => {
  if (variant === 'empty') {
    return (
      <div className="flex h-full items-center justify-center px-4">
        <div className="flex max-w-[26rem] flex-col items-center gap-3 py-8 text-center">
          <div className="bg-secondary text-muted-foreground flex size-12 items-center justify-center rounded-lg">
            <ServerCog className="size-6" />
          </div>
          <h3 className="text-base font-semibold">还没有监控任何服务器</h3>
          <p className="text-muted-foreground text-[13px] leading-relaxed">
            {
              '添加服务器后，在被监控机器上执行一行安装命令即可。Agent 是零依赖的静态二进制守护进程，自动连接 Hub，每 5 分钟回传 CPU、内存、磁盘、网络与 Docker 数据。'
            }
          </p>
          <Button variant="default" onClick={onAdd}>
            <PlusIcon />
            添加服务器
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-4 px-4 text-center text-lg">
      <p>{variant === 'search' ? '没有匹配的服务器' : '该分组下暂无服务器'}</p>
      <Button variant="outline" onClick={variant === 'search' ? onClearSearch : onClearGroup}>
        {variant === 'search' ? '清除搜索' : '清除分组筛选'}
      </Button>
    </div>
  );
};
