import { toast } from 'sonner';

/**
 * 账号删除的二次确认补充说明（PRD §10.3：会同时删除密码、2FA 与授权记录）。
 * 单行删除（操作菜单）与批量删除（批量操作条）共用同一句文案。
 */
export const ACCOUNT_DELETE_HINT = '删除后将同时清除该账号的密码、2FA 与授权记录，且无法恢复。';

/**
 * 「添加 / 编辑账号」弹窗的占位提示。
 *
 * 四段式弹窗（基础信息 / 凭据与 2FA / 授权关系 / 备注）在 task12 接入，
 * 工具栏、空态、操作菜单三处入口共用同一句提示，避免各写一份文案。
 */
export const notifyAccountDialogPending = () => {
  toast('账号弹窗将在后续任务接入', { position: 'top-center' });
};
