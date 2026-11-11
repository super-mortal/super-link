import { deriveKek, unwrapDek } from '@/lib/vaultCrypto.ts';
import { DEFAULT_KDF_MEMORY_KIB, DEFAULT_KDF_PARALLELISM, DEFAULT_KDF_PARAMS } from '@/lib/vaultConstants.ts';
import type { VaultBackupType, VaultKdfParamsType } from '@/lib/types.ts';

/**
 * 加密备份文件（.slvault）的导入前置处理（PRD §8.1「需主密码解密校验后合并/覆盖」）。
 *
 * 为什么校验放在浏览器：服务端没有 DEK，判断不了「主密码是否正确、密文是否完好」。
 * 前端用文件里的 salt + KDF 参数派生 KEK，尝试解包 wrapped_dek——GCM 校验失败即
 * 密码错误或文件损坏。这一步不过，根本不该把文件发给后端，避免导入一份解不开的
 * 备份把当前账号库搅乱（尤其是 replace 模式会直接换掉 vault_meta）。
 *
 * 本模块只做「解析 + 验密」，不持有任何密钥状态；解出的 DEK 验证后立即丢弃，
 * 不写入 vaultSession——导入后会话必须重新解锁（见 Settings/Vault 导入成功后的处理）。
 */

/**
 * 校验结果：ok 为 false 时 message 是可直接展示给用户的中文提示，ok 为 true 时为空串。
 * （不用可辨识联合 + 真值窄化：本项目 strict:false，布尔判别式不会窄化，会编译报错。）
 */
export type VaultBackupVerifyResultType = {
  ok: boolean;
  message: string;
};

/**
 * 解析备份文件文本，做结构校验（顶层字段 + accounts 数组）。
 *
 * 只做「结构合法」判断，不校验密文内容；与后端 VaultBackupPayload 的校验口径一致，
 * 前端先挡掉明显不合格的文件，细粒度校验（长度、base64、nonce 12 字节）仍由后端兜底。
 * 返回 null 表示结构不合法（调用方给统一提示，不逐一区分原因）。
 */
export const parseVaultBackup = (text: string): VaultBackupType | null => {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }

  if (typeof data !== 'object' || data === null) {
    return null;
  }

  const backup = data as Partial<VaultBackupType>;

  if (
    typeof backup.version !== 'number' ||
    !Number.isInteger(backup.version) ||
    backup.version <= 0 ||
    typeof backup.kdf !== 'string' ||
    typeof backup.kdf_iterations !== 'number' ||
    typeof backup.kdf_memory !== 'number' ||
    typeof backup.kdf_parallelism !== 'number' ||
    typeof backup.salt !== 'string' ||
    typeof backup.wrapped_dek !== 'string' ||
    typeof backup.wrap_nonce !== 'string' ||
    !Array.isArray(backup.accounts)
  ) {
    return null;
  }

  // accounts 至少每条要有 id / name，避免把明显不是备份的 JSON 当备份继续走验密流程
  const accountsValid = backup.accounts.every(
    (account) =>
      typeof account === 'object' &&
      account !== null &&
      typeof (account as { id?: unknown }).id === 'number' &&
      typeof (account as { name?: unknown }).name === 'string'
  );
  if (!accountsValid) {
    return null;
  }

  return backup as VaultBackupType;
};

/** 备份文件里的 KDF 参数 -> deriveKek 入参；缺省值只在文件字段缺失时兜底（parse 已保证存在） */
const kdfParamsOfBackup = (backup: VaultBackupType): VaultKdfParamsType => ({
  algorithm: backup.kdf,
  iterations: backup.kdf_iterations,
  hash: DEFAULT_KDF_PARAMS.hash,
  memory: backup.kdf_memory ?? DEFAULT_KDF_MEMORY_KIB,
  parallelism: backup.kdf_parallelism ?? DEFAULT_KDF_PARALLELISM,
});

/**
 * 用备份的主密码做解密校验：派生 KEK -> 解包 wrapped_dek。
 *
 * 成功只说明「密码正确且文件完好」，不代表可以继续用当前会话——replace 导入后
 * vault_meta 会换成备份的 wrapped_dek，当前内存里的 DEK 与新包裹信息不再匹配，
 * 必须重新解锁（导入成功后的锁定 + 重新拉取 meta 由调用方负责）。
 */
export const verifyVaultBackup = async (
  backup: VaultBackupType,
  password: string
): Promise<VaultBackupVerifyResultType> => {
  if (backup.kdf !== DEFAULT_KDF_PARAMS.algorithm) {
    // 备份记录的是 argon2id 而当前浏览器只有 PBKDF2 实现：这不是密码问题，必须区分提示，
    // 否则用户会反复重试一个永远不可能正确的密码
    return { ok: false, message: '当前浏览器不支持该备份使用的加密算法' };
  }

  try {
    const kek = await deriveKek(password, backup.salt, kdfParamsOfBackup(backup));
    await unwrapDek(kek, backup.wrapped_dek, backup.wrap_nonce);
    return { ok: true, message: '' };
  } catch {
    // 统一文案：不区分「密码错误」与「文件损坏」，避免给持文件者额外信号
    return { ok: false, message: '主密码错误或备份文件已损坏' };
  }
};
