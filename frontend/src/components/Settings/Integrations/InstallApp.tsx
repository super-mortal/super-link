import * as React from 'react';
import { InstallStep } from '@/components/Settings/Integrations/InstallStep.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card.tsx';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible.tsx';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select.tsx';
import {
  IconBrandAndroid,
  IconBrandChrome,
  IconBrandEdge,
  IconBrandFirefox,
  IconBrandOpera,
} from '@tabler/icons-react';
import { CheckIcon, ChevronRightIcon, ArrowDownToLine } from 'lucide-react';
import { useInstallExperience } from '@/hooks/use-install-experience';
import { type InstallEnvironment } from '@/lib/install-env';

type InstallOptionId = 'android' | 'chrome_desktop' | 'edge_desktop' | 'opera_desktop' | 'firefox_desktop';

type InstallOption = {
  id: InstallOptionId;
  label: string;
  icon: React.ElementType;
  steps: React.ReactNode[];
  footnote?: React.ReactNode;
};

const INSTALL_OPTIONS: InstallOption[] = [
  {
    id: 'android',
    label: 'Android',
    icon: IconBrandAndroid,
    steps: [
      <>
        在 <span className="font-semibold">Chrome</span>、<span className="font-semibold">Edge</span>、
        <span className="font-semibold">Opera</span> 或 <span className="font-semibold">Samsung Internet</span>{' '}
        中：打开菜单并点击 <span className="font-semibold">Install app</span> 或{' '}
        <span className="font-semibold">Add to Home screen</span>。
      </>,
      <>
        在 <span className="font-semibold">Firefox</span> 中：点击 <span className="font-semibold">...</span> 菜单并选择{' '}
        <span className="font-semibold">Install</span>。
      </>,
      '在浏览器弹窗中确认安装。',
      <>
        在主屏幕或应用抽屉中启动 <span className="font-semibold">Super-Link</span>。
      </>,
    ],
    footnote: '主流 Android 浏览器均支持安装，菜单名称可能有所不同（Install、Add to Home screen 等）。',
  },
  {
    id: 'chrome_desktop',
    label: 'Chrome（桌面端）',
    icon: IconBrandChrome,
    steps: [
      <>
        点击地址栏右侧的 <span className="font-semibold">安装</span> 图标。
      </>,
      <>
        或者打开 <span className="font-semibold">Chrome menu</span>（三点）&rarr;{' '}
        <span className="font-semibold">Cast, save and share</span> &rarr;{' '}
        <span className="font-semibold">Install Super-Link...</span> 或{' '}
        <span className="font-semibold">Install page as app...</span>
      </>,
      '在弹窗中确认安装。',
      <>
        从任务栏、Dock、开始菜单或应用启动器启动 <span className="font-semibold">Super-Link</span>。
      </>,
    ],
  },
  {
    id: 'edge_desktop',
    label: 'Edge（桌面端）',
    icon: IconBrandEdge,
    steps: [
      <>
        点击地址栏中的 <span className="font-semibold">可用应用</span> 图标。
      </>,
      <>
        或者打开 <span className="font-semibold">Edge menu</span> &rarr; <span className="font-semibold">Apps</span>{' '}
        &rarr; <span className="font-semibold">Install this site as an app</span>。
      </>,
      '在弹窗中确认安装。',
      <>
        从任务栏、Dock、开始菜单或应用启动器启动 <span className="font-semibold">Super-Link</span>。
      </>,
    ],
  },
  {
    id: 'opera_desktop',
    label: 'Opera（桌面端）',
    icon: IconBrandOpera,
    steps: [
      <>
        打开 <span className="font-semibold">Opera menu</span>，找到 <span className="font-semibold">Apps</span> &rarr;{' '}
        <span className="font-semibold">Install app</span>。
      </>,
      <>
        或者查找地址栏中的 <span className="font-semibold">Install</span> 图标。
      </>,
      '在弹窗中确认安装。',
      <>
        从任务栏、Dock、开始菜单或应用启动器启动 <span className="font-semibold">Super-Link</span>。
      </>,
    ],
  },
  {
    id: 'firefox_desktop',
    label: 'Firefox（桌面端）',
    icon: IconBrandFirefox,
    steps: [
      'Firefox 桌面端暂不支持安装 PWA，但你仍可作为普通网站流畅使用 Super-Link。',
      '为了快速访问，可在新标签页添加 Super-Link 快捷方式，或将其保存到书签栏。',
    ],
  },
];

