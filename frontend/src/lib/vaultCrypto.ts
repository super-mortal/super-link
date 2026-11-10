/**
 * 账号库前端加密核心（纯函数模块，不依赖 React / MobX，便于单独验证与复用）。
 *
 * 设计约束（PRD docs/prd/account-vault.md §6.5 / §7.1 / §7.6）：
 * 1. 主密码 → KEK：Argon2id（m=64MiB, t=3, p=1）为首选，但浏览器 WebCrypto **没有原生 Argon2**，
 *    项目又禁止新增 npm 依赖（`npm ci` + 锁文件固定），因此首版统一降级为
 *    PBKDF2-HMAC-SHA256 ≥ 600,000 次（PRD §7.1 明确允许该降级）。
 *    `VaultKdfParamsType.algorithm` 仍可表达 `argon2id`，未来替换实现时不必改数据格式。
 * 2. DEK：32 字节随机，AES-256-GCM 包裹后存 `wrapped_dek` + `wrap_nonce`；
 *    DEK 永远只驻留内存（由 lib/vaultSession.ts 持有），本模块不写任何存储。
 * 3. 字段级加密：AES-256-GCM、12 字节随机 nonce、AAD 固定为
 *    `v1|account:{id}|field:{password|totp|notes}`。
 * 4. base64 只用于前后端传输与 SQLite BLOB 落库的编码层，不参与任何认证计算。
 *
 * 所有函数不读写模块外状态（除 WebCrypto 调用本身），输入输出确定，可直接单测。
 */

import type { TotpPayloadType, VaultKdfParamsType, VaultSecretField, VaultSecretFieldName } from '@/lib/types.ts';
import { DEK_BYTES, DEFAULT_KDF_PARAMS, GCM_IV_BYTES } from './vaultConstants.ts';

/** 秒级时间步长与位数：PRD §7.6 固定 30 秒 / 6 位（RFC 6238 默认配置） */
const TOTP_PERIOD_SECONDS = 30;
const TOTP_DIGITS = 6;
/** 允许的时钟偏差步数：PRD §7.6 要求 ±1 个时间步 */
const TOTP_DEFAULT_WINDOW = 1;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/** 解密失败统一文案：不暴露 GCM 校验、AAD 不匹配等技术细节（PRD §7.1 备注） */
const DECRYPT_FAILED_MESSAGE = '无法解密该字段，请检查备份或重新保存';
/** 解开 wrapped_dek 失败：只会发生在主密码错误或密文损坏两种情况下，不区分提示 */
const WRAP_FAILED_MESSAGE = '主密码错误或数据已损坏';

/* ------------------------------------------------------------------ */
/* 编码工具                                                            */
/* ------------------------------------------------------------------ */

/**
 * ArrayBuffer / Uint8Array → base64。
 * 逐字节拼接而不是 `String.fromCharCode(...bytes)`：密文较长时展开参数会触发调用栈溢出。
 */
export const base64Encode = (input: ArrayBuffer | Uint8Array): string => {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
};

/**
 * base64 → Uint8Array。
 * 兼容 URL-safe 变体与换行空白，避免后端/浏览器编码差异导致解密失败。
 */
export const base64Decode = (base64: string): Uint8Array => {
  const normalized = base64.trim().replace(/-/g, '+').replace(/_/g, '/').replace(/\s+/g, '');
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

/** 生成指定长度的密码学随机字节；nonce 每次都必须新鲜，所以统一走这里 */
const randomBytes = (length: number): Uint8Array => {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
};

/* ------------------------------------------------------------------ */
/* 密钥派生与包裹（PRD §7.1）                                          */
/* ------------------------------------------------------------------ */

/** 生成 KDF 盐（16 字节随机，base64），首次初始化账号库时调用一次并随 vault_meta 保存 */
export const generateSalt = (saltBytes: number = DEFAULT_KDF_PARAMS.saltBytes ?? 16): string =>
  base64Encode(randomBytes(saltBytes));

/**
 * 主密码 + 盐 → KEK（AES-256-GCM 密钥，不可导出）。
 *
 * 迭代次数高（默认 600,000）是为了抬高离线爆破成本：数据库泄露后攻击者拿到 salt 与
 * wrapped_dek，只能对每个候选主密码重跑一次 KDF，迭代次数直接乘以单次猜测耗时。
 * 代价是解锁时前端会占用约 0.3~0.6 秒 CPU，属于可接受范围。
 */
export const deriveKek = async (
  masterPassword: string,
  saltBase64: string,
  params: VaultKdfParamsType = DEFAULT_KDF_PARAMS
): Promise<CryptoKey> => {
  if (!masterPassword) {
    throw new Error('主密码不能为空');
  }
  if (params.algorithm !== 'pbkdf2-sha256') {
    // 浏览器无原生 Argon2；此处显式拒绝而不是静默降级，避免「参数写着 argon2id、实际算法是 PBKDF2」
    throw new Error('当前运行环境不支持 Argon2id，请使用 PBKDF2 参数');
  }
  const salt = base64Decode(saltBase64);
  if (salt.length < 8) {
    throw new Error('KDF 盐长度异常');
  }
  const baseKey = await crypto.subtle.importKey('raw', textEncoder.encode(masterPassword), 'PBKDF2', false, [
    'deriveKey',
  ]);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: params.iterations, hash: params.hash },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
};

