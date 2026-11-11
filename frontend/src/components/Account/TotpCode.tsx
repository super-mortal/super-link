import { useEffect, useRef, useState } from 'react';
import { formatTotp, generateTotp, totpRemaining } from '@/lib/vaultCrypto.ts';
import { copySecret } from '@/lib/copySecret.ts';
import { CopySecretButton } from '@/components/Account/SecretButtons.tsx';

/** RFC 6238 默认步长（秒），与 vaultCrypto 内部常量保持一致 */
const TOTP_PERIOD_SECONDS = 30;

type TotpCodeProps = {
  /** Base32 secret 明文：只从调用方内存传入，禁止写入任何存储或日志 */
  secret: string;
  issuer?: string;
  account?: string;
};

/**
 * TOTP 动态码（PRD §7.6 / §9.3 / §10.4）：6 位 3+3 分组、倒计时条、剩余秒数、
 * 发行方与账号、一键复制。
 *
 * 为什么计时器与动态码状态都收敛在本组件：倒计时每秒变化，若把秒数提升到详情页
 * 统一 setState，整页（凭据 / 授权 / 信息栏）每秒重渲染一次；PRD §7.6 明确要求
 * 「每秒刷新，不触发整页重渲染」，因此父页面完全感知不到这里的秒级更新。
 *
 * 每个 tick 都重算动态码：HMAC-SHA1 的输入只有 8 字节，每秒一次成本可忽略，
 * 同时天然覆盖「标签页被浏览器节流后恢复」「用户修改系统时钟」等情况，
 * 比维护「计数器变了才重算」的分支状态更可靠。
 */
export const TotpCode = ({ secret, issuer, account }: TotpCodeProps) => {
  const [code, setCode] = useState('');
  const [remaining, setRemaining] = useState(() => totpRemaining(TOTP_PERIOD_SECONDS));
  const [error, setError] = useState<string | null>(null);
  /** 卸载标记：异步 HMAC 结果晚于卸载到达时直接丢弃，不做无效 setState */
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  useEffect(() => {
    const tick = async () => {
      setRemaining(totpRemaining(TOTP_PERIOD_SECONDS));
      try {
        const next = await generateTotp(secret);
        if (aliveRef.current) {
          setCode(next);
        }
      } catch {
        if (aliveRef.current) {
          setError('动态码生成失败，请检查两步验证密钥');
        }
      }
    };

    void tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [secret]);

  const progressPercent = Math.min(100, Math.max(0, (remaining / TOTP_PERIOD_SECONDS) * 100));

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {error ? (
          <span className="text-destructive text-xs">{error}</span>
        ) : (
          <>
            <span className="font-mono text-xl leading-none font-semibold tracking-[0.2em]" aria-label="两步验证动态码">
              {code ? formatTotp(code) : '------'}
            </span>
            <div className="bg-muted h-1.5 w-28 overflow-hidden rounded-full" aria-hidden="true">
              <div
                className="bg-primary h-full rounded-full transition-[width] duration-1000 ease-linear"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <span className="text-muted-foreground text-xs tabular-nums">{remaining} 秒</span>
            <CopySecretButton
              onCopy={() => {
                if (code) {
                  void copySecret(code);
                }
              }}
              label="复制动态码"
            />
          </>
        )}
      </div>
      {(issuer || account) && (
        <p className="text-muted-foreground text-xs">
          {issuer ?? '未知发行方'}
          {account ? ` · ${account}` : ''}
        </p>
      )}
    </div>
  );
};