function defaultTabForEnvironment(environment: InstallEnvironment): InstallOptionId {
  if (environment.platform === 'android') {
    return 'android';
  }

  if (environment.browser === 'firefox') {
    return 'firefox_desktop';
  }

  if (environment.browser === 'edge') {
    return 'edge_desktop';
  }

  if (environment.browser === 'opera') {
    return 'opera_desktop';
  }

  return 'chrome_desktop';
}

function launchLocationLabel(environment: InstallEnvironment) {
  if (environment.platform === 'ios' || environment.platform === 'android') {
    return '主屏幕';
  }

  if (environment.platform === 'macos') {
    return 'Dock 或应用程序文件夹';
  }

  return '任务栏、开始菜单或应用启动器';
}

export function InstallApp() {
  const { environment, isStandalone } = useInstallExperience();
  const isInstalled = isStandalone;
  const isInstallationAvailable = React.useMemo(() => {
    return !(environment.browser === 'firefox' && environment.platform !== 'ios' && environment.platform !== 'android');
  }, [environment]);

  const defaultTab = React.useMemo(() => defaultTabForEnvironment(environment), [environment]);

  const [activeTab, setActiveTab] = React.useState<InstallOptionId>(defaultTab);

  React.useEffect(() => {
    setActiveTab(defaultTab);
  }, [defaultTab]);

  const activeOption = React.useMemo(() => INSTALL_OPTIONS.find((o) => o.id === activeTab), [activeTab]);
  const isSuccess = isInstalled || isInstallationAvailable;

  return (
    <Card className="gap-5">
      <CardHeader className="flex flex-row items-start gap-4 space-y-0">
        <div className="bg-muted mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg">
          <ArrowDownToLine className="text-muted-foreground h-6 w-6" />
        </div>
        <div className="flex flex-1 flex-col gap-1">
          <CardTitle className="text-lg">安装应用</CardTitle>
          <CardDescription>
            除浏览器访问外，Super-Link 还可作为渐进式网页应用（PWA）安装。请在下方
            <span className="font-semibold">如何安装？</span>中选择设备查看安装步骤。
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="bg-muted/30 flex flex-col gap-3 rounded-lg border p-4">
          <div className="flex items-center gap-3">
            <div
              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${isSuccess ? 'bg-green-600/10 text-green-600' : 'bg-amber-600/10 text-amber-600'}`}
            >
              {isInstalled ? (
                <CheckIcon className="h-3.5 w-3.5" />
              ) : (
                <div className={`h-1.5 w-1.5 rounded-full ${isSuccess ? 'bg-green-600' : 'bg-amber-600'}`} />
              )}
            </div>
            <div>
              <p className="text-foreground text-sm font-medium">
                {isInstalled ? '已安装' : !isInstallationAvailable ? '安装受限' : '可安装'}
              </p>
              <p className="text-muted-foreground text-xs">
                检测到：{environment.browserLabel}（{environment.platformLabel}）
              </p>
            </div>
          </div>

          {isInstalled && (
            <div className="border-t pt-2">
              <p className="text-muted-foreground text-xs italic">
                可从以下位置启动：{launchLocationLabel(environment)}
              </p>
            </div>
          )}

          {!isInstallationAvailable && !isInstalled && (
            <div className="border-t pt-2">
              <p className="text-muted-foreground text-xs italic">你当前平台上的浏览器不支持安装 PWA。</p>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <Collapsible className="data-[state=open]:border-border data-[state=open]:bg-muted/40 rounded-md border border-transparent">
            <CollapsibleTrigger asChild>
              <Button variant="ghost" className="group w-full justify-start">
                <ChevronRightIcon className="mr-2 h-4 w-4 shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-90" />
                如何安装？
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-6 p-4">
              <div className="space-y-6">
                <Select value={activeTab} onValueChange={(value) => setActiveTab(value as InstallOptionId)}>
                  <SelectTrigger className="bg-background w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {INSTALL_OPTIONS.map((option) => (
                      <SelectItem key={option.id} value={option.id}>
                        <div className="flex items-center gap-2">
                          <option.icon className="h-4 w-4 shrink-0" />
                          {option.label}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {activeOption && (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      {activeOption.steps.map((step, index) => (
                        <div key={`${activeOption.id}-${index}`}>
                          <InstallStep index={index} text={step} />
                        </div>
                      ))}
                    </div>

                    {activeOption.footnote ? (
                      <p className="text-muted-foreground mt-4 space-y-2 border-t pt-4 text-xs leading-relaxed">
                        {activeOption.footnote}
                      </p>
                    ) : null}
                  </div>
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>

          <Collapsible className="data-[state=open]:border-border data-[state=open]:bg-muted/40 rounded-md border border-transparent">
            <CollapsibleTrigger asChild>
              <Button variant="ghost" className="group w-full justify-start">
                <ChevronRightIcon className="mr-2 h-4 w-4 shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-90" />
                我的设备支持安装吗？
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-6 p-4">
              <div className="text-foreground space-y-3 text-sm leading-relaxed">
                <div className="space-y-2">
                  <h4 className="text-foreground mb-4 font-semibold">桌面端支持</h4>
                  <ul className="text-foreground list-disc space-y-1 pl-4">
                    <li>
                      <span>Chromium 浏览器</span>（<span className="font-semibold">Chrome</span>、
                      <span className="font-semibold">Edge</span>、<span className="font-semibold">Opera</span>
                      ）支持 Windows、Mac 和 Linux。
                    </li>
                    <li>
                      <span className="font-semibold">Firefox</span> 桌面端目前不支持安装 PWA。
                    </li>
                  </ul>
                </div>

                <div className="space-y-2 pt-4">
                  <h4 className="text-foreground mb-4 font-semibold">移动端支持</h4>
                  <ul className="text-foreground list-disc space-y-1 pl-4">
                    <li>
                      <span className="font-semibold">Android：</span> <span className="font-semibold">Chrome</span>,{' '}
                      <span className="font-semibold">Firefox</span>, <span className="font-semibold">Edge</span>,{' '}
                      <span className="font-semibold">Opera</span> 和{' '}
                      <span className="font-semibold">Samsung Internet</span> 均支持安装。
                    </li>
                  </ul>
                </div>

                <p className="text-muted-foreground mt-4 space-y-2 border-t pt-4 text-xs leading-relaxed">
                  如果设备不支持安装，你仍可通过浏览器访问 Super-Link，并添加书签以便快速访问。
                </p>
              </div>
            </CollapsibleContent>
          </Collapsible>

          <Collapsible className="data-[state=open]:border-border data-[state=open]:bg-muted/40 rounded-md border border-transparent">
            <CollapsibleTrigger asChild>
              <Button variant="ghost" className="group w-full justify-start">
                <ChevronRightIcon className="mr-2 h-4 w-4 shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-90" />
                什么是渐进式网页应用（PWA）？
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-6 p-4">
              <div className="text-foreground space-y-3 text-sm leading-relaxed">
                <p>渐进式网页应用（PWA）是一种可安装到设备上的网站，拥有独立图标，并提供接近原生应用的体验。</p>
                <p>
                  安装 Super-Link
                  后，你可以更快启动应用、减少浏览器工具栏干扰、获得更大可视空间，并更方便地在应用间切换。
                </p>
              </div>
            </CollapsibleContent>
          </Collapsible>

          <Collapsible className="data-[state=open]:border-border data-[state=open]:bg-muted/40 rounded-md border border-transparent">
            <CollapsibleTrigger asChild>
              <Button variant="ghost" className="group w-full justify-start">
                <ChevronRightIcon className="mr-2 h-4 w-4 shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-90" />
                我的设备版本满足要求，为什么浏览器没显示安装图标？
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-6 p-4">
              <div className="text-foreground space-y-4 text-sm leading-relaxed">
                <div className="space-y-2">
                  <h4 className="font-semibold">一、PWA 安装必须满足的 4 个条件（Edge/Chrome）</h4>
                  <ol className="list-decimal space-y-3 pl-4">
                    <li>
                      <span className="font-semibold">必须是 HTTPS 安全连接</span>
                      <ul className="mt-1 list-disc space-y-1 pl-4">
                        <li>线上/局域网：必须 HTTPS（HTTP 不行）。</li>
                        <li>
                          本地开发例外：<code>localhost</code>、<code>127.0.0.1</code> 可以 HTTP。
                        </li>
                      </ul>
                    </li>
                    <li>
                      <span className="font-semibold">必须有 manifest.json（清单文件）</span>
                      <ul className="mt-1 list-disc space-y-1 pl-4">
                        <li>
                          包含：<code>name</code>/<code>short_name</code>、<code>start_url</code>、<code>display</code>
                          。
                        </li>
                        <li>图标：至少 192x192、512x512 PNG。</li>
                        <li>
                          HTML 里要加：<code>{'<link rel="manifest" href="/manifest.json">'}</code>
                        </li>
                      </ul>
                    </li>
                    <li>
                      <span className="font-semibold">必须注册 Service Worker（sw.js）</span>
                      <ul className="mt-1 list-disc space-y-1 pl-4">
                        <li>后台脚本，负责离线、缓存、推送。</li>
                        <li>能正常注册、无报错。</li>
                      </ul>
                    </li>
                    <li>
                      <span className="font-semibold">浏览器触发条件</span>
                      <ul className="mt-1 list-disc space-y-1 pl-4">
                        <li>未安装过此 PWA。</li>
                        <li>用户有过交互（点一下）、停留大于等于 30 秒。</li>
                      </ul>
                    </li>
                  </ol>
                  <p className="text-muted-foreground">满足后，Edge 地址栏会出现安装图标（↑□）。</p>
                </div>

                <div className="space-y-2">
                  <h4 className="font-semibold">二、IP + 端口可以吗？</h4>
                  <ul className="list-disc space-y-2 pl-4">
                    <li>
                      <span className="font-semibold">本地（localhost/127.0.0.1）+ 端口：</span>
                      允许，例如 <code>http://localhost:8080</code>、<code>http://127.0.0.1:3000</code>，HTTP 也能装
                      PWA。
                    </li>
                    <li>
                      <span className="font-semibold">局域网/公网 IP + 端口（必须 HTTPS）：</span>
                      允许，例如 <code>https://192.168.1.100:8443</code>、<code>https://47.xxx.xxx.xxx:443</code>。
                    </li>
                    <li>
                      <span className="font-semibold">局域网/公网 IP + 端口（HTTP）：</span>
                      不允许，例如 <code>http://192.168.1.100:8080</code>，浏览器判定不安全，不显示安装按钮。
                    </li>
                  </ul>
                </div>

                <div className="space-y-1">
                  <h4 className="font-semibold">三、一句话总结</h4>
                  <ul className="list-disc space-y-1 pl-4">
                    <li>
                      <code>localhost:端口</code>：HTTP 可装 PWA。
                    </li>
                    <li>
                      <code>IP:端口</code>：必须 HTTPS 才能装，HTTP 不行。
                    </li>
                  </ul>
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>
      </CardContent>
    </Card>
  );
}