/**
 * 生成 32 字节随机 DEK（AES-256-GCM）。
 * `extractable: true` 是包裹/换主密码（重新包裹）时导出原始字节所必需；
 * 导出得到的字节只允许立即交给 WebCrypto 加密，禁止写日志、存储或透传给组件。
 */
export const generateDek = (): Promise<CryptoKey> =>
  crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);

/**
 * 用 KEK 包裹 DEK，返回 base64 密文与 12 字节 nonce。
 * 包裹层不设 AAD：其完整性已有 GCM tag 保证，且格式版本由 vault_meta.version 承载。
 */
export const wrapDek = async (kek: CryptoKey, dek: CryptoKey): Promise<VaultSecretField> => {
  const rawDek = new Uint8Array(await crypto.subtle.exportKey('raw', dek));
  if (rawDek.length !== DEK_BYTES) {
    throw new Error('数据密钥长度异常');
  }
  const iv = randomBytes(GCM_IV_BYTES);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, kek, rawDek);
  // 清掉局部引用，减少原始密钥字节在内存中的存活时间（尽力而为，JS 无法保证清零）
  rawDek.fill(0);
  return { ct: base64Encode(ct), iv: base64Encode(iv) };
};

/**
 * 用 KEK 解包 DEK。
 * GCM 校验失败即代表「主密码错误」或密文损坏；PRD 要求不提供「验证主密码」接口，
 * 主密码正确性完全由这里的 GCM tag 校验判断。
 * 返回的 DEK 保持可导出，便于「更换主密码」时用新 KEK 重新包裹而不是重新加密全部数据。
 */
export const unwrapDek = async (kek: CryptoKey, wrapped: string, nonce: string): Promise<CryptoKey> => {
  let rawDek: ArrayBuffer;
  try {
    rawDek = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64Decode(nonce) }, kek, base64Decode(wrapped));
  } catch {
    throw new Error(WRAP_FAILED_MESSAGE);
  }
  if (rawDek.byteLength !== DEK_BYTES) {
    throw new Error(WRAP_FAILED_MESSAGE);
  }
  return crypto.subtle.importKey('raw', rawDek, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
};

/* ------------------------------------------------------------------ */
/* 字段级加解密（PRD §6.5）                                            */
/* ------------------------------------------------------------------ */

/**
 * 构造 AAD：`v1|account:{id}|field:{password|totp|notes}`。
 *
 * 为什么 AAD 要绑 account id 与字段名：GCM 只保证「这段密文没被改」，不保证「这段密文属于谁」。
 * 若不绑 id，拿到数据库写权限的人可以把 A 账号的密码密文复制到 B 账号行，前端解密照样成功，
 * 用户看到的是错误的凭据；绑定 id 后该替换会因 AAD 不匹配而解密失败。绑定字段名同理，
 * 防止把 notes 的密文塞进 password 列造成「备注被当作密码复制」。
 * 前缀 `v1` 为格式版本，将来改格式时可让旧数据明确失效而不是被误读。
 */
export const buildAad = (accountId: number, field: VaultSecretFieldName): string =>
  `v1|account:${accountId}|field:${field}`;

/** 单字段加密：每次新随机 nonce，返回 base64 密文与 nonce */
export const encryptField = async (dek: CryptoKey, plaintext: string, aad: string): Promise<VaultSecretField> => {
  const iv = randomBytes(GCM_IV_BYTES);
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: textEncoder.encode(aad) },
    dek,
    textEncoder.encode(plaintext)
  );
  return { ct: base64Encode(ct), iv: base64Encode(iv) };
};

