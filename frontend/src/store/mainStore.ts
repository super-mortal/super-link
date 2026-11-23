import { makeAutoObservable } from 'mobx';
import { toast } from 'sonner';
import { API_ENDPOINTS } from './api';
import {
  AccountDetailType,
  AccountGroupType,
  AccountListParamsType,
  AccountType,
  AuthorizationInputType,
  AccountAuthorizationType,
  AccountInputType,
  BackupModuleType,
  BackupRestoreModeType,
  BackupRestoreResultType,
  CreateUserType,
  GithubAccessModeType,
  ItemType,
  LoginType,
  ModuleKey,
  NetworkSettingsType,
  NetworkTestResultType,
  ServerCreateResultType,
  ServerDetailType,
  ServerGroupCountsType,
  ServerInputType,
  ServerItemType,
  ServerListParamsType,
  ServerMetricsSeriesType,
  ServerOrderType,
  ServerRangeType,
  ServerSortType,
  ServerTokenResponseType,
  ServerUpdateType,
  ServerWithStatusType,
  SkillDetailType,
  SkillType,
  SkillUpdateType,
  TagFilterType,
  TagsObjectType,
  TagType,
  UpdatePasswordType,
  UpdateUsernameType,
  UserType,
  VaultImportModeType,
  VaultMetaPayloadType,
  VaultMetaType,
} from '@/lib/types.ts';
import { DEFAULT_MODULE } from '@/lib/modules.ts';
import { SERVER_STATUS_ORDER } from '@/lib/serverFormat.ts';
import { getCookie } from '@/lib/utils.ts';
import { preferencesStore } from './preferencesStore.ts';

/**
 * 标签字典按模块隔离（PRD O-9）：只有书签 / Skill 两本标签字典，
 * 账号库没有标签入口，兜底按 bookmarks 处理。
 */
const tagModuleOf = (module: ModuleKey): 'bookmarks' | 'skills' => (module === 'skills' ? 'skills' : 'bookmarks');

/**
 * 更新成功的一次性结果键。
 * ReleaseNotesDialog 在检测到新版本、刷新页面前写入 { from, to }，
 * 刷新后由 getAppInfo() 消费并提示，读取后立即删除，避免重复弹窗。
 */
export const UPDATE_RESULT_KEY = 'super-link:update-result';

class MainStore {
  prefStore: typeof preferencesStore;
  items: ItemType[] = [];
  skills: SkillType[] = [];
  /** 当前模块：书签 / Skill。标签筛选随模块切换重置 */
  module: ModuleKey = DEFAULT_MODULE;
  /** 当前模块的标签字典（PRD O-9 起按模块隔离，不再全局一份） */
  tags: TagsObjectType = [];
  user: UserType | null = null;
  isAuthRequired = null;
  isSetupRequired = null;
  isSettingsModalOpen: boolean = false;
  preSelectedItemSettingsModal: string | null = null;
  tagFilter: TagFilterType = null; // Default to null for no tag selected. 'none' for without any tags
  isItemModalOpen: boolean = false;
  isInstallSkillDialogOpen: boolean = false;
  modalOpenItemID: number | null = null;
  appInfo: {
    installed_version: string | null;
    latest_version: string | null;
    update_available: boolean | null;
    /**
     * 最新 GitHub Release 的说明信息（O-4）：随 app-info 一起下发，与版本号共用 12 小时缓存。
     * GitHub 不可达、release 未填写说明或后端较旧没有该字段时为 null，前端按降级处理。
     */
    latest_release?: {
      name: string | null;
      body: string | null;
      published_at: string | null;
      html_url: string | null;
    } | null;
  } | null = null;
  /**
   * 「设置 → 网络」的 GitHub 访问配置（O-5）：三档策略 + 代理前缀 + 版本检查开关。
   * 打开设置对话框时拉取，保存后以响应刷新；null 表示尚未加载。
   */
  networkSettings: NetworkSettingsType | null = null;

  /* ----------------------------- 账号库（PRD §5.1.1 模块隔离） ----------------------------- */
  /**
   * 账号列表数据：独立集合，绝不复用书签 / Skill 的 items / skills。
   * 锁定态也保留这份元数据——侧栏平台计数需要在未解锁时可见（PRD §10.1）；
   * 密文只在详情接口按需拉取，解密结果进 vaultSession 内存缓存，不进本 store。
   */
  accounts: AccountType[] = [];
  /** 分组字典：后端暂无独立分组接口，从账号列表响应的 group_id / group 派生 */
  accountGroups: AccountGroupType[] = [];
  /** 列表查询总数（后端返回的 total），随 fetchAccounts 更新 */
  accountTotal = 0;
  /** 最近一次拉取的账号详情（含授权关系）；仅内存态，不进 URL / 存储 */
  currentAccount: AccountDetailType | null = null;
  /** 最近一次列表查询参数：写操作后按同一条件刷新，避免筛选 / 排序被重置 */
  accountListParams: AccountListParamsType = {};

  /* ----------------------------- 服务器监控（PRD §5.1 / §5.5，模块隔离） ----------------------------- */
  /**
   * 服务器列表数据：独立集合，与书签 / Skill / 账号库完全隔离（PRD §5.1.1 同款模块隔离）。
   * 后端返回搜索 / 分组 / 排序条件下的全量结果，分页由前端做（与账号库一致）。
   */
  servers: ServerItemType[] = [];
  /** 列表查询总数（后端返回的 total），随 fetchServers 更新 */
  serverTotal = 0;
  /** 侧栏分组计数：四项分组恒定出现（为 0 也返回），按搜索命中全集统计，不受分组筛选影响 */
  serverGroups: ServerGroupCountsType = {};
  /** 最近一次拉取的服务器详情（含最新 Docker 快照）；仅内存态，不进 URL / 存储 */
  currentServer: ServerDetailType | null = null;
  /** 最近一次历史指标序列（详情页图表用）；仅内存态 */
  serverMetrics: ServerMetricsSeriesType | null = null;
  /** 加载态三者相互独立：详情页指标 30s 轮询不应让整页转圈 */
  serversLoading = false;
  serverDetailLoading = false;
  serverMetricsLoading = false;
  /** 最近一次列表查询参数：写操作后按同一条件刷新，避免筛选 / 排序被重置（同 accountListParams） */
  serverListParams: ServerListParamsType = {};

