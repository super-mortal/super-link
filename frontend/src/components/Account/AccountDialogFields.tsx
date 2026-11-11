import { useState } from 'react';
import { Eye, EyeOff, KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/button.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Textarea } from '@/components/ui/textarea.tsx';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select.tsx';
import { AccountFormField } from '@/components/Account/AccountFormField.tsx';
import { AuthorizationList } from '@/components/Account/AuthorizationList.tsx';
import { generatePassword } from '@/lib/vaultCrypto.ts';
import type { AccountAuthorizationType } from '@/lib/types.ts';

/**
 * 账号弹窗（AccountDialog）的四段表单字段（PRD §10.2）。
 * 与弹窗逻辑拆开：这一文件只做受控渲染，状态、校验、加解密都在 AccountDialog。
 */

/** 弹窗表单的可编辑字段；编辑态的初始值快照由弹窗另行持有，用于「只提交改动的字段」 */
export type AccountFormValuesType = {
  name: string;
  platform: string;
  identifier: string;
  loginUrl: string;
  groupId: string;
  password: string;
  totpSecret: string;
  totpIssuer: string;
  notes: string;
};

/** 就地显示的字段级错误（本地校验，PRD §8.3：不弹统一「操作失败」） */
export type AccountFormErrorsType = {
  name: string | null;
  platform: string | null;
  identifier: string | null;
  totp: string | null;
};

/** Radix Select 不允许空字符串 value，「不分组」用哨兵值表示（与授权弹窗同一手法） */
export const NO_GROUP_VALUE = 'none';

/** 长度上限与后端 AccountPayload 保持一致，前端先拦，少一次无效请求 */
export const MAX_PLATFORM_LENGTH = 40;
export const MAX_IDENTIFIER_LENGTH = 190;

/** Base32 宽松校验：去空格与结尾 `=` 后仅允许 A-Z 与 2-7（RFC 4648 字母表；大小写都收，base32Decode 会统一转大写） */
export const BASE32_PATTERN = /^[A-Z2-7]+$/i;

/**
 * 字段更新签名：表单纯文本字段，键与取值都是字符串，用普通函数签名即可（无需泛型）。
 * 弹窗统一经 setForm 合并，字段组件不直接持有状态。
 */
export type FieldKeyType = keyof AccountFormValuesType;
export type ChangeHandlerType = (key: FieldKeyType, value: string) => void;