/**
 * 单字段解密；AAD 不匹配或密文被改动时 GCM 校验失败，统一抛错且不暴露细节。
 *
 * 为什么 nonce 必须每次随机：GCM 在同一密钥下复用 nonce 会泄露明文异或值并直接危及认证密钥，
 * 因此这里不做任何 nonce 复用或自增缓存，全部依赖 crypto.getRandomValues。
 */
export const decryptField = async (dek: CryptoKey, ct: string, nonce: string, aad: string): Promise<string> => {
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64Decode(nonce), additionalData: textEncoder.encode(aad) },
      dek,
      base64Decode(ct)
    );
    return textDecoder.decode(plaintext);
  } catch {
    throw new Error(DECRYPT_FAILED_MESSAGE);
  }
};

/** 便捷封装：解密 TOTP 字段的 JSON 载荷（`{secret, issuer, account}`） */
export const decryptTotpPayload = async (
  dek: CryptoKey,
  field: VaultSecretField,
  accountId: number
): Promise<TotpPayloadType> => {
  const json = await decryptField(dek, field.ct, field.iv, buildAad(accountId, 'totp'));
  try {
    return JSON.parse(json) as TotpPayloadType;
  } catch {
    throw new Error(DECRYPT_FAILED_MESSAGE);
  }
};

/* ------------------------------------------------------------------ */
/* 密码生成                                                            */
/* ------------------------------------------------------------------ */

const PASSWORD_LOWER = 'abcdefghijklmnopqrstuvwxyz';
const PASSWORD_UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const PASSWORD_DIGITS = '0123456789';
const PASSWORD_SYMBOLS = '!@#$%^&*()-_=+[]{};:,.?/';
const PASSWORD_ALL = PASSWORD_LOWER + PASSWORD_UPPER + PASSWORD_DIGITS + PASSWORD_SYMBOLS;

/**
 * 拒绝采样取 [0, maxExclusive) 的随机整数。
 * 直接 `x % n` 会带来模偏差（取值空间不是 n 的整数倍时，靠前的取值出现概率更高），
 * 因而先丢弃落在尾部不可整除区间内的随机数，再取模。
 * 取值范围超过一个字节时改用 32 位随机数（洗牌需要 n 最大到密码长度）。
 */
const randomInt = (maxExclusive: number): number => {
  if (!Number.isInteger(maxExclusive) || maxExclusive <= 0 || maxExclusive > 0x100000000) {
    throw new Error('随机数范围非法');
  }
  if (maxExclusive <= 256) {
    const byteLimit = 256 - (256 % maxExclusive);
    const buffer = new Uint8Array(1);
    for (;;) {
      crypto.getRandomValues(buffer);
      if (buffer[0] < byteLimit) {
        return buffer[0] % maxExclusive;
      }
    }
  }
  const limit = Math.floor(0x100000000 / maxExclusive) * maxExclusive;
  const buffer32 = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buffer32);
    if (buffer32[0] < limit) {
      return buffer32[0] % maxExclusive;
    }
  }
};

/**
 * 生成随机密码：大小写字母 + 数字 + 符号，默认 20 位。
 * 先保证四类字符各至少一个，再用 Fisher-Yates 洗牌打散位置
 * （否则前四位固定是「小写、大写、数字、符号」，可预测性过高）。
 */
export const generatePassword = (length = 20): string => {
  if (!Number.isInteger(length) || length < 8) {
    throw new Error('密码长度至少 8 位');
  }
  const groups = [PASSWORD_LOWER, PASSWORD_UPPER, PASSWORD_DIGITS, PASSWORD_SYMBOLS];
  const chars: string[] = groups.map((group) => group[randomInt(group.length)]);
  while (chars.length < length) {
    chars.push(PASSWORD_ALL[randomInt(PASSWORD_ALL.length)]);
  }
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    const tmp = chars[i];
    chars[i] = chars[j];
    chars[j] = tmp;
  }
  return chars.join('');
};

/* ------------------------------------------------------------------ */
/* TOTP（RFC 6238 / RFC 4226）                                        */
/* ------------------------------------------------------------------ */

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/**
 * Base32 → 字节。容忍大小写、空格与结尾 `=`（用户手抄 secret 时常见），
 * 非法字符直接抛错：宁可提示「密钥格式不正确」，也不要算出一个永远对不上的码。
 */