  constructor(prefStore) {
    this.prefStore = prefStore;
    makeAutoObservable(this); // Makes state observable and actions transactional
    this.getAppInfo();
  }

  runRequest = (
    endpoint: string,
    method: string,
    bodyData: object | FormData,
    defaultErrorMessage: string,
    skipSuccessMessage: boolean = false,
    skipErrorMessage: boolean = false
  ) => {
    const options = {
      method: method,
      headers: {
        Accept: 'application/json',
        'X-CSRF-TOKEN': getCookie('CSRF-TOKEN'),
      },
    };

    if (!(bodyData instanceof FormData)) {
      options['headers']['Content-Type'] = 'application/json';
    }
    if (method !== 'GET' && method !== 'HEAD') {
      options['body'] = bodyData instanceof FormData ? bodyData : JSON.stringify(bodyData);
    }

    // 只有写操作（POST/PATCH/PUT/DELETE）才弹成功提示；GET/HEAD 是页面加载时的静默读取
    const isMutation = method !== 'GET' && method !== 'HEAD';

    return fetch(endpoint, options)
      .then((response) => {
        if (response.ok) {
          return response.json();
        }

        if (response.status === 424) {
          this.setIsSetupRequired(true);
          this.setIsAuthRequired(false);
        } else if (response.status === 401) {
          this.setIsSetupRequired(false);
          this.setIsAuthRequired(true);
        }

        return response.json().then((data) => {
          throw new Error(data.message || `HTTP error! status: ${response.status}`);
        });
      })
      .then((data) => {
        if (typeof data.message !== 'undefined' && !skipSuccessMessage && isMutation) {
          toast.success(data.message, { position: 'top-center' });
        }
        return data;
      })
      .catch((reason) => {
        if (!skipErrorMessage) {
          toast.error(reason instanceof Error ? reason.message : defaultErrorMessage, {
            position: 'top-center',
          });
        }

        return null;
      });
  };
  setIsSetupRequired = (val: boolean) => {
    this.isSetupRequired = val;
  };
  setTagFilter = (val: TagFilterType) => {
    this.tagFilter = val;
  };
  setModule = (key: ModuleKey) => {
    this.module = key;
    // 模块切换后旧的标签筛选与批量选择都不再适用
    this.tagFilter = null;
  };

  get itemListFilters() {
    const tagFilter = this.tagFilter;
    const responseOutput = (val: any) => ({
      tags: val,
    });

    if (tagFilter === null || tagFilter === 'none') {
      return responseOutput(tagFilter);
    }

    if (!this.prefStore.includeNestedTagItems) {
      return responseOutput([tagFilter]);
    }

    const selectedTag = this.tags[tagFilter] ?? null;
    // Tag doesn't exist. This can happen when user manually changes URL to a non existing tag ID or when the selected tag has been deleted since the last load.
    if (!selectedTag) {
      return responseOutput([tagFilter]);
    }

    const childTagIDs = this.tagsArray
      .filter((tag) => tag.fullPathIDs.startsWith(`${selectedTag.fullPathIDs}/`) && tag.id !== selectedTag.id)
      .map((tag) => tag.id);

    return responseOutput([selectedTag.id, ...childTagIDs]);
  }

  setUser = (user: UserType) => {
    this.user = user;
  };

  unsetUser = () => {
    this.user = null;
  };
  setTags = (tags: TagsObjectType) => {
    const renderTagSegment = (tag: TagType) => {
      let fullPath = '';
      let fullPathIDs = '';
      if (tag.parent !== 0) {
        const parentTag = tags[tag.parent];
        if (parentTag) {
          const paths = renderTagSegment(parentTag);
          fullPath += paths.fullPath + '/';
          fullPathIDs += paths.fullPathIDs + '/';
        }
      }
      fullPath += tag.title.replaceAll('/', '\\/');
      fullPathIDs += String(tag.id);
      return { fullPath, fullPathIDs };
    };

    for (const tagID in tags) {
      const tag = tags[tagID];
      const { fullPath, fullPathIDs } = renderTagSegment(tag);
      tag.fullPath = fullPath;
      tag.fullPathIDs = fullPathIDs;
      tag.pinned = !!tag.pinned;
    }

    this.tags = tags as TagsObjectType;
  };
  get tagsArray() {
    const tagsArray = Object.values(this.tags) as TagType[];

    tagsArray.sort((a, b) => {
      return a.fullPath.localeCompare(b.fullPath);
    });

    return tagsArray;
  }
  setIsAuthRequired = (val: boolean) => {
    this.isAuthRequired = val;
  };
  /**
   * 当前模块的标签字典（PRD O-9：书签 / Skill 各自一份）。
   * 拉取与创建都带 module，默认取当前模块；写操作后按同一 module 刷新。
   */
  fetchTags = async (module: ModuleKey = this.module) => {
    return this.runRequest(API_ENDPOINTS.tags.list(tagModuleOf(module)), 'GET', {}, '获取标签失败').then((data) => {
      if (data === null) {
        return;
      }
      this.setTags(data);
    });
  };
  createTag = async (title: string, module: ModuleKey = this.module): Promise<number | null> => {
    const response = await this.runRequest(
      API_ENDPOINTS.tags.create,
      'POST',
      { title, module: tagModuleOf(module) },
      '创建标签失败'
    );

    if (response === null || !response?.data?.tag_id) {
      return null;
    }

    await this.fetchTags();

    return response.data.tag_id;
  };
  onDeleteTag = async (tagID: number) => {
    return this.runRequest(API_ENDPOINTS.tags.deleteTag(tagID), 'DELETE', {}, '删除标签失败').finally(() => {
      this.fetchTags();
      this.fetchItems();
    });
  };
  updateTag = async (tagID: number, parent: number, title: string, description: string) => {
    const response = await this.runRequest(
      API_ENDPOINTS.tags.update(tagID),
      'PATCH',
      { parent, title, description },
      '更新标签失败'
    );

    if (response === null) {
      return false;
    }

    this.fetchTags();
    return true;
  };
  onChangeTagColor = async (tagID: number, color: string) => {
    return this.runRequest(API_ENDPOINTS.tags.updateColor(tagID), 'PATCH', { color }, '更新标签颜色失败').finally(
      () => {
        const tag = { ...this.tags[tagID], color };
        this.tags = { ...this.tags, [tagID]: tag };
      }
    );
  };
  updateTagPinned = async (tagID: number, pinned: boolean) => {
    const response = await this.runRequest(
      API_ENDPOINTS.tags.updatePinned(tagID),
      'PATCH',
      { pinned },
      '更新标签置顶状态失败'
    );
    if (response === null) {
      return false;
    }

    const tag = { ...this.tags[tagID], pinned };
    this.tags = { ...this.tags, [tagID]: tag };
    return true;
  };

