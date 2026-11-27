import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { LayoutType, ModuleKey } from '@/lib/types.ts';
import { MODULES } from '@/lib/modules.ts';
import { VisibilityState } from '@tanstack/react-table';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const colorMap = {
  gray: 'bg-gray-600',
  green: 'bg-green-600',
  red: 'bg-red-600',
  yellow: 'bg-yellow-600',
  aqua: 'bg-blue-600',
  'white ': 'bg-neutral-300',
  black: 'bg-neutral-950',
};

export const getColorClass = (color: string | undefined) => {
  return colorMap[color as keyof typeof colorMap] || colorMap.gray;
};

export const normalizeQuery = (val) => {
  return val
    .trim()
    .replace(/\/+/g, '/')
    .replace(/^\/|\/$/g, '')
    .trim();
};

export const getSavedLayoutPreference = (): LayoutType => {
  return (localStorage.getItem('layout') as LayoutType) || 'list';
};

export const saveLayoutPreference = (value: LayoutType): void => {
  try {
    localStorage.setItem('layout', value);
  } catch {
    // Ignore storage errors - failing silently is acceptable for preferences
  }
};

const isLayoutType = (value: string): value is LayoutType => value === 'list' || value === 'cards' || value === 'table';

/**
 * 按模块记忆布局（PRD docs/prd/todo.md §5.1 / T3）：存储 key 为 `layout-<module>`，
 * 与全局 `layout` 分开，书签 / Skill / 账号库继续走 getSavedLayoutPreference()。
 * 首次进入（无存储）用调用方传入的 fallback（待办传 defaultLayout=cards）；存量值不在
 * 本模块可用布局内（如待办切到 table）时回落列表，避免渲染出该模块没有的视图。
 */
export const getSavedLayoutPreferenceForModule = (module: ModuleKey, fallback: LayoutType): LayoutType => {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(`layout-${module}`);
  } catch {
    return fallback;
  }
  if (!stored || !isLayoutType(stored)) {
    return fallback;
  }
  const allowed = MODULES[module].layouts;
  if (allowed && !allowed.some((layout) => layout === stored)) {
    return 'list';
  }
  return stored;
};

export const saveLayoutPreferenceForModule = (module: ModuleKey, layout: LayoutType): void => {
  try {
    localStorage.setItem(`layout-${module}`, layout);
  } catch {
    // Ignore storage errors - failing silently is acceptable for preferences
  }
};

export const getSavedLayoutColumnVisibilityPreference = (module: ModuleKey, layout: LayoutType): VisibilityState => {
  const defaultPref = {
    updated_at: false,
  };
  try {
    const stored = localStorage.getItem(`column-visibility-${module}-${layout}`);
    return stored ? JSON.parse(stored) : defaultPref;
  } catch {
    return defaultPref;
  }
};

export const saveLayoutColumnVisibilityPreference = (
  module: ModuleKey,
  layout: LayoutType,
  columnVisibility: VisibilityState
): void => {
  try {
    localStorage.setItem(`column-visibility-${module}-${layout}`, JSON.stringify(columnVisibility));
  } catch {
    // Ignore storage errors - failing silently is acceptable for preferences
  }
};

export const getCookie = (name: string) => {
  // Add a semicolon to the beginning of the cookie string to handle the first cookie
  const cookieString = '; ' + document.cookie;

  // Split the string at the specified cookie name
  const parts = cookieString.split('; ' + name + '=');

  // If the cookie was found (the array has more than one part)
  if (parts.length === 2) {
    // Return the value, which is everything after the '=' and before the next ';'
    return parts.pop().split(';').shift();
  }
  // If the cookie was not found
  return null;
};

export const safeDecodeURIComponent = (encodedURI: string): string => {
  try {
    return encodedURI ? decodeURIComponent(encodedURI) : '';
  } catch {
    return encodedURI || '';
  }
};

export const safeDecodeURI = (encodedURI: string): string => {
  try {
    return encodedURI ? decodeURI(encodedURI) : '';
  } catch {
    return encodedURI || '';
  }
};