export const base32Decode = (secretBase32: string): Uint8Array => {
  const normalized = secretBase32.replace(/\s+/g, '').replace(/=+$/, '').toUpperCase();
  if (!normalized) {
    throw new Error('TOTP 密钥不能为空');
  }
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (let i = 0; i < normalized.length; i += 1) {
    const index = BASE32_ALPHABET.indexOf(normalized[i]);
    if (index === -1) {
      throw new Error('TOTP 密钥不是合法的 Base32 字符串');
    }
    value = ((value << 5) | index) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >>> bits) & 0xff);
      // 只保留尚未输出的低位，避免 value 无限左移溢出 32 位
      value &= (1 << bits) - 1;
    }
  }
  return new Uint8Array(out);
};

/** 计数器 → 8 字节大端（RFC 4226 §5.2） */
const counterToBytes = (counter: number): Uint8Array => {
  const bytes = new Uint8Array(8);
  let remain = counter;
  for (let i = 7; i >= 0; i -= 1) {
    bytes[i] = remain % 256;
    remain = Math.floor(remain / 256);
  }
  return bytes;
};

/** HOTP：HMAC-SHA1 + 动态截断（RFC 4226 §5.3 / §5.4） */
const hotp = async (secretBase32: string, counter: number, digits: number): Promise<string> => {
  const key = await crypto.subtle.importKey('raw', base32Decode(secretBase32), { name: 'HMAC', hash: 'SHA-1' }, false, [
    'sign',
  ]);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, counterToBytes(counter)));
  // 取最后一字节低 4 位作为偏移，向后读 4 字节，屏蔽最高位得到 31 位整数
  const offset = signature[signature.length - 1] & 0x0f;
  const binary =
    ((signature[offset] & 0x7f) << 24) |
    ((signature[offset + 1] & 0xff) << 16) |
    ((signature[offset + 2] & 0xff) << 8) |
    (signature[offset + 3] & 0xff);
  return String(binary % 10 ** digits).padStart(digits, '0');
};

export type TotpOptionsType = {
  digits?: number;
  /** 时间步长（秒） */
  period?: number;
  /** 毫秒时间戳，默认当前时间；显式传入便于按 RFC 测试向量验证 */
  timestamp?: number;
};

/**
 * 生成 TOTP 动态码（RFC 6238，HMAC-SHA1，默认 30 秒 / 6 位）。
 * 时间源取本地系统时钟，与服务器无关；偏差由调用方用 verifyTotp 的 window 容忍。
 */
export const generateTotp = async (secretBase32: string, options: TotpOptionsType = {}): Promise<string> => {
  const digits = options.digits ?? TOTP_DIGITS;
  const period = options.period ?? TOTP_PERIOD_SECONDS;
  const timestamp = options.timestamp ?? Date.now();
  const counter = Math.floor(timestamp / 1000 / period);
  return hotp(secretBase32, counter, digits);
};

/** 当前时间步剩余秒数（1~period），用于倒计时显示 */
export const totpRemaining = (period: number = TOTP_PERIOD_SECONDS, timestamp: number = Date.now()): number => {
  const elapsed = Math.floor(timestamp / 1000) % period;
  return period - elapsed;
};

/** 动态码分组显示：6 位 → `123 456`；其他位数按对半分组，便于用户读抄 */
export const formatTotp = (code: string): string => {
  const trimmed = code.trim();
  if (trimmed.length < 4) {
    return trimmed;
  }
  const half = Math.ceil(trimmed.length / 2);
  return `${trimmed.slice(0, half)} ${trimmed.slice(half)}`;
};

export type VerifyTotpOptionsType = TotpOptionsType & {
  /** 允许的时间步偏差，默认 1（即当前步 ±1 步） */
  window?: number;
};

/**
 * 校验动态码，返回是否命中当前步前后 window 个时间步。
 * 逐候选比较用全等即可：这里的比较发生在本地内存，不存在远程计时攻击面。
 */
export const verifyTotp = async (
  code: string,
  secretBase32: string,
  options: VerifyTotpOptionsType = {}
): Promise<boolean> => {
  const digits = options.digits ?? TOTP_DIGITS;
  const period = options.period ?? TOTP_PERIOD_SECONDS;
  const timestamp = options.timestamp ?? Date.now();
  const window = options.window ?? TOTP_DEFAULT_WINDOW;
  const normalized = code.replace(/\s+/g, '');
  if (!/^\d+$/.test(normalized)) {
    return false;
  }
  for (let offset = -window; offset <= window; offset += 1) {
    const candidate = await generateTotp(secretBase32, {
      digits,
      period,
      timestamp: timestamp + offset * period * 1000,
    });
    if (candidate === normalized) {
      return true;
    }
  }
  return false;
};
