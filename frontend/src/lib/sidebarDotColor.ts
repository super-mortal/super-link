import { makeAutoObservable } from 'mobx';

/**
 * 平台 / 分组色点的自定义颜色（refinements.md §2.2）。
 *
 * 这两类色点的默认颜色来自「平台品牌色」与「分组固定色」两套映射，本身不可编辑；
 * 用户可以在行三点菜单里把色点改成调色板颜色（与标签一致）。这属于纯视觉偏好：
 *   - 不入库、不参与筛选逻辑，只影响侧栏色点显示；
 *   - 存 localStorage（与 layout / 主题偏好同层），换浏览器不同步；
 *   - 平台来自账号数据、分组是固定四项，都不存在「编辑名称 / 删除」，
 *     所以这里只存「某个名字 → 调色板颜色 key」的覆盖值。
 *
 * 用 MobX observable 而不是纯 localStorage 读取：侧栏组件是 observer，
 * 修改后需要立即重渲染，读写 localStorage 本身不会触发 React 更新。
 */

export type SidebarDotScope = 'platform' | 'group';

export const SIDEBAR_DOT_COLOR_STORAGE_KEY = 'sidebar-dot-colors';

type DotColorMap = Partial<Record<SidebarDotScope, Record<string, string>>>;

const readStored = (): DotColorMap => {
  if (typeof window === 'undefined') {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(SIDEBAR_DOT_COLOR_STORAGE_KEY);
    if (!raw) {
      return {};
    }

    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return {};
    }

    return parsed as DotColorMap;
  } catch {
    // 损坏的偏好数据按「没有覆盖」处理，不能让侧栏渲染失败
    return {};
  }
};

class SidebarDotColorStore {
  map: DotColorMap = readStored();

  constructor() {
    makeAutoObservable(this, {}, { autoBind: true });
  }

  /** 返回调色板颜色 key（如 gray / green）；undefined 表示用默认品牌色 / 分组色 */
  get(scope: SidebarDotScope, name: string): string | undefined {
    return this.map[scope]?.[name];
  }

  /** 传 null 表示恢复默认颜色 */
  set(scope: SidebarDotScope, name: string, color: string | null): void {
    const scoped = { ...(this.map[scope] ?? {}) };

    if (color === null) {
      delete scoped[name];
    } else {
      scoped[name] = color;
    }

    this.map = { ...this.map, [scope]: scoped };
    this.persist();
  }

  private persist(): void {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      window.localStorage.setItem(SIDEBAR_DOT_COLOR_STORAGE_KEY, JSON.stringify(this.map));
    } catch {
      // 隐私模式 / 配额满时写入失败：本次会话仍生效，只是下次打开丢失
    }
  }
}

export const sidebarDotColors = new SidebarDotColorStore();
