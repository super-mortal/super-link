import { CopySecretButton, PasswordMask, RevealSecretButton } from '@/components/Account/SecretButtons.tsx';

type CredentialRowProps = {
  /** 账号标识（明文元数据，可直接复制） */
  identifier: string;
  /** 是否渲染账号标识区：字段可见性可关（默认开） */
  showIdentifier?: boolean;
  /** 是否渲染密码掩码区：字段可见且确实存有密码密文（第三方登录账号没有密码） */
  showPassword?: boolean;
  onCopyIdentifier: () => void;
  /** 显示明文：task10 接按需解密，本任务给占位提示 */
  onRevealPassword: () => void;
  onCopyPassword: () => void;
};

/**
 * 「账号标识 + 密码」合并行（PRD §9.4），列表与卡片共用。
 *
 * 同一行不换行：账号区可压缩省略（flex: 1 1 auto + min-width: 0），密码区宽度固定
 * 不参与压缩（flex: none），窄屏下优先牺牲标识显示长度，密码按钮永远可点。
 * 两个区块分别由字段可见性门控，都关时整行不渲染。
 */
export const CredentialRow = ({
  identifier,
  showIdentifier = true,
  showPassword = false,
  onCopyIdentifier,
  onRevealPassword,
  onCopyPassword,
}: CredentialRowProps) => (
  <div className="flex flex-nowrap items-center gap-2 text-[13px]">
    {showIdentifier && (
      <div className="flex min-w-0 flex-[1_1_auto] items-center gap-1">
        <span className="min-w-0 truncate" title={identifier}>
          {identifier}
        </span>
        <CopySecretButton onCopy={onCopyIdentifier} label="复制账号标识" />
      </div>
    )}

    {showPassword && (
      <div className="flex flex-none items-center gap-1">
        <PasswordMask />
        <RevealSecretButton onReveal={onRevealPassword} label="显示密码" />
        <CopySecretButton onCopy={onCopyPassword} label="复制密码" />
      </div>
    )}
  </div>
);