  setItems = (val: ItemType[]) => {
    this.items = val;
  };
  openItemEditModal = (itemID: number) => {
    this.isItemModalOpen = true;
    this.modalOpenItemID = itemID;
  };
  openItemCreateModal = () => {
    this.isItemModalOpen = true;
    this.modalOpenItemID = null;
  };
  closeModal = () => {
    this.isItemModalOpen = false;
    this.modalOpenItemID = null;
  };
  setIsItemModalOpen = (val: boolean) => {
    this.isItemModalOpen = val;
  };
  setIsSettingsModalOpen = (val: boolean) => {
    this.isSettingsModalOpen = val;
  };
  openInstallSkillDialog = () => {
    this.isInstallSkillDialogOpen = true;
  };
  closeInstallSkillDialog = () => {
    this.isInstallSkillDialogOpen = false;
  };
  setPreSelectedItemSettingsModal = (val: string) => {
    this.preSelectedItemSettingsModal = val;
  };
  fetchItems = async () => {
    return await this.runRequest(API_ENDPOINTS.items.list, 'GET', {}, '获取项目失败').then((data) => {
      if (data === null) {
        return;
      }
      this.setItems(data);
    });
  };
  deleteItems = async (itemIds: number[]) => {
    return await this.runRequest(
      API_ENDPOINTS.items.deleteItems,
      'POST',
      {
        'item-ids': itemIds,
      },
      '删除项目失败'
    );
  };
  refetchItemsMetadata = async (itemIds: number[]) => {
    return await this.runRequest(
      API_ENDPOINTS.items.refetchItemsMetadata,
      'POST',
      {
        'item-ids': itemIds,
      },
      '获取元数据失败'
    );
  };
  updateItemsTags = async ({
    itemIds,
    newSelectedTagsAll,
    newSelectedTagsSome,
  }: {
    itemIds: number[];
    newSelectedTagsAll: string[];
    newSelectedTagsSome: string[];
  }) => {
    return await this.runRequest(
      API_ENDPOINTS.items.updateItemsTags,
      'PATCH',
      {
        'item-ids': itemIds,
        'tag-ids-all': newSelectedTagsAll.map((id) => parseInt(id, 10)),
        'tag-ids-some': newSelectedTagsSome.map((id) => parseInt(id, 10)),
      },
      '更新项目标签失败'
    );
  };
  createItem = async (data: ItemType, skipSuccessMessage: boolean = false) => {
    data.url = encodeURI(decodeURI(data.url));

    const response = await this.runRequest(
      API_ENDPOINTS.items.createItem,
      'POST',
      data,
      '创建项目失败',
      skipSuccessMessage
    );

    if (!response) {
      return false;
    }

    this.fetchTags();
    this.fetchItems();
    return true;
  };
  updateItem = async (data: ItemType, itemId) => {
    data.url = encodeURI(decodeURI(data.url));

    const response = await this.runRequest(API_ENDPOINTS.items.updateItem(itemId), 'PATCH', data, '更新项目失败');
    if (!response) {
      return false;
    }

    this.fetchTags();
    this.fetchItems();
    return true;
  };

