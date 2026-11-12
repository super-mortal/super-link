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
  importBookmarks: {
    pocket: `${API_BASE}/import/pocket`,
    browser: `${API_BASE}/import/bookmarks`,
  },
  exportData: `${API_BASE}/export/data`,
  importData: `${API_BASE}/import/data`,
  appInfo: `${API_BASE}/app-info`,
  updateApp: `${API_BASE}/app/update`,
};
