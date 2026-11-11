import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { observer } from 'mobx-react-lite';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button.tsx';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog.tsx';
import { Spinner } from '@/components/ui/spinner.tsx';
import {
  AuthorizationFields,
  BASE32_PATTERN,
  BasicInfoFields,
  CredentialFields,
  MAX_IDENTIFIER_LENGTH,
  MAX_PLATFORM_LENGTH,
  NO_GROUP_VALUE,
  NotesField,
  type AccountFormErrorsType,
  type AccountFormValuesType,
  type ChangeHandlerType,
} from '@/components/Account/AccountDialogFields.tsx';
import { StoreContext } from '@/store/storeContext.ts';
import { buildAad, decryptField, encryptField } from '@/lib/vaultCrypto.ts';
import { getDek } from '@/lib/vaultSession.ts';
import type { AccountAuthorizationType, AccountDetailType, AccountSecretsType, TotpPayloadType } from '@/lib/types.ts';

/**
 * 添加 / 编辑账号弹窗（PRD §10.2 / §10.3 / §9.7）：四段表单（基础信息 / 凭据与 2FA /
 * 授权关系 / 备注），新建与编辑复用同一弹窗——两边字段与校验完全一致，拆成两个弹窗
 * 只会让校验与密文契约复制两份。
 *
 * 密文契约（与后端 AccountPayload 对齐）：
 * - 服务端只搬运 {ct, iv}，不参与加解密；AAD 由前端按 `v1|account:{id}|field:{...}` 构造，
 *   因此**新建时 id 未知，必须先插元数据再按真实 id 加密补一次 secrets**（PATCH）；
 * - PATCH 语义：secrets 里键不存在的字段保持原值，显式 null 表示清空；
 * - 只有真的提交了新密码密文，后端才会刷新 password_updated_at（AccountsUpdateController），
 *   所以「没改密码就不提交密码密文」直接决定「上次改密」日期是否正确（PRD §10.3）。
 */

/**
 * 账号弹窗控制器：列表页（工具栏 / 空态 / 三种布局的操作菜单）经 context 打开弹窗，
 * 避免把 openEdit 一路透传进共享的 moduleColumns / ModuleCardActions。
 * 账号库以外的页面不提供该 context（取到 null），那里的账号分支菜单本就不会渲染。
 */
export type AccountDialogControllerType = {
  openCreate: () => void;
  openEdit: (accountId: number) => void;
};

export const AccountDialogContext = createContext<AccountDialogControllerType | null>(null);

type AccountDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 编辑态的账号 id；null = 新建 */
  accountId?: number | null;
  /** 编辑态已加载的详情（详情页打开时传入可避免重复请求）；未传则按 accountId 现场拉取 */
  initialDetail?: AccountDetailType | null;
  /** 保存成功后的回调（详情页用它重拉详情；列表页无需传，store 已按当前条件刷新列表） */
  onSaved?: () => void | Promise<void>;
};

const EMPTY_FORM: AccountFormValuesType = {
  name: '',
  platform: '',
  identifier: '',
  loginUrl: '',
  groupId: NO_GROUP_VALUE,
  password: '',
  totpSecret: '',
  totpIssuer: '',
  notes: '',
};

const EMPTY_ERRORS: AccountFormErrorsType = { name: null, platform: null, identifier: null, totp: null };

/** 编辑态的初始值快照：只有真正改过的字段才进 PATCH 的 secrets（见 buildEditSecrets） */
type InitialValuesType = {
  password: string;
  totpSecret: string;
  totpIssuer: string;
  /** TOTP 载荷里的 account 段不进表单，重加密时原样带回，避免用户改个 secret 把它弄丢 */
  totpAccount: string | null;
  notes: string;
};

/** 归一化用户输入的 Base32 secret：去空白与结尾 `=`，保存统一形态便于详情页直接参与计算 */
const normalizeSecret = (value: string): string => value.replace(/\s+/g, '').replace(/=+$/, '');

