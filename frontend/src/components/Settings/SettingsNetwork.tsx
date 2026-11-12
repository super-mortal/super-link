import { observer } from 'mobx-react-lite';
import * as React from 'react';
import { Check } from 'lucide-react';
import { toast } from 'sonner';

import { StoreContext } from '@/store/storeContext.ts';
import { Button } from '@/components/ui/button.tsx';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card.tsx';
import { Checkbox } from '@/components/ui/checkbox.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Spinner } from '@/components/ui/spinner.tsx';
import { GithubAccessModeType, NetworkTestResultType } from '@/lib/types.ts';
import { cn } from '@/lib/utils.ts';

/** 三档策略（PRD O-5）：与后端 Config::GITHUB_ACCESS_MODES 保持一致 */
const ACCESS_MODES: { id: GithubAccessModeType; title: string; desc: string }[] = [
  { id: 'auto', title: '自动（推荐）', desc: '优先直连，10 秒内失败后再尝试代理' },
  { id: 'proxy', title: '始终使用代理', desc: '所有 GitHub 请求都经代理访问' },
  { id: 'direct', title: '不使用代理', desc: '只直连 github.com，不使用代理' },
];

/** 代理前缀只接受 https://，与后端 Config::normalizeGithubProxyPrefix 的校验对齐 */
const isHttpsPrefix = (value: string) => /^https:\/\//i.test(value);

export const SettingsNetwork = observer(() => {
  const store = React.useContext(StoreContext);

  const settings = store.networkSettings;
  const [mode, setMode] = React.useState<GithubAccessModeType>('auto');
  const [proxyPrefix, setProxyPrefix] = React.useState('');
  const [updateCheck, setUpdateCheck] = React.useState(true);
  const [isSaving, setIsSaving] = React.useState(false);
  const [isTesting, setIsTesting] = React.useState(false);
  const [testResult, setTestResult] = React.useState<NetworkTestResultType | null>(null);

  React.useEffect(() => {
    store.fetchNetworkSettings();
  }, [store]);

  // 服务端生效值（数据库设置或环境变量默认值）到达后同步表单；保存后的响应也会走到这里
  React.useEffect(() => {
    if (!settings) {
      return;
    }
    setMode(settings.mode);
    setProxyPrefix(settings.proxy_prefix);
    setUpdateCheck(settings.update_check);
    setTestResult(null);
  }, [settings]);

  const handleSave = async () => {
    const prefix = proxyPrefix.trim();
    if (prefix && !isHttpsPrefix(prefix)) {
      toast.error('代理地址必须以 https:// 开头', { position: 'top-center' });
      return;
    }

    setIsSaving(true);
    try {
      await store.saveNetworkSettings({ mode, proxy_prefix: prefix, update_check: updateCheck });
    } finally {
      setIsSaving(false);
    }
  };

  const handleTest = async () => {
    const prefix = proxyPrefix.trim();
    if (prefix && !isHttpsPrefix(prefix)) {
      toast.error('代理地址必须以 https:// 开头', { position: 'top-center' });
      return;
    }
    // 代理档位未填地址时不发请求并提示（PRD 效果表）
    if (mode === 'proxy' && !prefix) {
      toast.error('请先填写代理地址', { position: 'top-center' });
      return;
    }

    setIsTesting(true);
    setTestResult(null);
    try {
      const result = await store.testNetworkConnection({ mode, proxy_prefix: prefix });
      if (result) {
        setTestResult(result);
      }
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">GitHub 访问策略</CardTitle>
          <CardDescription>影响 Skill 安装、检查更新与应用版本检查；不影响书签与账号库接口。</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {ACCESS_MODES.map((item) => {
            const active = mode === item.id;
            return (
              <button
                key={item.id}
                type="button"
                aria-pressed={active}
                onClick={() => setMode(item.id)}
                className={cn(
                  'flex items-start gap-3 rounded-lg border p-3 text-left transition',
                  active ? 'border-primary bg-primary/5' : 'border-border hover:bg-accent/50'
                )}
              >
                <span
                  className={cn(
                    'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border',
                    active ? 'border-primary bg-primary text-primary-foreground' : 'border-border'
                  )}
                >
                  {active && <Check className="size-3" />}
                </span>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-sm font-medium">{item.title}</span>
                  <span className="text-muted-foreground text-xs leading-relaxed">{item.desc}</span>
                </span>
              </button>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">代理地址</CardTitle>
          <CardDescription>
            路径前缀格式，例如 https://gh-proxy.com/。留空时「自动」模式只直连；「始终使用代理」必须填写。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Input
            value={proxyPrefix}
            onChange={(event) => setProxyPrefix(event.target.value)}
            placeholder="https://你的代理域名/"
            autoComplete="off"
            spellCheck={false}
            disabled={mode === 'direct'}
          />
          {testResult && (
            <p
              className={cn(
                'mt-2 text-xs',
                testResult.reachable ? 'text-green-600 dark:text-green-400' : 'text-destructive'
              )}
            >
              {testResult.reachable
                ? `连接正常 · 耗时 ${testResult.elapsed_ms} ms`
                : `连接失败：${testResult.error ?? '未知原因'}`}
            </p>
          )}
        </CardContent>
        <CardFooter className="flex gap-2">
          <Button variant="outline" onClick={handleTest} disabled={isTesting}>
            {isTesting && <Spinner />}
            测试连接
          </Button>
          <Button className="ml-auto" onClick={handleSave} disabled={isSaving}>
            {isSaving && <Spinner />}
            保存
          </Button>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">版本检查</CardTitle>
          <CardDescription>关闭后不再请求 api.github.com，关于页只显示本地版本。</CardDescription>
        </CardHeader>
        <CardContent>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={updateCheck} onCheckedChange={(value) => setUpdateCheck(value === true)} />
            启用版本检查
          </label>
        </CardContent>
      </Card>
    </div>
  );
});
