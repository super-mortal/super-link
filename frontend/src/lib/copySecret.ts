import { toast } from 'sonner';

/**
 * 统一复制入口（PRD §7.3 / §9.4）。
 *
 * 只负责写入剪贴板并提示「已复制」：不做定时清空（PRD 明确的取舍），
 * 提示语写死「已复制」——调用方传进来的可能就是明文密码，
 * toast 里绝不出现被复制的内容，避免明文进入通知中心与日志。
 * 失败（非安全上下文 / 权限被拒）时提示手动复制，不吞异常。
 */
export const copySecret = async (value: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(value);
    toast.success('已复制', { position: 'top-center' });
    return true;
  } catch {
    toast.error('复制失败，请手动复制', { position: 'top-center' });
    return false;
  }
};