/** 弹窗分段标题（PRD §10.2 四段表单） */
const DialogSection = ({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) => (
  <section className="flex flex-col gap-2.5">
    <div className="flex flex-wrap items-baseline gap-x-2">
      <h3 className="text-[13px] font-semibold">{title}</h3>
      {hint ? <span className="text-muted-foreground text-xs">{hint}</span> : null}
    </div>
    {children}
  </section>
);

export const AccountDialog = observer(
  ({ open, onOpenChange, accountId = null, initialDetail = null, onSaved }: AccountDialogProps) => {
    const store = useContext(StoreContext);
    const isEdit = accountId !== null;

    const [form, setForm] = useState<AccountFormValuesType>(EMPTY_FORM);
    const [errors, setErrors] = useState<AccountFormErrorsType>(EMPTY_ERRORS);
    /** 编辑态载入详情 + 解密中的遮罩 */
    const [loading, setLoading] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    /** 解密失败的分段警告：字段留空可重填，不阻断打开（PRD §10.6 文案） */
    const [decryptWarning, setDecryptWarning] = useState<string | null>(null);
    const [initial, setInitial] = useState<InitialValuesType | null>(null);
    const [authorizations, setAuthorizations] = useState<AccountAuthorizationType[]>([]);

    const busy = submitting || loading;

    const updateField = useCallback<ChangeHandlerType>((key, value) => {
      setForm((previous) => ({ ...previous, [key]: value }) as AccountFormValuesType);
    }, []);

    /** 平台建议值：列表里已出现的平台去重排序（密文字段不参与，这里只是元数据补全） */
    const platformOptions = useMemo(() => {
      const names = new Set<string>();
      for (const account of store.accounts) {
        const value = account.platform?.trim();
        if (value) {
          names.add(value);
        }
      }
      return [...names].sort((a, b) => a.localeCompare(b));
    }, [store.accounts]);

    const resetForm = useCallback(() => {
      setForm(EMPTY_FORM);
      setErrors(EMPTY_ERRORS);
      setDecryptWarning(null);
      setInitial(null);
      setAuthorizations([]);
    }, []);

    /** 把详情（元数据 + 解密后的明文）灌进表单，并留一份初始值快照供「改动检测」用 */
    const applyDetail = useCallback(async (detail: AccountDetailType) => {
      setForm({
        name: detail.name ?? '',
        platform: detail.platform ?? '',
        identifier: detail.identifier ?? '',
        loginUrl: detail.login_url ?? '',
        groupId: detail.group_id ? String(detail.group_id) : NO_GROUP_VALUE,
        password: '',
        totpSecret: '',
        totpIssuer: '',
        notes: '',
      });
      setAuthorizations(detail.authorizations ?? []);

      const secrets = detail.secrets;
      const dek = getDek();
      const failedFields: string[] = [];
      let passwordValue = '';
      let totpPayload: TotpPayloadType | null = null;
      let notesValue = '';

      if (!dek) {
        // 解锁会话可能已被自动锁定回收：没有 DEK 解不开密文，也只能重填
        setDecryptWarning('账号库会话已锁定，请重新解锁后再编辑');
        return;
      }

      // 逐字段解密：单个字段损坏不影响其他字段回显；失败文案不暴露 GCM / AAD 细节
      if (secrets?.password) {
        try {
          passwordValue = await decryptField(
            dek,
            secrets.password.ct,
            secrets.password.iv,
            buildAad(detail.id, 'password')
          );
        } catch {
          failedFields.push('密码');
        }
      }
      if (secrets?.totp) {
        try {
          totpPayload = JSON.parse(
            await decryptField(dek, secrets.totp.ct, secrets.totp.iv, buildAad(detail.id, 'totp'))
          ) as TotpPayloadType;
        } catch {
          // 解密成功但载荷不是合法 JSON 同样按「无法解密」处理
          failedFields.push('两步验证');
        }
      }
      if (secrets?.notes) {
        try {
          notesValue = await decryptField(dek, secrets.notes.ct, secrets.notes.iv, buildAad(detail.id, 'notes'));
        } catch {
          failedFields.push('备注');
        }
      }

      setForm((previous) => ({
        ...previous,
        password: passwordValue,
        totpSecret: totpPayload?.secret ?? '',
        totpIssuer: totpPayload?.issuer ?? '',
        notes: notesValue,
      }));
      setInitial({
        password: passwordValue,
        totpSecret: totpPayload?.secret ?? '',
        totpIssuer: totpPayload?.issuer ?? '',
        totpAccount: totpPayload?.account ?? null,
        notes: notesValue,
      });
      setDecryptWarning(
        failedFields.length > 0 ? `无法解密以下字段，请检查备份或重新保存：${failedFields.join('、')}` : null
      );
    }, []);

    // 每次打开重置并载入：新建回到空表单；编辑重新拉详情现值，避免上次输入残留
    useEffect(() => {
      if (!open) {
        return;
      }

      resetForm();
      setLoading(false);

      if (accountId === null) {
        return;
      }

      let cancelled = false;
      setLoading(true);
      const load = async () => {
        // 详情页打开时父级已持有详情，直接复用；列表操作菜单进入才现场拉取
        const detail = initialDetail ?? (await store.fetchAccountDetail(accountId));
        if (cancelled) {
          return;
        }
        if (!detail) {
          // 拉取失败：store 已按后端 message toast，直接关窗，不停留在空表单上误导用户
          setLoading(false);
          onOpenChange(false);
          return;
        }
        await applyDetail(detail);
        if (!cancelled) {
          setLoading(false);
        }
      };
      void load();

      return () => {
        cancelled = true;
      };
      // 依赖只取 open / accountId：initialDetail 与 onOpenChange 是父级渲染时的新引用，
      // 纳入依赖会让弹窗开启期间被父级刷新（如授权写操作后重拉详情）重置表单
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, accountId]);

    /** 授权写操作后只重拉授权列表，不碰表单：用户可能正在改其他字段，保存时以表单为准 */
    const reloadAuthorizations = useCallback(async () => {
      if (accountId === null) {
        return;
      }
      const detail = await store.fetchAccountDetail(accountId);
      if (detail) {
        setAuthorizations(detail.authorizations ?? []);
      }
    }, [store, accountId]);

    const buildTotpPayload = useCallback(
      (accountSegment?: string | null): string | null => {
        const secret = normalizeSecret(form.totpSecret);
        if (!secret) {
          return null;
        }
        const payload: TotpPayloadType = { secret };
        const issuer = form.totpIssuer.trim();
        if (issuer) {
          payload.issuer = issuer;
        }
        if (accountSegment) {
          payload.account = accountSegment;
        }
        return JSON.stringify(payload);
      },
      [form.totpSecret, form.totpIssuer]
    );

    /**
     * 新建账号的 secrets：只加密用户真正填写的字段（空密码是合法状态，PRD §10.2）。
     *
     * 为什么「先插后更」两步走：AAD 固定绑定 account id（vaultCrypto.buildAad），而 id 只有
     * 服务端插入后才知道；用临时 id 加密会让日后解密因 AAD 不匹配永久失败。后端 PATCH
     * 支持只传 secrets 的部分更新，密码密文落地时由服务端写入 password_updated_at
     * （AccountsUpdateController），与一次性创建的语义一致。
     */
    const buildCreateSecrets = useCallback(
      async (dek: CryptoKey, id: number): Promise<AccountSecretsType | null> => {
        const secrets: AccountSecretsType = {};
        if (form.password) {
          secrets.password = await encryptField(dek, form.password, buildAad(id, 'password'));
        }
        const totpPayload = buildTotpPayload();
        if (totpPayload) {
          secrets.totp = await encryptField(dek, totpPayload, buildAad(id, 'totp'));
        }
        if (form.notes.trim()) {
          secrets.notes = await encryptField(dek, form.notes, buildAad(id, 'notes'));
        }
        return Object.keys(secrets).length > 0 ? secrets : null;
      },
      [form.password, form.notes, buildTotpPayload]
    );

    /**
     * 编辑账号的 secrets（PATCH 语义：键不存在 = 该字段保持原值）。
     *
     * - 密码没改过就不提交密文：后端只在收到新 password_ct 时才刷新 password_updated_at
     *   （AccountsUpdateController），不提交才能保留「上次改密」原日期（PRD §10.3）；
     * - 改成空串 = 显式清空（传 null，密文与 nonce 一起置 NULL）；
     * - TOTP 仅在 secret / issuer 变化时重加密，未纳入表单的 account 段原样带回。
     */
    const buildEditSecrets = useCallback(
      async (dek: CryptoKey, id: number): Promise<AccountSecretsType | null> => {
        if (!initial) {
          return null;
        }
        const secrets: AccountSecretsType = {};

        if (form.password !== initial.password) {
          secrets.password = form.password ? await encryptField(dek, form.password, buildAad(id, 'password')) : null;
        }

        const normalizedSecret = normalizeSecret(form.totpSecret);
        if (
          normalizedSecret !== normalizeSecret(initial.totpSecret) ||
          form.totpIssuer.trim() !== initial.totpIssuer.trim()
        ) {
          const totpPayload = buildTotpPayload(initial.totpAccount);
          secrets.totp = totpPayload ? await encryptField(dek, totpPayload, buildAad(id, 'totp')) : null;
        }

        if (form.notes !== initial.notes) {
          secrets.notes = form.notes.trim() ? await encryptField(dek, form.notes, buildAad(id, 'notes')) : null;
        }

        return Object.keys(secrets).length > 0 ? secrets : null;
      },
      [initial, form.password, form.totpSecret, form.totpIssuer, form.notes, buildTotpPayload]
    );

    /** 本地校验：必填 trim 非空 + 长度上限 + TOTP Base32（与后端 AccountPayload 同一口径） */
    const validate = useCallback((): boolean => {
      const trimmedName = form.name.trim();
      const trimmedPlatform = form.platform.trim();
      const trimmedIdentifier = form.identifier.trim();
      const normalizedTotp = normalizeSecret(form.totpSecret);

      const nextErrors: AccountFormErrorsType = {
        name: trimmedName ? null : '账号名称不能为空',
        platform: !trimmedPlatform
          ? '平台不能为空'
          : trimmedPlatform.length > MAX_PLATFORM_LENGTH
            ? `平台名称不能超过 ${MAX_PLATFORM_LENGTH} 个字符`
            : null,
        identifier: !trimmedIdentifier
          ? '账号标识不能为空'
          : trimmedIdentifier.length > MAX_IDENTIFIER_LENGTH
            ? `账号标识不能超过 ${MAX_IDENTIFIER_LENGTH} 个字符`
            : null,
        // 填了 secret 就必须是合法 Base32；不合法时阻止保存，清空字段即解除
        totp:
          normalizedTotp && !BASE32_PATTERN.test(normalizedTotp)
            ? 'TOTP Secret 不是合法的 Base32 字符串（仅允许 A-Z 与数字 2-7）'
            : null,
      };

      setErrors(nextErrors);
      return Object.values(nextErrors).every((message) => message === null);
    }, [form.name, form.platform, form.identifier, form.totpSecret]);

    const handleSubmit = async () => {
      if (busy) {
        return;
      }
      if (!validate()) {
        return;
      }

      const dek = getDek();
      if (!dek) {
        // 解锁会话可能已被自动锁定回收：没有 DEK 不能加密密文，也不该继续写操作
        toast('请先解锁账号库', { position: 'top-center' });
        return;
      }

      setSubmitting(true);
      try {
        const metadata = {
          name: form.name.trim(),
          platform: form.platform.trim(),
          identifier: form.identifier.trim(),
          login_url: form.loginUrl.trim(),
          group_id: form.groupId === NO_GROUP_VALUE ? null : Number(form.groupId),
        };

        if (isEdit && accountId !== null) {
          const secrets = await buildEditSecrets(dek, accountId);
          const ok = await store.updateAccount(accountId, secrets ? { ...metadata, secrets } : metadata);
          // 失败时保持弹窗打开：store 已按后端 message toast，用户改完可直接重试
          if (!ok) {
            return;
          }
        } else {
          const created = await store.createAccount(metadata);
          // 创建失败同样保持打开，避免用户重复点击产生第二个账号
          if (!created) {
            return;
          }
          const secrets = await buildCreateSecrets(dek, created.id);
          if (secrets) {
            // 密文补写失败不阻断关闭：账号已创建，用户可从列表重新进入编辑补填；
            // 跳过成功提示——这一步是创建流程的延续，再弹一次「更新成功」只会让人困惑
            await store.updateAccount(created.id, { secrets }, true);
          }
        }

        onOpenChange(false);
        await onSaved?.();
      } catch (error) {
        // WebCrypto 加密失败等本地异常：提示重试，不暴露技术细节
        toast.error(error instanceof Error ? error.message : '保存失败，请重试', { position: 'top-center' });
      } finally {
        setSubmitting(false);
      }
    };

    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[640px]" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle className="text-base">{isEdit ? '编辑账号' : '添加账号'}</DialogTitle>
            <p className="text-muted-foreground text-xs">
              {isEdit
                ? '未修改的密码 / 2FA / 备注保持原值，不会重新加密'
                : '密码可为空（如第三方登录账号）；所有凭据在浏览器本地加密后存储'}
            </p>
          </DialogHeader>

          {loading ? (
            <div className="flex items-center justify-center py-10">
              <Spinner className="text-muted-foreground size-6" />
            </div>
          ) : (
            <div className="flex max-h-[65vh] flex-col gap-5 overflow-y-auto pr-1">
              {decryptWarning ? <p className="text-destructive text-xs">{decryptWarning}</p> : null}

              <DialogSection title="基础信息">
                <BasicInfoFields
                  values={form}
                  onChange={updateField}
                  errors={errors}
                  platformOptions={platformOptions}
                  groupOptions={store.accountGroups}
                  disabled={busy}
                />
              </DialogSection>

              <DialogSection title="凭据与 2FA">
                <CredentialFields values={form} onChange={updateField} errors={errors} disabled={busy} />
              </DialogSection>

              <DialogSection title="授权关系" hint={isEdit ? undefined : '保存后可在详情页管理'}>
                <AuthorizationFields
                  accountId={accountId}
                  authorizations={authorizations}
                  onRefresh={reloadAuthorizations}
                />
              </DialogSection>

              <DialogSection title="备注">
                <NotesField values={form} onChange={updateField} disabled={busy} />
              </DialogSection>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
              取消
            </Button>
            <Button onClick={() => void handleSubmit()} disabled={busy}>
              {submitting && <Spinner />}
              {submitting ? '保存中…' : '保存'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }
);
