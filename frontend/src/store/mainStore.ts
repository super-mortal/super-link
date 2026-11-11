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
  CreateUserType,
  ItemType,
  LoginType,
  ModuleKey,
  SkillDetailType,
  SkillType,
  SkillUpdateType,
  TagFilterType,
  TagsObjectType,
  TagType,
  UpdatePasswordType,
  UpdateUsernameType,
  UserType,
  VaultMetaPayloadType,
  VaultMetaType,
} from '@/lib/types.ts';
import { DEFAULT_MODULE } from '@/lib/modules.ts';
import { getCookie } from '@/lib/utils.ts';
import { preferencesStore } from './preferencesStore.ts';

class MainStore {
  prefStore: typeof preferencesStore;
  items: ItemType[] = [];
  skills: SkillType[] = [];
  /** 当前模块：书签 / Skill。标签筛选两模块共用 */
  module: ModuleKey = DEFAULT_MODULE;
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
  } | null = null;

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
  fetchTags = async () => {
    return this.runRequest(API_ENDPOINTS.tags.list, 'GET', {}, '获取标签失败').then((data) => {
      if (data === null) {
        return;
      }
      this.setTags(data);
    });
  };
  createTag = async (title: string): Promise<number | null> => {
    const response = await this.runRequest(API_ENDPOINTS.tags.create, 'POST', { title }, '创建标签失败');

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

  updateAccount = async (id: number, payload: Partial<AccountInputType>): Promise<boolean> => {
    // id 放请求体：后端从「JSON 体 + 查询参数」的合并入参里读 id
    const response = await this.runRequest(API_ENDPOINTS.accounts.update, 'PATCH', { id, ...payload }, '更新账号失败');

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
    return response.data;
  };

  updateApp = async () => {
    return this.runRequest(API_ENDPOINTS.updateApp, 'POST', {}, '触发更新失败');
  };
}

export const mainStore = new MainStore(preferencesStore);
