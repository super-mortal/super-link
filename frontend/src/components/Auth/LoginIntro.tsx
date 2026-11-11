import { Bookmark, KeyRound, ShieldCheck, Sparkles } from 'lucide-react';
import { useContext } from 'react';
import { observer } from 'mobx-react-lite';

import { SecureContextWarning } from '@/components/Account/SecureContextWarning.tsx';
import { Logo } from '@/components/Logo.tsx';
import { StoreContext } from '@/store/storeContext';

/** 能力点（PRD O-6 已确认清单）：只介绍已实现的能力，不写营销式文案 */
const FEATURES = [
  { title: '书签与标签', desc: '收藏、整理、快速找回', icon: Bookmark },
  { title: 'Skill 管理', desc: '从 GitHub 安装并保持更新', icon: Sparkles },
  { title: '账号库', desc: '密码与 2FA 本地加密', icon: KeyRound },
  { title: '数据自持', desc: '自托管部署，不依赖第三方', icon: ShieldCheck },
] as const;

const FeatureItem = ({
  icon: Icon,
  title,
  desc,
}: {
  icon: (typeof FEATURES)[number]['icon'];
  title: string;
  desc: string;
}) => (
  <li className="flex min-w-0 items-start gap-2.5">
    <span className="bg-muted text-foreground flex h-7 w-7 flex-none items-center justify-center rounded-lg">
      <Icon className="h-4 w-4" aria-hidden="true" />
    </span>
    <div className="min-w-0">
      <span className="block text-sm font-medium">{title}</span>
      <span className="text-muted-foreground block text-xs leading-relaxed">{desc}</span>
    </div>
  </li>
);

/**
 * 登录页左侧项目介绍（PRD O-6）。
 *
 * 桌面端（≥1024px）展示 Logo、一句话定位与 4 条能力点；
 * 移动端单列只保留 Logo 与简介，能力点隐藏（与本地原型一致）。
 * 版本号与设置页同一来源（app-info 的 installed_version），不在前端硬编码；
 * 接口暂不可用时该行不渲染，不展示可能错误的版本。
 */
export const LoginIntro = observer(() => {
  const store = useContext(StoreContext);
  const version = store.appInfo?.installed_version;

  return (
    <section className="flex w-full max-w-[26rem] flex-col gap-5">
      <div className="flex justify-center lg:justify-start">
        <Logo />
      </div>
      <div className="text-center lg:text-left">
        <p className="text-2xl leading-snug font-semibold tracking-tight">超级链接，连接你的一切。</p>
        <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
          自托管的个人数据管理工具。书签、Skill 与账号凭据都保存在你自己的服务器上，数据完全由你掌控。
        </p>
      </div>
      <ul className="hidden gap-x-4 gap-y-3.5 lg:grid lg:grid-cols-2">
        {FEATURES.map((feature) => (
          <FeatureItem key={feature.title} {...feature} />
        ))}
      </ul>
      {/* 非安全上下文提示（PRD O-7，task5 新增）：HTTP 部署时账号库加解密与复制不可用 */}
      <SecureContextWarning />
      {version && <p className="text-muted-foreground text-xs">Super-Link v{version} · MIT License</p>}
    </section>
  );
});