/** 第一段：基础信息（PRD §10.2） */
export const BasicInfoFields = ({
  values,
  onChange,
  errors,
  platformOptions,
  groupOptions,
  disabled,
}: {
  values: AccountFormValuesType;
  onChange: ChangeHandlerType;
  errors: AccountFormErrorsType;
  /** 平台建议值：来自列表里已出现的平台（去重排序），仅作提示不构成枚举 */
  platformOptions: string[];
  groupOptions: { id: number; name: string }[];
  disabled: boolean;
}) => (
  <div className="grid gap-4 sm:grid-cols-2">
    <AccountFormField label="显示名称" htmlFor="account-name" required error={errors.name}>
      <Input
        id="account-name"
        value={values.name}
        onChange={(event) => onChange('name', event.target.value)}
        placeholder="如 GitHub 主账号"
        autoComplete="off"
        disabled={disabled}
        aria-invalid={errors.name ? true : undefined}
      />
    </AccountFormField>

    <AccountFormField
      label="平台"
      htmlFor="account-platform"
      required
      error={errors.platform}
      hint={platformOptions.length > 0 ? '可输入新平台，也可从建议值选择' : undefined}
    >
      <Input
        id="account-platform"
        list="account-platform-options"
        value={values.platform}
        onChange={(event) => onChange('platform', event.target.value)}
        placeholder="如 GitHub、Google"
        autoComplete="off"
        disabled={disabled}
        aria-invalid={errors.platform ? true : undefined}
      />
      {/* 用原生 datalist 而不是 @base-ui/react 的 combobox：平台字段绝大多数情况是直接输入，
          建议值只是补全提示；combobox 需要管理 items / anchor / 键盘高亮一整套状态
          （见 EditItem/TagSelect 的多选标签场景），对单输入框过重 */}
      <datalist id="account-platform-options">
        {platformOptions.map((item) => (
          <option key={item} value={item} />
        ))}
      </datalist>
    </AccountFormField>

    <AccountFormField label="账号标识" htmlFor="account-identifier" required error={errors.identifier}>
      <Input
        id="account-identifier"
        value={values.identifier}
        onChange={(event) => onChange('identifier', event.target.value)}
        placeholder="如 mortal@gmail.com"
        autoComplete="off"
        disabled={disabled}
        aria-invalid={errors.identifier ? true : undefined}
      />
    </AccountFormField>

    <AccountFormField
      label="分组"
      htmlFor="account-group"
      hint={groupOptions.length === 0 ? '暂无可用分组（分组从已有账号派生）' : undefined}
    >
      <Select
        value={values.groupId}
        onValueChange={(value) => onChange('groupId', value)}
        disabled={disabled || groupOptions.length === 0}
      >
        <SelectTrigger id="account-group" className="w-full">
          <SelectValue placeholder="选择分组" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NO_GROUP_VALUE}>不分组</SelectItem>
          {groupOptions.map((item) => (
            <SelectItem key={item.id} value={String(item.id)}>
              {item.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </AccountFormField>

    <AccountFormField label="登录地址" htmlFor="account-login-url" className="sm:col-span-2">
      <Input
        id="account-login-url"
        value={values.loginUrl}
        onChange={(event) => onChange('loginUrl', event.target.value)}
        placeholder="如 https://github.com/login"
        autoComplete="off"
        disabled={disabled}
      />
    </AccountFormField>
  </div>
);

/** 第二段：凭据与 2FA（PRD §10.2：密码显示/隐藏 + 生成 20 位强密码） */
export const CredentialFields = ({
  values,
  onChange,
  errors,
  disabled,
}: {
  values: AccountFormValuesType;
  onChange: ChangeHandlerType;
  errors: AccountFormErrorsType;
  disabled: boolean;
}) => {
  // 明文切换状态只在本段存活：弹窗关闭即卸载，重开自动回到掩码态（PRD §7.4）
  const [passwordVisible, setPasswordVisible] = useState(false);

  const handleGenerate = () => {
    // 生成后立即展开明文：用户需要看见刚生成的密码才能抄录 / 确认
    onChange('password', generatePassword(20));
    setPasswordVisible(true);
  };

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <AccountFormField
        label="密码"
        htmlFor="account-password"
        className="sm:col-span-2"
        hint="可为空，如通过第三方登录的账号不需要存密码"
      >
        <div className="flex items-center gap-1.5">
          <Input
            id="account-password"
            type={passwordVisible ? 'text' : 'password'}
            value={values.password}
            onChange={(event) => onChange('password', event.target.value)}
            placeholder="可为空"
            // new-password：避免浏览器把已存密码自动填进来，掩盖用户真实输入
            autoComplete="new-password"
            disabled={disabled}
            className="min-w-0 flex-1 font-mono"
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="shrink-0"
            onClick={() => setPasswordVisible((visible) => !visible)}
            disabled={disabled}
            title={passwordVisible ? '隐藏密码' : '显示密码'}
            aria-label={passwordVisible ? '隐藏密码' : '显示密码'}
          >
            {passwordVisible ? <EyeOff /> : <Eye />}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={handleGenerate}
            disabled={disabled}
            title="生成 20 位强密码"
          >
            <KeyRound />
            <span className="hidden sm:inline">生成</span>
          </Button>
        </div>
      </AccountFormField>

      <AccountFormField
        label="TOTP Secret"
        htmlFor="account-totp-secret"
        error={errors.totp}
        hint="Base32 密钥，留空表示不开启两步验证"
      >
        <Input
          id="account-totp-secret"
          value={values.totpSecret}
          onChange={(event) => onChange('totpSecret', event.target.value)}
          placeholder="如 JBSWY3DPEHPK3PXP"
          autoComplete="off"
          disabled={disabled}
          className="font-mono"
          aria-invalid={errors.totp ? true : undefined}
        />
      </AccountFormField>

      <AccountFormField label="发行方（issuer）" htmlFor="account-totp-issuer">
        <Input
          id="account-totp-issuer"
          value={values.totpIssuer}
          onChange={(event) => onChange('totpIssuer', event.target.value)}
          placeholder="如 GitHub"
          autoComplete="off"
          disabled={disabled}
        />
      </AccountFormField>
    </div>
  );
};

/** 第四段：备注（加密保存，保留换行） */
export const NotesField = ({
  values,
  onChange,
  disabled,
}: {
  values: AccountFormValuesType;
  onChange: ChangeHandlerType;
  disabled: boolean;
}) => (
  <AccountFormField
    label="备注"
    htmlFor="account-notes"
    hint="恢复方式、安全问题、备用邮箱等；内容加密保存，服务端看不到"
  >
    <Textarea
      id="account-notes"
      rows={4}
      value={values.notes}
      onChange={(event) => onChange('notes', event.target.value)}
      placeholder="如 恢复码放在办公室保险柜"
      disabled={disabled}
    />
  </AccountFormField>
);

/**
 * 第三段：授权关系（PRD §10.2）。
 *
 * 新建与编辑采用不同形态是有意的：授权写接口要求 account_id 必填（后端
 * AccountPayload::requiredAuthorizationAccountId），而新建时 id 要等服务端插入后
 * 才知道。与其在弹窗里自建未提交草稿（前端要维护两份授权状态、保存顺序也变得隐式），
 * 不如保存成功后引导到详情页的「授权关系」区添加——与后端契约一致，逻辑也简单。
 * 编辑态直接复用详情页同一套 AuthorizationList：增 / 改 / 删授权的行为完全一致，
 * 不做第二份实现。
 */
export const AuthorizationFields = ({
  accountId,
  authorizations,
  onRefresh,
}: {
  /** 编辑态的账号 id；null = 新建态（账号尚未落库） */
  accountId: number | null;
  authorizations: AccountAuthorizationType[];
  /** 授权写操作后重拉授权列表（只更新授权，不动弹窗里正在编辑的表单字段） */
  onRefresh: () => Promise<void>;
}) => {
  if (accountId === null) {
    return (
      <div className="text-muted-foreground rounded-md border border-dashed px-3 py-4 text-center text-xs">
        授权关系（站点、站点账号、关联账号）保存成功后，可在详情页「授权关系」区添加
      </div>
    );
  }

  return <AuthorizationList authorizations={authorizations} accountId={accountId} onRefresh={onRefresh} />;
};
