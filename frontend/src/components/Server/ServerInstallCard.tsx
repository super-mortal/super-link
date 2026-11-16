import { ShieldCheck } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card.tsx';

/**
 * 接入信息卡（PRD §5.5 / 决策 D6 选项 b，原型 agentInstallTemplate + .code-block）。
 *
 * 只展示安装命令**模板**：Token 一律是 `<AGENT_TOKEN>` 占位符——服务端只存 Token 哈希
 * （Utils/ServerToken），用户态任何接口都不回明文，页面回看明文等于把凭据落进浏览器与
 * 截图里，因此完整含 Token 的命令只在添加 / 重置弹窗内展示一次性（task15）。
 *
 * Hub 地址取 `window.location.origin`（浏览器视角）：与后端
 * ServerInstallCommand::resolveHubUrl 的请求推导同源，自托管内外网分离时以实际访问地址为准。
 */
export const ServerInstallCard = () => {
  const hubUrl = window.location.origin;
  const installTemplate = `curl -fsSL "${hubUrl}/content/install-agent" | sudo bash -s -- --hub-url "${hubUrl}" --token "<AGENT_TOKEN>"`;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">接入信息</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="bg-muted overflow-x-auto rounded-md px-3.5 py-3 font-mono text-xs leading-relaxed whitespace-pre">
          {installTemplate}
        </div>
        <p className="text-muted-foreground mt-3 flex items-start gap-1.5 text-[11px] leading-relaxed">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span>
            服务端只保存 Token 哈希，明文仅在添加 / 重置弹窗内展示；重装 agent 请点上方的「重置 Token」，弹窗会给出含新
            Token 的完整命令。Agent 为静态二进制、无运行时依赖，由 systemd 托管。
          </span>
        </p>
      </CardContent>
    </Card>
  );
};
