import type { BackupModuleType, ServerRangeType } from '@/lib/types.ts';

const API_BASE = '/api';

export const API_ENDPOINTS = {
  items: {
    list: `${API_BASE}/items`,
    createItem: `${API_BASE}/items`,
    deleteItems: `${API_BASE}/items/delete`,
    refetchItemsMetadata: `${API_BASE}/items/fetch-metadata`,
    updateItemsTags: `${API_BASE}/items/tags`,
    updateItem: (id: any) => `${API_BASE}/items?item-id=${id}`,
  },
  settings: {
    getUser: `${API_BASE}/settings/user`,
    create: `${API_BASE}/settings/user`,
    userName: `${API_BASE}/settings/username`,
    password: `${API_BASE}/settings/password`,
    delete: `${API_BASE}/settings/user`,
    /** O-5：GitHub 网络访问三档设置（设置页「网络」分区） */
    network: `${API_BASE}/settings/network`,
    /** 测试连接：只做 HEAD 探测，不执行真实 clone */
    networkTest: `${API_BASE}/settings/network/test`,
  },
  tags: {
    // 标签按模块隔离（PRD O-9）：拉取必须带 module（bookmarks / skills），
    // 后端缺省或非法值时按 bookmarks 过滤（兼容不带该参数的旧前端）
    list: (module: string) => `${API_BASE}/tags?module=${module}`,
    create: `${API_BASE}/tags`,
    deleteTag: (id: any) => `${API_BASE}/tags?tag-id=${id}`,
    update: (id: any) => `${API_BASE}/tags/update?tag-id=${id}`,
    updateColor: (id: any) => `${API_BASE}/tags/update-color?tag-id=${id}`,
    updatePinned: (id: any) => `${API_BASE}/tags/update-pinned?tag-id=${id}`,
  },
  skills: {
    list: `${API_BASE}/skills`,
    install: `${API_BASE}/skills/install`,
    upload: `${API_BASE}/skills/upload`,
    detail: (id: number) => `${API_BASE}/skills/detail?id=${id}`,
    deleteSkills: `${API_BASE}/skills/delete`,
    tags: `${API_BASE}/skills/tags`,
    checkUpdates: `${API_BASE}/skills/check-updates`,
    update: `${API_BASE}/skills/update`,
    exportSkill: (id: number) => `${API_BASE}/skills/export?id=${id}`,
  },
  auth: {
    login: `${API_BASE}/auth/login`,
    logout: `${API_BASE}/auth/logout`,
  },
  /** 账号库密钥元信息：服务端只存密文与 KDF 参数，不参与加解密（PRD §8.1） */
  vault: {
    meta: `${API_BASE}/vault/meta`,
    setup: `${API_BASE}/vault/setup`,
    changeMaster: `${API_BASE}/vault/change-master`,
    reset: `${API_BASE}/vault/reset`,
    /** GET 导出加密备份（响应体即 .slvault 文件内容，只有密文） */
    export: `${API_BASE}/vault/export`,
    /** POST 导入加密备份（multipart：file + mode） */
    import: `${API_BASE}/vault/import`,
  },
  /** 账号（PRD §8.2）：只传元数据与密文，任何端点都不返回明文 */
  accounts: {
    list: `${API_BASE}/accounts`,
    detail: (id: number) => `${API_BASE}/accounts/detail?id=${id}`,
    create: `${API_BASE}/accounts`,
    /** PATCH /api/accounts：id 放请求体，后端从合并后的入参里读 */
    update: `${API_BASE}/accounts`,
    delete: `${API_BASE}/accounts/delete`,
    authorizations: {
      create: `${API_BASE}/accounts/authorizations`,
      update: `${API_BASE}/accounts/authorizations/update`,
      delete: `${API_BASE}/accounts/authorizations/delete`,
    },
  },
  setup: {
    setup: `${API_BASE}/setup/database`,
  },
  /** 服务器监控（PRD docs/prd/server.md §6）：id 一律查询串传递（Router 无路径参数） */
  servers: {
    list: `${API_BASE}/servers`,
    create: `${API_BASE}/servers`,
    /** PATCH /api/servers：id 走查询串，改名 / 备注 / 分组 / 暂停恢复字段走请求体 */
    update: (id: number) => `${API_BASE}/servers?server-id=${id}`,
    /** POST /api/servers/delete：删除连同历史数据（级联由后端同一事务完成） */
    delete: (id: number) => `${API_BASE}/servers/delete?server-id=${id}`,
    detail: (id: number) => `${API_BASE}/servers/detail?server-id=${id}`,
    /** GET /api/servers/metrics：range 白名单 1h|6h|24h|30d，后端缺省或非法值 400 */
    metrics: (id: number, range: ServerRangeType) => `${API_BASE}/servers/metrics?server-id=${id}&range=${range}`,
    /** POST /api/servers/token：重置 Token，旧 Token 立即失效，响应含明文且 no-store */
    token: (id: number) => `${API_BASE}/servers/token?server-id=${id}`,
  },
  importBookmarks: {
    pocket: `${API_BASE}/import/pocket`,
    browser: `${API_BASE}/import/bookmarks`,
  },
  /** 备份（refinements.md §4）：GET 下发备份文件内容，POST 走 multipart 恢复（默认登录态 + CSRF） */
  backup: {
    /** GET /api/backup/<module>：响应体即 super-link-<module>-YYYYMMDD.json 内容（no-store） */
    export: {
      bookmarks: `${API_BASE}/backup/bookmarks`,
      skills: `${API_BASE}/backup/skills`,
      servers: `${API_BASE}/backup/servers`,
    } satisfies Record<BackupModuleType, string>,
    /** POST /api/backup/<module>/restore：multipart 字段 file + mode + dry_run */
    restore: {
      bookmarks: `${API_BASE}/backup/bookmarks/restore`,
      skills: `${API_BASE}/backup/skills/restore`,
      servers: `${API_BASE}/backup/servers/restore`,
    } satisfies Record<BackupModuleType, string>,
  },
  exportData: `${API_BASE}/export/data`,
  importData: `${API_BASE}/import/data`,
  appInfo: `${API_BASE}/app-info`,
  updateApp: `${API_BASE}/app/update`,
};
