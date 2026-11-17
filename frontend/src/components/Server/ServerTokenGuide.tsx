import { ClipboardCopy, Copy, KeyRound, ShieldCheck, Terminal } from 'lucide-react';
import { Button } from '@/components/ui/button.tsx';
import { copySecret } from '@/lib/copySecret.ts';

/**
 * 安装指引正文：Agent Token 明文 + 含 Token 的一行安装命令 + 一键复制（PRD §5.1 / §5.6、决策 D6）。
 *
 * 添加成功态与重置成功态**共用同一组件**（ServerFormDialog / ServerResetTokenDialog 各自渲染
 * 弹窗头部，正文只有这一份）——两处展示的凭据材料与复制交互完全一致，复制两份必然漂移。
 *
 * 安全纪律（D6 选项 b）：服务端只存 Token 哈希，用户态任何接口都不回明文，完整含 Token 的
 * 命令只在本组件（弹窗内）出现一次；关闭弹窗即从内存消失，列表 / 详情 / toast 一律不展示。
 * 复制走统一入口 copySecret：toast 只提示「已复制」，绝不带入被复制的内容。
 */
export const ServerTokenGuide = ({ token, installCommand }: { token: string; installCommand: string }) => (
  <div className="flex flex-col gap-5">
    <section className="flex flex-col gap-2">
      <h3 className="flex items-center gap-1.5 text-[13px] font-semibold">
        <KeyRound className="size-3.5" aria-hidden="true" />
        Agent Token（仅此一次完整展示）
      </h3>
      <div className="flex items-center gap-2">
        <code className="bg-muted min-w-0 flex-1 rounded-md px-3 py-2 font-mono text-xs break-all select-all">
          {token}
        </code>
        <Button variant="outline" size="sm" className="shrink-0" onClick={() => void copySecret(token)}>
          <Copy />
          复制
        </Button>
      </div>
      <p className="text-muted-foreground flex items-start gap-1.5 text-xs leading-relaxed">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        <span>服务端只保存 Token 哈希，关闭本弹窗后无法再次查看明文；遗失只能「重置 Token」重新生成。</span>
      </p>
    </section>

    <section className="flex flex-col gap-2">
      <h3 className="flex items-center gap-1.5 text-[13px] font-semibold">
        <Terminal className="size-3.5" aria-hidden="true" />
        安装命令（一行，拷贝到被监控机器执行）
      </h3>
      <div className="bg-muted overflow-x-auto rounded-md px-3.5 py-3 font-mono text-xs leading-relaxed whitespace-pre">
        {installCommand}
      </div>
      <Button variant="default" size="sm" className="self-start" onClick={() => void copySecret(installCommand)}>
        <ClipboardCopy />
        复制安装命令
      </Button>
      <p className="text-muted-foreground text-xs leading-relaxed">
        安装脚本自动识别架构（amd64/arm64）下载静态二进制并注册 systemd 服务；Agent 通过 Token 认证，不需要 SSH 凭据。
      </p>
    </section>
  </div>
);
