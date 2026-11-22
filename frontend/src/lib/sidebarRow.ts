/**
 * 侧栏第二区（标签 / 平台 / 分组）统一几何常量。
 *
 * 数值来源：docs/prd/refinements.md §2.1（第二区统一外壳）与 §2.2（行规格）。
 * 组件只引用这里，禁止在 NavTags / NavPlatforms / NavServerGroups 或 SidebarTag 里再写一份，
 * 否则三套实现又会出现行高、缩进、计数字号不一致的问题。
 */

/** §2.1 分区容器：上边框 + 0.5rem 上内边距（SidebarGroup 自带 p-2）；头部与列表体间距 0.5rem */
export const SIDEBAR_SECTION_GROUP_CLASS = 'border-sidebar-border mt-1 gap-2 border-t';

/** §2.1 头部：固定 2rem 高，左侧标题 + 右侧动作区 */
export const SIDEBAR_SECTION_HEADER_CLASS = 'me-1 flex h-8 items-center gap-2';

/** §2.1 搜索态：输入框 2rem，与头部同高，替换头部时列表起始位置不变 */
export const SIDEBAR_SECTION_SEARCH_CLASS = 'relative flex h-8 w-full items-center';

/** §2.1 动作位：搜索 / 更多各 1.25rem；缺失的动作渲染同尺寸不可见占位，保证位置稳定 */
export const SIDEBAR_SECTION_ACTION_CLASS =
  'flex size-5 flex-none items-center justify-center rounded-md text-sidebar-foreground outline-hidden transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring [&>svg]:size-4 [&>svg]:shrink-0';

/** §2.2 行：高 2rem；右侧留 3rem 给计数 / 三点，名称不会被遮挡 */
export const SIDEBAR_ROW_CLASS =
  'peer/row group/row flex h-8 w-full min-w-0 items-center gap-2 overflow-hidden rounded-md pe-12 ps-0 text-left text-sm outline-hidden transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring';

/** §2.1 列表体行间距 0.25rem（SidebarMenu 默认 gap-1，这里集中声明避免各处手写） */
export const SIDEBAR_ROW_LIST_GAP_CLASS = 'gap-1';

/** §2.2 左侧槽位：1.5rem（标签 chevron 槽；平台 / 分组留空但保留占位） */
export const SIDEBAR_ROW_SLOT_CLASS = 'flex w-6 flex-none items-center justify-center';

/** §2.2 颜色点：0.625rem 圆点，与名称间距 0.5rem（行内 gap-2） */
export const SIDEBAR_ROW_DOT_CLASS = 'size-2.5 flex-none rounded-full';

/** §2.2 右侧计数：距右 0.25rem、11px、透明度 0.8、等宽数字 */
export const SIDEBAR_ROW_COUNT_CLASS =
  'pointer-events-none absolute top-1/2 right-1 -translate-y-1/2 text-[11px] font-medium tabular-nums opacity-80';

/** §2.2 三点容器：右偏移 -0.25rem，使按钮中心与计数中心对齐（不再偏左） */
export const SIDEBAR_ROW_ACTION_OFFSET_CLASS = '-right-1';

/** §2.2 三点按钮：1.5rem 圆形热区，前景用 --foreground（比侧栏前景更深），默认隐藏、hover 行才出现 */
export const SIDEBAR_ROW_ACTION_CLASS =
  'flex size-6 items-center justify-center rounded-full text-foreground transition-[opacity,transform] [&>svg]:size-4.5';

/** §2.2 三点外层：hover 行 / 按钮自身 hover / 菜单展开时显示 */
export const SIDEBAR_ROW_ACTION_WRAPPER_CLASS =
  'absolute top-1 flex opacity-0 transition-opacity peer-hover/row:opacity-100 hover:opacity-100 focus-within:opacity-100 has-[[data-state=open]]:opacity-100';