  setSkills = (val: SkillType[]) => {
    this.skills = val;
  };
  fetchSkills = async () => {
    return await this.runRequest(API_ENDPOINTS.skills.list, 'GET', {}, '获取 Skill 列表失败').then((response) => {
      if (response === null) {
        return;
      }
      this.setSkills((response?.data?.skills ?? []) as SkillType[]);
    });
  };
  /** 新装 Skill 卡片高亮：标记 justInstalled，2s 后自动清除（纯前端态） */
  markSkillJustInstalled = (id: number) => {
    this.setSkills(this.skills.map((skill) => ({ ...skill, justInstalled: skill.id === id })));

    window.setTimeout(() => {
      this.setSkills(
        this.skills.map((skill) => (skill.justInstalled ? { ...skill, justInstalled: undefined } : skill))
      );
    }, 2000);
  };
  installSkill = async ({ url }: { url: string }): Promise<SkillType | null> => {
    const response = await this.runRequest(API_ENDPOINTS.skills.install, 'POST', { url }, '安装 Skill 失败');

    if (response === null) {
      return null;
    }

    const installed = (response?.data?.skill ?? null) as SkillType | null;
    await this.fetchSkills();
    if (installed) {
      this.markSkillJustInstalled(installed.id);
    }
    return installed;
  };
  uploadSkill = async (file: File): Promise<SkillType | null> => {
    const formData = new FormData();
    formData.append('file', file);

    const response = await this.runRequest(API_ENDPOINTS.skills.upload, 'POST', formData, '上传 Skill 失败');

    if (response === null) {
      return null;
    }

    const installed = (response?.data?.skill ?? null) as SkillType | null;
    await this.fetchSkills();
    if (installed) {
      this.markSkillJustInstalled(installed.id);
    }
    return installed;
  };
  deleteSkills = async (ids: number[]) => {
    const response = await this.runRequest(API_ENDPOINTS.skills.deleteSkills, 'POST', { ids }, '删除 Skill 失败');

    if (response === null) {
      return false;
    }

    const deletedIDs: number[] = Array.isArray(response?.data?.ids) ? (response.data.ids as number[]) : ids;
    const deletedIDSet = new Set(deletedIDs);
    this.skills = this.skills.filter((skill) => !deletedIDSet.has(skill.id));

    this.fetchSkills();
    return true;
  };
  updateSkillTags = async (ids: number[], tags: number[]) => {
    const response = await this.runRequest(API_ENDPOINTS.skills.tags, 'PATCH', { ids, tags }, '更新 Skill 标签失败');

    if (response === null) {
      return false;
    }

    this.fetchSkills();
    return true;
  };
  /**
   * 检查更新。传 ids 只检查所选项，不传则检查全部 GitHub 来源 Skill。
   * 后端整批返回成功（单个失败进 failed），所以成功提示由调用方按 updates 决定。
   */
  checkSkillUpdates = async (ids?: number[]): Promise<SkillUpdateType[] | null> => {
    const targetIDs = Array.isArray(ids) && ids.length > 0 ? ids : null;
    const response = await this.runRequest(
      API_ENDPOINTS.skills.checkUpdates,
      'POST',
      targetIDs ? { ids: targetIDs } : {},
      '检查 Skill 更新失败',
      true
    );

    if (response === null) {
      return null;
    }

    const updates = (response?.data?.updates ?? []) as SkillUpdateType[];
    const updatedIDSet = new Set(updates.map((update) => update.id));
    // 只覆盖本次检查过的行，批量检查不能把未参与检查的 hasUpdate 清掉
    const checkedIDSet = targetIDs === null ? null : new Set(targetIDs);

    this.skills = this.skills.map((skill) =>
      checkedIDSet === null || checkedIDSet.has(skill.id) ? { ...skill, hasUpdate: updatedIDSet.has(skill.id) } : skill
    );

    return updates;
  };
  updateSkill = async (id: number) => {
    const response = await this.runRequest(API_ENDPOINTS.skills.update, 'POST', { id }, '更新 Skill 失败');

    if (response === null) {
      return false;
    }

    this.fetchSkills();
    return true;
  };
  exportSkill = async (id: number) => {
    const skill = this.skills.find((item) => item.id === id);
    const fileName = `${skill?.name ?? `skill-${id}`}.zip`;

    /** 下载走二进制通道，不走 runRequest（JSON 专用）；错误分支要尽量把带码的 message 透传给用户 */
    const readErrorMessage = async (response: Response): Promise<string> => {
      const fallback = '导出 Skill 失败';

      try {
        const data = await response.clone().json();
        if (typeof data?.message === 'string' && data.message !== '') {
          return data.message;
        }
      } catch {
        // Accept 是 application/zip，框架异常出口返回的是错误页 HTML，改从文本里抠错误码
      }

      try {
        const text = await response.text();
        const matched = text.match(/\[SL-[A-Z]+-\d{4}\][^<]*/);
        if (matched) {
          return matched[0].trim();
        }
      } catch {
        // 读取失败就回落默认文案
      }

      return fallback;
    };

    try {
      const response = await fetch(API_ENDPOINTS.skills.exportSkill(id), {
        method: 'GET',
        headers: {
          Accept: 'application/zip',
          'X-CSRF-TOKEN': getCookie('CSRF-TOKEN'),
        },
      });

      if (!response.ok) {
        toast.error(await readErrorMessage(response), { position: 'top-center' });
        return false;
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast.success('Skill 已成功导出', { position: 'top-center' });
      return true;
    } catch {
      toast.error('导出 Skill 失败', { position: 'top-center' });
      return false;
    }
  };
  fetchSkillDetail = async (id: number): Promise<SkillDetailType | null> => {
    const response = await this.runRequest(API_ENDPOINTS.skills.detail(id), 'GET', {}, '获取 Skill 详情失败');

    if (response === null) {
      return null;
    }

    return (response?.data ?? null) as SkillDetailType | null;
  };

  /* ----------------------------- 账号库数据（PRD §8.2） ----------------------------- */

  setAccounts = (val: AccountType[]) => {
    this.accounts = val;
  };

  clearCurrentAccount = () => {
    this.currentAccount = null;
  };

  /**
   * 账号列表（GET /api/accounts）。
   *
   * 不传分页参数时后端返回全量（与 Skill 列表一致），侧栏平台计数正是从全量数据派生，
   * 因此默认不传分页；调用方显式传入 platform / group / search 时，
   * total 与 accounts 都只覆盖过滤后的结果。
   */
  fetchAccounts = async (params: AccountListParamsType = {}): Promise<AccountType[] | null> => {
    const query = new URLSearchParams();

    if (params.search) {
      query.set('search', params.search);
    }
    if (params.platform) {
      query.set('platform', params.platform);
    }
    if (params.group) {
      query.set('group', String(params.group));
    }
    if (params.sort) {
      query.set('sort', params.sort);
    }
    if (params.order) {
      query.set('order', params.order);
    }
    if (params.page) {
      query.set('page', String(params.page));
    }
    if (params.perPage) {
      query.set('per-page', String(params.perPage));
    }

    const queryString = query.toString();
    const endpoint = queryString === '' ? API_ENDPOINTS.accounts.list : `${API_ENDPOINTS.accounts.list}?${queryString}`;
    // 先记下查询条件：后续写操作按同一条件刷新，避免用户眼前的筛选 / 排序被重置
    this.accountListParams = params;

    const response = await this.runRequest(endpoint, 'GET', {}, '获取账号列表失败');

    if (response === null) {
      return null;
    }

    const accounts = (response?.data?.accounts ?? []) as AccountType[];
    this.setAccounts(accounts);
    this.accountTotal = Number(response?.data?.total ?? accounts.length);
    this.deriveAccountGroups(accounts);

    return accounts;
  };

  /**
   * 分组字典派生：后端暂无独立的分组列表接口，分组名只能从账号列表响应里拿，
   * 因此「一个账号都没有的分组」暂时不可见（待后续补充接口）。
   */
  deriveAccountGroups = (accounts: AccountType[]) => {
    const groups = new Map<number, AccountGroupType>();

    for (const account of accounts) {
      const id = account.group_id ?? null;
      const name = account.group ?? null;
      if (id === null || id <= 0 || !name) {
        continue;
      }
      groups.set(id, { id, name, sort: 0 });
    }

    this.accountGroups = [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
  };

  /** 分组字典：列表还没加载过时先拉一次全量列表再派生 */
  fetchAccountGroups = async (): Promise<AccountGroupType[]> => {
    if (this.accounts.length === 0) {
      await this.fetchAccounts();
    }

    return this.accountGroups;
  };

  /** 账号详情（含授权关系）；密文原样交给调用方解密，本 store 不做任何解密 */
  fetchAccountDetail = async (id: number): Promise<AccountDetailType | null> => {
    const response = await this.runRequest(API_ENDPOINTS.accounts.detail(id), 'GET', {}, '获取账号详情失败');

    if (response === null) {
      return null;
    }

    const account = (response?.data?.account ?? null) as AccountDetailType | null;
    this.currentAccount = account;

    return account;
  };

  createAccount = async (payload: AccountInputType): Promise<AccountType | null> => {
    const response = await this.runRequest(API_ENDPOINTS.accounts.create, 'POST', payload, '创建账号失败');

    if (response === null) {
      return null;
    }

    // 刷新列表：侧栏平台计数与列表排序都要按新数据重算
    await this.fetchAccounts(this.accountListParams);

    return (response?.data?.account ?? null) as AccountType | null;
  };

  /**
   * 更新账号（PATCH 部分更新：未传字段保持原值）。
   *
   * skipSuccessMessage 供「新建后补写密文」使用：那一跳是创建流程的第二步，
   * 再弹一次「账号更新成功」会让用户困惑，此时只保留创建的提示。
   */
  updateAccount = async (
    id: number,
    payload: Partial<AccountInputType>,
    skipSuccessMessage: boolean = false
  ): Promise<boolean> => {
    // id 放请求体：后端从「JSON 体 + 查询参数」的合并入参里读 id
    const response = await this.runRequest(
      API_ENDPOINTS.accounts.update,
      'PATCH',
      { id, ...payload },
      '更新账号失败',
      skipSuccessMessage
    );

    if (response === null) {
      return false;
    }

    await this.fetchAccounts(this.accountListParams);

    return true;
  };

  deleteAccounts = async (ids: number[]): Promise<boolean> => {
    const response = await this.runRequest(API_ENDPOINTS.accounts.delete, 'POST', { ids }, '删除账号失败');

    if (response === null) {
      return false;
    }

    await this.fetchAccounts(this.accountListParams);

    return true;
  };

  /**
   * 授权关系增改删。授权数据只存在于账号详情里（列表不返回），
   * 所以这里不做列表刷新，由详情页按需重新拉取。
   */
  createAuthorization = async (payload: AuthorizationInputType): Promise<AccountAuthorizationType | null> => {
    const response = await this.runRequest(
      API_ENDPOINTS.accounts.authorizations.create,
      'POST',
      payload,
      '创建授权失败'
    );

    if (response === null) {
      return null;
    }

    return (response?.data?.authorization ?? null) as AccountAuthorizationType | null;
  };

  updateAuthorization = async (id: number, payload: Partial<AuthorizationInputType>): Promise<boolean> => {
    const response = await this.runRequest(
      API_ENDPOINTS.accounts.authorizations.update,
      'POST',
      { id, ...payload },
      '更新授权失败'
    );

    return response !== null;
  };

  deleteAuthorization = async (ids: number[]): Promise<boolean> => {
    const response = await this.runRequest(
      API_ENDPOINTS.accounts.authorizations.delete,
      'POST',
      { ids },
      '删除授权失败'
    );

    return response !== null;
  };

  /* ----------------------------- 服务器监控数据（PRD §6 用户态接口） ----------------------------- */

  setServers = (val: ServerItemType[]) => {
    this.servers = val;
  };

  /**
   * 服务器列表（GET /api/servers）。
   *
   * 不传参数时后端返回全量；显式传入 search / group / sort / order 时下推后端
   * （与账号库 fetchAccounts 带参一致——后端在内存里完成筛选与排序后返回全量结果，
   * 分页由前端做）。分组计数按搜索命中全集统计，不受分组筛选影响（后端口径），
   * 侧栏因此能在筛选某一分组时仍看到其他分组的计数。
   */
  fetchServers = async (params: ServerListParamsType = {}): Promise<ServerItemType[] | null> => {
    const query = new URLSearchParams();

    if (params.search) {
      query.set('search', params.search);
    }
    if (params.group) {
      query.set('group', params.group);
    }
    if (params.sort) {
      query.set('sort', params.sort);
    }
    if (params.order) {
      query.set('order', params.order);
    }

    const queryString = query.toString();
    const endpoint = queryString === '' ? API_ENDPOINTS.servers.list : `${API_ENDPOINTS.servers.list}?${queryString}`;
    // 先记下查询条件：后续写操作按同一条件刷新，避免用户眼前的筛选 / 排序被重置
    this.serverListParams = params;
    this.serversLoading = true;

    try {
      const response = await this.runRequest(endpoint, 'GET', {}, '获取服务器列表失败');

      if (response === null) {
        return null;
      }

      const servers = (response?.data?.servers ?? []) as ServerItemType[];
      this.setServers(servers);
      this.serverTotal = Number(response?.data?.total ?? servers.length);
      this.serverGroups = (response?.data?.groups ?? {}) as ServerGroupCountsType;

      return servers;
    } finally {
      this.serversLoading = false;
    }
  };

  /**
   * 客户端筛选排序（PRD §5.5 工具栏 / 侧栏）：在已加载的全量数据上本地完成，
   * 与账号库平台 / 分组过滤同一处理方式——同等条件也可下推后端（fetchServers 带参），
   * 这里提供本地版本供即时过滤（搜索输入不必每敲一个字都发一次请求）。
   *
   * 口径与后端 ServersGetController::sortServers 逐条对齐：
   * - 搜索覆盖名称 / 备注 / IP，不区分大小写；
   * - 状态排序「在线优先」：online > offline > pending > paused，缺省 asc；
   * - CPU / 内存无快照数据（等待连接）按 -1 参与比较，排在有数据的之后；
   * - 同键时按 id 倒序兜底，保证列表刷新时顺序稳定、可复现。
   */
  filterServers = (params: ServerListParamsType = {}): ServerItemType[] => {
    const keyword = (params.search ?? '').trim().toLowerCase();

    const filtered = this.servers.filter((server) => {
      if (params.group && server.group !== params.group) {
        return false;
      }
      if (keyword === '') {
        return true;
      }
      return (
        server.name.toLowerCase().includes(keyword) ||
        server.note.toLowerCase().includes(keyword) ||
        server.ip_address.toLowerCase().includes(keyword)
      );
    });

    const sort: ServerSortType = params.sort ?? 'id';
    // 缺省方向：状态按「在线优先」升序，其余倒序（与后端 parseSort 一致）
    const order: ServerOrderType = params.order ?? (sort === 'status' ? 'asc' : 'desc');
    const direction = order === 'asc' ? 1 : -1;

    return filtered.sort((left, right) => {
      let result: number;
      switch (sort) {
        case 'name':
          result = left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
          break;
        case 'group':
          result = left.group.localeCompare(right.group, undefined, { sensitivity: 'base' });
          break;
        case 'status':
          result = SERVER_STATUS_ORDER.indexOf(left.status) - SERVER_STATUS_ORDER.indexOf(right.status);
          break;
        case 'cpu':
          result = (left.latest?.cpu ?? -1) - (right.latest?.cpu ?? -1);
          break;
        case 'mem':
          result = (left.latest?.mem_used ?? -1) - (right.latest?.mem_used ?? -1);
          break;
        case 'last_report_at':
          result = String(left.last_report_at ?? '').localeCompare(String(right.last_report_at ?? ''));
          break;
        case 'created_at':
          result = String(left.created_at ?? '').localeCompare(String(right.created_at ?? ''));
          break;
        case 'updated_at':
          result = String(left.updated_at ?? '').localeCompare(String(right.updated_at ?? ''));
          break;
        default:
          result = left.id - right.id;
          break;
      }

      // 同键按 id 倒序兜底（新服务器在前），与后端一致
      return result === 0 ? right.id - left.id : direction * result;
    });
  };

  /**
   * 新增服务器（POST /api/servers）。
   * 返回体含 Token 明文与安装命令——仅此一次完整展示（PRD §5.6 / D6：丢失只能重置），
   * 调用方（添加弹窗）负责展示与复制，**不得**写入任何持久化存储。
   */
  createServer = async (payload: ServerInputType): Promise<ServerCreateResultType | null> => {
    const response = await this.runRequest(API_ENDPOINTS.servers.create, 'POST', payload, '创建服务器失败');

    if (response === null) {
      return null;
    }

    await this.fetchServers(this.serverListParams);

    return {
      server: response?.data?.server as ServerWithStatusType,
      token: response?.data?.token as string,
      install_command: response?.data?.install_command as string,
    };
  };

  /**
   * 更新服务器（PATCH 部分更新：未传字段保持原值，后端 parsePatch 语义）。
   * id 走查询串（框架会把 $_GET 合并进入参），字段走请求体。
   * 成功后按当前查询条件刷新列表：暂停 / 恢复会改变状态判定与排序位置，
   * 与账号库 updateAccount 同一处理方式。
   */
  updateServer = async (id: number, payload: ServerUpdateType): Promise<boolean> => {
    const response = await this.runRequest(API_ENDPOINTS.servers.update(id), 'PATCH', payload, '更新服务器失败');

    if (response === null) {
      return false;
    }

    await this.fetchServers(this.serverListParams);

    return true;
  };

  /** 删除服务器（POST /api/servers/delete）：连同历史数据一并级联删除，二次确认由弹窗完成 */
  deleteServer = async (id: number): Promise<boolean> => {
    const response = await this.runRequest(API_ENDPOINTS.servers.delete(id), 'POST', {}, '删除服务器失败');

    if (response === null) {
      return false;
    }

    await this.fetchServers(this.serverListParams);

    return true;
  };

  /** 服务器详情：基本信息 + 系统信息 + 连接状态 + 最新 Docker 快照（GET /api/servers/detail） */
  fetchServerDetail = async (id: number): Promise<ServerDetailType | null> => {
    this.serverDetailLoading = true;

    try {
      const response = await this.runRequest(API_ENDPOINTS.servers.detail(id), 'GET', {}, '获取服务器详情失败');

      if (response === null) {
        return null;
      }

      const detail = (response?.data ?? null) as ServerDetailType | null;
      this.currentServer = detail;

      return detail;
    } finally {
      this.serverDetailLoading = false;
    }
  };

  /**
   * 历史指标序列（GET /api/servers/metrics）。
   * range 必传且限白名单四档（后端对缺失 / 非法值一律 400：静默回落默认档会让图表
   * 展示错范围的数据，比报错更难排查）；30d 档为服务端小时聚合，与明细档字段同构。
   */
  fetchServerMetrics = async (id: number, range: ServerRangeType): Promise<ServerMetricsSeriesType | null> => {
    this.serverMetricsLoading = true;

    try {
      const response = await this.runRequest(API_ENDPOINTS.servers.metrics(id, range), 'GET', {}, '获取服务器指标失败');

      if (response === null) {
        return null;
      }

      const series = (response?.data ?? null) as ServerMetricsSeriesType | null;
      this.serverMetrics = series;

      return series;
    } finally {
      this.serverMetricsLoading = false;
    }
  };

  /**
   * 重置 Agent Token（POST /api/servers/token）：旧 Token 立即失效，新明文仅此次返回。
   * 响应体含凭据材料，后端已置 no-store；返回值只进调用方（重置弹窗）的内存态，
   * 不落入本 store 的 observable，更不得写入 localStorage 等持久化存储。
   */
  resetServerToken = async (id: number): Promise<ServerTokenResponseType | null> => {
    const response = await this.runRequest(API_ENDPOINTS.servers.token(id), 'POST', {}, '重置 Token 失败');

    if (response === null) {
      return null;
    }

    return {
      token: response?.data?.token as string,
      install_command: response?.data?.install_command as string,
    };
  };

  getUser = async (noErrorEmit: boolean = false) => {
    const response = await this.runRequest(
      API_ENDPOINTS.settings.getUser,
      'GET',
      {},
      '获取用户信息失败',
      true,
      noErrorEmit
    );
    if (response === null) {
      return null;
    }

    if (!response?.data?.user) {
      return false;
    }

    this.setUser(response.data.user);
    return true;
  };

  createUser = async (values: CreateUserType) => {
    const response = await this.runRequest(API_ENDPOINTS.settings.create, 'POST', values, '创建用户失败');

    if (response === null || !response?.data?.user) {
      return false;
    }

    this.setUser(response.data.user);
    this.getAppInfo();
    return true;
  };

  updateUsername = async (values: UpdateUsernameType) => {
    const response = await this.runRequest(API_ENDPOINTS.settings.userName, 'PATCH', values, '更新用户名失败');

    if (response === null) {
      return false;
    }

    this.setUser({ ...this.user, ...{ username: values.username } });
    return true;
  };

  updatePassword = async (values: UpdatePasswordType) => {
    const response = await this.runRequest(API_ENDPOINTS.settings.password, 'PATCH', values, '更新密码失败');
    if (response === null) {
      return false;
    }
    return true;
  };

  deleteUser = () => {
    return this.runRequest(API_ENDPOINTS.settings.delete, 'DELETE', {}, '删除用户失败').then((response) => {
      if (response === null) {
        return;
      }
      this.unsetUser();
    });
  };
  logOut = () => {
    return this.runRequest(API_ENDPOINTS.auth.logout, 'POST', {}, '退出登录失败').then((response) => {
      if (response === null) {
        return;
      }
      this.setIsAuthRequired(true);
    });
  };

  login = async (values: LoginType) => {
    const response = await this.runRequest(API_ENDPOINTS.auth.login, 'POST', values, '登录失败');

    if (response === null || !response?.data?.user) {
      return;
    }

    this.setIsAuthRequired(false);
    this.setUser(response.data.user);
    this.getAppInfo();
  };
  initializeDatabase = async () => {
    return this.runRequest(API_ENDPOINTS.setup.setup, 'POST', {}, '初始化数据库失败').then((response) => {
      if (response === null) {
        return false;
      }
      this.setIsAuthRequired(false);
      this.setIsSetupRequired(false);
      return true;
    });
  };
  importPocketBookmarks = async (selectedFile: File) => {
    return await this.importBookmarks(selectedFile, 'pocket-zip', API_ENDPOINTS.importBookmarks.pocket);
  };

  importBrowserBookmarks = async (selectedFile: File) => {
    return await this.importBookmarks(
      selectedFile,
      'bookmark-file-html',
      API_ENDPOINTS.importBookmarks.browser,
      'browser'
    );
  };

  importRaindropIoBookmarks = async (selectedFile: File) => {
    return await this.importBookmarks(
      selectedFile,
      'bookmark-file-html',
      API_ENDPOINTS.importBookmarks.browser,
      'Raindrop.io'
    );
  };

  importBookmarks = async (selectedFile: File, inputName: string, endpointUrl: string, importSourceName?: string) => {
    const formData = new FormData();
    formData.append(inputName, selectedFile);
    if (importSourceName) {
      formData.append('import-source-name', importSourceName);
    }

    return await this.runRequest(endpointUrl, 'POST', formData, '导入书签失败').then((response) => {
      if (response === null) {
        return false;
      }
      this.setIsSettingsModalOpen(false);
      this.fetchItems();
      this.fetchTags();
      return true;
    });
  };

  exportData = async () => {
    const response = await this.runRequest(API_ENDPOINTS.exportData, 'GET', {}, '导出数据失败', true, false);

    if (response === null || !response.data) {
      return false;
    }

    const blob = new Blob([JSON.stringify(response.data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `super-link-backup-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    toast.success('数据已成功导出', { position: 'top-center' });
    return true;
  };

  importData = async (selectedFile: File) => {
    const formData = new FormData();
    formData.append('backup-json', selectedFile);

    return await this.runRequest(API_ENDPOINTS.importData, 'POST', formData, '导入数据失败').then((response) => {
      if (response === null) return false;
      this.fetchItems();
      this.fetchTags();
      return true;
    });
  };

  /* ----------------------------- 备份 / 恢复（refinements §4） ----------------------------- */

  /**
   * 导出模块备份（GET /api/backup/<module>）。
   *
   * 响应体本身就是备份文件内容（后端 data() 裸对象 + no-store），拉到后直接序列化落盘，
   * 文件名与后端 BackupPayload::fileName 同规则：super-link-<module>-YYYYMMDD.json（本地日期）。
   * 成功不弹 toast——导出是设置页里的显式操作，成功文案归 UI 层（同 exportVault）。
   */
  exportBackup = async (module: BackupModuleType): Promise<boolean> => {
    const response = await this.runRequest(API_ENDPOINTS.backup.export[module], 'GET', {}, '导出备份失败', true, false);

    if (response === null) {
      return false;
    }

    const now = new Date();
    const pad = (value: number) => String(value).padStart(2, '0');
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;

    const blob = new Blob([JSON.stringify(response, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `super-link-${module}-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    return true;
  };

  /**
   * 预检恢复（POST /api/backup/<module>/restore，dry_run=1）：只读分类，不写库。
   * 返回后端 data（dry_run / mode / summary / items），由 UI 渲染逐条预览。
   */
  previewRestore = async (
    module: BackupModuleType,
    file: File,
    mode: BackupRestoreModeType
  ): Promise<BackupRestoreResultType | null> => this.restoreRequest(module, file, mode, true);

  /**
   * 执行恢复（POST /api/backup/<module>/restore）。
   * 成功 / 失败提示统一走后端 message（runRequest：成功弹 success、失败弹 error），
   * 不在这里吞异常；返回逐条结果与 summary 供 UI 展示。
   */
  restoreBackup = async (
    module: BackupModuleType,
    file: File,
    mode: BackupRestoreModeType
  ): Promise<BackupRestoreResultType | null> => this.restoreRequest(module, file, mode, false);

  /** 预检 / 执行共用的 multipart 上传（字段名与后端一致：file / mode / dry_run） */
  restoreRequest = async (
    module: BackupModuleType,
    file: File,
    mode: BackupRestoreModeType,
    dryRun: boolean
  ): Promise<BackupRestoreResultType | null> => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('mode', mode);
    // 只在预检时传：后端 filter_var 认 '1' / 'true'，缺省按 false（执行）处理
    if (dryRun) {
      formData.append('dry_run', '1');
    }

    const response = await this.runRequest(
      API_ENDPOINTS.backup.restore[module],
      'POST',
      formData,
      dryRun ? '预检备份失败' : '恢复备份失败'
    );

    if (response === null) {
      return null;
    }

    const data = (response?.data ?? null) as
      | (BackupRestoreResultType & {
          new?: number;
          updated?: number;
          same?: number;
          skipped?: number;
          failed?: number;
        })
      | null;

    if (data === null) {
      return null;
    }

    // 预检按 refinements.md §4.5 返回扁平分类（{ new, same, skipped, ... }），
    // 执行返回 { items, summary }。这里统一补成 summary，UI 只认一种形状。
    if (!data.summary) {
      data.summary = {
        new: data.new ?? 0,
        updated: data.updated,
        same: data.same ?? 0,
        skipped: data.skipped ?? 0,
        failed: data.failed ?? 0,
      };
    }

    return data;
  };

  /**
   * 账号库元信息（GET /api/vault/meta）。
   * 未初始化时后端返回 200 + initialized=false，所以这里不做「无数据即错误」判断；
   * 网络/服务端异常返回 null，由 vaultStore 决定展示重试还是锁定页。
   */
  fetchVaultMeta = async (): Promise<VaultMetaType | null> => {
    const response = await this.runRequest(API_ENDPOINTS.vault.meta, 'GET', {}, '获取账号库信息失败', true, true);

    if (response === null) {
      return null;
    }

    return (response?.data ?? null) as VaultMetaType | null;
  };

  /**
   * 初始化账号库（首次设置主密码）。只上传 KDF 参数 + 盐 + 被包裹的 DEK，主密码不出浏览器。
   * 成功/失败提示由 vaultStore 统一处理（锁定页有自己的错误区，不用 toast）。
   */
  setupVault = async (payload: VaultMetaPayloadType): Promise<boolean> => {
    const response = await this.runRequest(API_ENDPOINTS.vault.setup, 'POST', payload, '初始化账号库失败', true, true);

    return response !== null;
  };

  /** 更换主密码：重新包裹同一把 DEK（旧主密码正确性由前端 GCM 校验判断） */
  changeMasterPassword = async (payload: VaultMetaPayloadType): Promise<boolean> => {
    const response = await this.runRequest(
      API_ENDPOINTS.vault.changeMaster,
      'POST',
      payload,
      '更换主密码失败',
      true,
      true
    );

    return response !== null;
  };

  /**
   * 重置账号库（删除 vault_meta，之后原密文永久不可解）。
   * 登录密码只在前端做二次确认，不发给服务端：后端 `VaultResetController` 明确不校验密码，
   * 只依赖登录态，避免密码校验逻辑出现两份实现。
   */
  resetVault = async (): Promise<boolean> => {
    const response = await this.runRequest(API_ENDPOINTS.vault.reset, 'POST', {}, '重置账号库失败', false, true);

    return response !== null;
  };

  /**
   * 导出加密备份 .slvault（GET /api/vault/export）。
   *
   * 后端返回的就是文件内容本身（裸 JSON，无 success 包裹），里面只有密文与 KDF 元信息；
   * 下载动作在前端完成（与 exportData 一致）：fetch 拿字节 -> Blob -> <a download>。
   * 成功后由调用方提示，这里不弹 toast——导入导出是设置页里的显式操作，文案归 UI 层。
   */
  exportVault = async (): Promise<boolean> => {
    const response = await this.runRequest(API_ENDPOINTS.vault.export, 'GET', {}, '导出账号库失败', true, false);

    if (response === null) {
      return false;
    }

    const blob = new Blob([JSON.stringify(response)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `super-link-vault-${new Date().toISOString().split('T')[0].replace(/-/g, '')}.slvault`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    return true;
  };

  /**
   * 导入加密备份 .slvault（POST /api/vault/import，multipart：file + mode）。
   *
   * 与 Skill 上传 / 书签导入同一套上传方式；mode 决定合并（merge）还是覆盖（replace）。
   * 主密码校验不在这里——由调用方先用 lib/vaultBackup.ts 在本地验完再上传。
   * 成功 / 失败提示走后端 message（runRequest 默认行为），调用方只需处理成功后的锁定与刷新。
   */
  importVault = async (selectedFile: File, mode: VaultImportModeType): Promise<boolean> => {
    const formData = new FormData();
    formData.append('file', selectedFile);
    formData.append('mode', mode);

    const response = await this.runRequest(API_ENDPOINTS.vault.import, 'POST', formData, '导入账号库失败');

    return response !== null;
  };

  fetchUrlMetadata = async (url: string) => {
    return this.runRequest(
      '/api/url/fetch-metadata',
      'POST',
      { url: encodeURI(decodeURI(url)) },
      '从网址获取元数据失败'
    );
  };

  getAppInfo = async () => {
    const response = await this.runRequest(API_ENDPOINTS.appInfo, 'GET', {}, '获取应用信息失败', true, true);

    if (response === null || !response.data) {
      return;
    }

    this.appInfo = response.data;
    // 更新成功后的首次加载：消费一次性结果并提示
    this.consumeUpdateResult();
    return response.data;
  };

  /**
   * 消费「更新成功」的一次性结果。
   * 只有本次真正拉到的 installed_version 等于弹窗记录的目标版本才提示，
   * 防止刷新落空（例如用户手动刷新了中间态页面）造成虚假的成功提示。
   */
  consumeUpdateResult = () => {
    let raw: string | null = null;
    try {
      raw = sessionStorage.getItem(UPDATE_RESULT_KEY);
    } catch {
      return; // sessionStorage 不可用（隐私模式等）时静默跳过
    }
    if (!raw) {
      return;
    }

    try {
      sessionStorage.removeItem(UPDATE_RESULT_KEY);
    } catch {
      // 删除失败不影响后续判断，下次仍会因版本已更新而自然不再提示
    }

    let expected: { from?: string | null; to?: string | null } | null = null;
    try {
      expected = JSON.parse(raw);
    } catch {
      return;
    }

    const installed = this.appInfo?.installed_version ?? null;
    if (installed && expected?.to && installed === expected.to) {
      // 稍作延迟，确保初始化流程中 Toaster 已完成挂载，避免提示丢失
      window.setTimeout(() => {
        toast.success(`已更新到 v${installed}`, { position: 'top-center' });
      }, 300);
    }
  };

  updateApp = async () => {
    return this.runRequest(API_ENDPOINTS.updateApp, 'POST', {}, '触发更新失败');
  };

  /** O-5：拉取「设置 → 网络」配置。生效值由后端给出（数据库设置优先，环境变量仅初始默认值） */
  fetchNetworkSettings = async () => {
    const response = await this.runRequest(API_ENDPOINTS.settings.network, 'GET', {}, '获取网络设置失败', true, true);

    if (response === null || !response.data) {
      return;
    }

    this.networkSettings = response.data;
  };

  /** O-5：保存三档策略 / 代理前缀 / 版本检查开关，成功 toast 由 runRequest 统一弹出 */
  saveNetworkSettings = async (values: NetworkSettingsType): Promise<boolean> => {
    const response = await this.runRequest(API_ENDPOINTS.settings.network, 'POST', values, '保存网络设置失败');

    if (response === null) {
      return false;
    }

    this.networkSettings = response.data ?? { ...values };
    return true;
  };

  /**
   * O-5：测试连接（HEAD 探测）。不可达时后端同样返回 200 + reachable=false，
   * 由调用方展示结果；只有参数校验失败才走 runRequest 的错误 toast。
   */
  testNetworkConnection = async (values: { mode: GithubAccessModeType; proxy_prefix: string }) => {
    const response = await this.runRequest(API_ENDPOINTS.settings.networkTest, 'POST', values, '测试连接失败', true);

    if (response === null || !response.data) {
      return null;
    }

    return response.data as NetworkTestResultType;
  };
}

export const mainStore = new MainStore(preferencesStore);
