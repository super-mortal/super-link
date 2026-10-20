import * as React from 'react';
import { Logo } from '@/components/Logo.tsx';
import { Bug, ExternalLink, FileText, Lightbulb, Mail, Server } from 'lucide-react';
import { IconBrandBilibili, IconBrandGithub } from '@tabler/icons-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { StoreContext } from '@/store/storeContext';
import { observer } from 'mobx-react-lite';

const links = [
    {
      icon: Server,
      label: '腾讯云',
      url: 'https://cloud.tencent.com/act/cps/redirect?redirect=37409&cps_key=3a14fee6c971648adeff4eb009958072',
      description: '实惠的云服务器，快速，安全部署',
    },
    {
      icon: FileText,
      label: '更新日志',
      url: 'https://github.com/super-mortal/super-link',
      description: '了解最新变更',
    },
  ],
  socialLinks = [
    { icon: IconBrandGithub, label: '在 GitHub 上标星', url: 'https://github.com/super-mortal/super-link' },
    { icon: IconBrandBilibili, label: '在 Bilibili 上关注', url: 'https://space.bilibili.com/2090094430' },
  ],
  supportLinks = [
    {
      icon: Lightbulb,
      label: '提交功能请求',
      url: 'https://github.com/super-mortal/super-link/issues/new?labels=enhancement',
    },
    {
      icon: Bug,
      label: '报告 Bug',
      url: 'https://github.com/super-mortal/super-link/issues/new?labels=bug',
    },
    { icon: Mail, label: '联系我们', url: 'mailto:2169702639@qq.com' },
  ];

export const SettingsAbout = observer(() => {
  const store = React.useContext(StoreContext);
  const [isUpdating, setIsUpdating] = React.useState(false);
  const [updateTriggered, setUpdateTriggered] = React.useState(false);
  const [reloadCountdown, setReloadCountdown] = React.useState(5);

  const handleUpdate = async () => {
    setIsUpdating(true);
    const success = await store.updateApp();
    setIsUpdating(false);
    if (success) {
      setUpdateTriggered(true);
    }
  };

  // 更新触发后倒计时自动刷新页面（等待新容器就绪）
  React.useEffect(() => {
    if (!updateTriggered) {
      return;
    }
    if (reloadCountdown <= 0) {
      window.location.reload();
      return;
    }
    const timer = setTimeout(() => setReloadCountdown((prev) => prev - 1), 1000);
    return () => clearTimeout(timer);
  }, [updateTriggered, reloadCountdown]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col items-center justify-center gap-3 py-5">
        <Logo />

        <div className="flex flex-col items-center justify-center gap-2 text-sm">
          <div className="text-base font-medium">版本 {store.appInfo?.installed_version ?? '0.0.1'}</div>
          {store.appInfo?.update_available && (
            <div className="flex flex-col items-center gap-1.5">
              {updateTriggered ? (
                <p className="text-muted-foreground text-sm">
                  更新已触发，应用正在重启，{reloadCountdown} 秒后自动刷新...
                </p>
              ) : (
                <Button variant="default" size="sm" onClick={handleUpdate} disabled={isUpdating}>
                  {isUpdating && <Spinner />}
                  立即更新
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-6">
        <Card className="gap-4">
          <CardHeader>
            <CardTitle className="text-base sm:text-lg">资源和链接</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2">
            {links.map((link) => {
              const Icon = link.icon;
              return (
                <Button key={link.label} variant="ghost" className="h-auto w-full justify-start py-2 sm:py-3" asChild>
                  <a href={link.url} target="_blank" rel="noopener noreferrer" className="flex w-full items-start">
                    <Icon className="mt-1.5 mr-2 h-4 w-4 flex-shrink-0 sm:mr-3" />
                    <div className="flex-1 space-y-1 text-left text-wrap">
                      <div className="text-sm font-medium">{link.label}</div>
                      <div className="text-muted-foreground text-xs">{link.description}</div>
                    </div>
                    <ExternalLink className="mt-1.5 ml-2 h-3 w-3 flex-shrink-0 opacity-50" />
                  </a>
                </Button>
              );
            })}
          </CardContent>
        </Card>
        <Card className="gap-4">
          <CardHeader>
            <CardTitle className="text-base sm:text-lg">获取帮助和贡献</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2">
            {supportLinks.map((link) => {
              const Icon = link.icon;
              return (
                <Button
                  key={link.label}
                  variant="outline"
                  className="flex w-full items-center justify-start gap-3 py-5 text-sm"
                  asChild
                >
                  <a
                    href={link.url}
                    target={link.url.startsWith('mailto:') ? undefined : '_blank'}
                    rel={link.url.startsWith('mailto:') ? undefined : 'noopener noreferrer'}
                  >
                    <Icon className="h-4 w-4" />
                    <span>{link.label}</span>
                  </a>
                </Button>
              );
            })}
          </CardContent>
        </Card>
      </div>

      <Card className="gap-4">
        <CardHeader>
          <CardTitle className="text-base sm:text-lg">在社交媒体上保持联系</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {socialLinks.map((link) => {
            const Icon = link.icon;
            return (
              <Button
                key={link.label}
                variant="outline"
                className="flex items-center justify-center gap-2 py-4 text-sm"
                asChild
              >
                <a href={link.url} target="_blank" rel="noopener noreferrer">
                  <Icon className="h-4 w-4" />
                  <span>{link.label}</span>
                </a>
              </Button>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
});
