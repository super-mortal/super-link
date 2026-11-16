<?php

namespace Models;

use Exception;
use PDO;
use PDOStatement;

class Repository
{
	private $pdo;

	/**
	 * 账号列表允许的排序字段白名单（PRD §8.2）
	 *
	 * ORDER BY 不能用预处理占位符，只能拼字符串；所以这里把「用户传入的 sort 值」
	 * 映射到固定的列表达式，未知值一律回落到 updated_at，杜绝 SQL 注入。
	 */
	private const ACCOUNT_SORTS = [
		'updated_at' => 'updated_at',
		'created_at' => 'created_at',
		'name' => 'name COLLATE NOCASE',
		'platform' => 'platform COLLATE NOCASE',
		'password_updated_at' => 'password_updated_at',
	];

	/**
	 * accounts 允许写入的列白名单：插入与部分更新共用
	 *
	 * 更新时只处理调用方传入的列（PATCH 语义），未传字段保持原值，
	 * 避免把没提交的密文列误清空。
	 */
	private const ACCOUNT_WRITABLE_COLUMNS = [
		'name',
		'platform',
		'identifier',
		'group_id',
		'login_url',
		'login_via_account_id',
		'favorite',
		'password_ct',
		'password_iv',
		'totp_ct',
		'totp_iv',
		'notes_ct',
		'notes_iv',
		'password_updated_at',
		'last_used_at',
	];

	/**
	 * 必须以二进制（PDO::PARAM_LOB）绑定的密文列
	 */
	private const ACCOUNT_BLOB_COLUMNS = [
		'password_ct',
		'password_iv',
		'totp_ct',
		'totp_iv',
		'notes_ct',
		'notes_iv',
	];

	/**
	 * 授权状态白名单，与建表时的 CHECK 约束保持一致
	 */
	private const AUTHORIZATION_STATUSES = ['active', 'revoked'];

	/**
	 * account_authorizations 允许写入的列白名单
	 */
	private const AUTHORIZATION_WRITABLE_COLUMNS = [
		'account_id',
		'service',
		'identifier',
		'note',
		'linked_account_id',
		'status',
		'granted_at',
	];

	/**
	 * 账号库索引清单（name => 建索引 SQL）
	 *
	 * 建表与增量迁移共用：CREATE INDEX IF NOT EXISTS 保证可重复执行，
	 * 老库升级时也能补齐后来新增的索引。
	 */
	private const ACCOUNT_INDEXES = [
		'idx_accounts_name' => 'CREATE INDEX IF NOT EXISTS "idx_accounts_name" ON accounts(name COLLATE NOCASE)',
		'idx_accounts_platform' => 'CREATE INDEX IF NOT EXISTS "idx_accounts_platform" ON accounts(platform)',
		'idx_accounts_identifier' => 'CREATE INDEX IF NOT EXISTS "idx_accounts_identifier" ON accounts(identifier)',
		'idx_accounts_group_id' => 'CREATE INDEX IF NOT EXISTS "idx_accounts_group_id" ON accounts(group_id)',
		'idx_accounts_updated_at' => 'CREATE INDEX IF NOT EXISTS "idx_accounts_updated_at" ON accounts(updated_at)',
		'idx_account_authorizations_account_id' => 'CREATE INDEX IF NOT EXISTS "idx_account_authorizations_account_id" ON account_authorizations(account_id)',
		'idx_account_authorizations_linked' => 'CREATE INDEX IF NOT EXISTS "idx_account_authorizations_linked" ON account_authorizations(linked_account_id)',
	];

	/**
	 * servers 允许写入的列白名单：新增与部分更新共用
	 *
	 * 更新时只处理调用方显式传入的列（PATCH 语义），未传列保持原值；
	 * token_hash / token_salt 不在其内——Token 轮换是独立流程（重置即失效），
	 * 不与名称 / 备注这类普通编辑混在一起。
	 */
	private const SERVER_WRITABLE_COLUMNS = [
		'name',
		'note',
		'group_name',
		'paused',
	];

	/**
	 * servers 系统信息冗余列白名单（PRD §6 允许冗余；§5.3 系统信息口径）
	 *
	 * agent 首次回传或信息变化时整组更新；ip_address 同时供列表页搜索使用
	 * （PRD §5.5：搜索名称 / 备注 / IP）。
	 */
	private const SERVER_SYSTEM_INFO_COLUMNS = [
		'os_name',
		'kernel',
		'cpu_cores',
		'ip_address',
		'agent_version',
	];

	/**
	 * servers 面向用户查询返回的列（不含 token_hash / token_salt）
	 *
	 * 哈希与盐是服务端凭据材料，前端没有任何界面需要它们（PRD D6 选项 b：
	 * Token 不明文回看），用户态查询一律不 SELECT，缩小泄露面。
	 */
	private const SERVER_PUBLIC_COLUMNS = [
		'id',
		'name',
		'note',
		'group_name',
		'paused',
		'os_name',
		'kernel',
		'cpu_cores',
		'ip_address',
		'agent_version',
		'last_report_at',
		'created_at',
		'updated_at',
	];

	/**
	 * 服务器列表允许的排序字段白名单
	 *
	 * ORDER BY 不能用预处理占位符，只能拼字符串；未知值一律回落到 id，
	 * 与 ACCOUNT_SORTS 同一套路，杜绝 SQL 注入。
	 */
	private const SERVER_SORTS = [
		'id' => 'id',
		'name' => 'name COLLATE NOCASE',
		'group_name' => 'group_name COLLATE NOCASE',
		'last_report_at' => 'last_report_at',
		'created_at' => 'created_at',
		'updated_at' => 'updated_at',
	];

	/**
	 * 明细查询支持的时间范围（PRD §6 接口草案：range=1h|6h|24h|30d）
	 *
	 * 键为接口传入的 range 字面量，值为相对时间表达式；30 天是保留上限
	 * （决策 D4），更早的数据已被 cleanupServerRetention() 清理，查了也是空。
	 */
	private const SERVER_METRIC_RANGES = [
		'1h' => '-1 hour',
		'6h' => '-6 hours',
		'24h' => '-24 hours',
		'30d' => '-30 days',
	];

	/**
	 * 服务器监控索引清单（name => 建索引 SQL）
	 *
	 * 建表与增量迁移共用：CREATE INDEX IF NOT EXISTS 保证可重复执行，
	 * 老库升级时也能补齐后来新增的索引（模式同 ACCOUNT_INDEXES）。
	 * server_connections 的 server_id 是 UNIQUE：每 Token 单活跃连接由索引
	 * 兜底（PRD §5.2 / D11），registerServerConnection() 仍会显式先删旧行。
	 */
	private const SERVER_INDEXES = [
		'idx_servers_group_name' => 'CREATE INDEX IF NOT EXISTS "idx_servers_group_name" ON servers(group_name)',
		'idx_server_metrics_server_received' => 'CREATE INDEX IF NOT EXISTS "idx_server_metrics_server_received" ON server_metrics(server_id, received_at)',
		'idx_server_disks_server_received' => 'CREATE INDEX IF NOT EXISTS "idx_server_disks_server_received" ON server_disks(server_id, received_at)',
		'idx_server_docker_server_received' => 'CREATE INDEX IF NOT EXISTS "idx_server_docker_server_received" ON server_docker(server_id, received_at)',
		'idx_server_connections_server_id' => 'CREATE UNIQUE INDEX IF NOT EXISTS "idx_server_connections_server_id" ON server_connections(server_id)',
	];

	public function __construct($pdo)
	{
		$this->pdo = $pdo;
	}

	/**
	 * 获取标签字典（PRD O-9：书签 / Skill 按模块隔离）
	 *
	 * $module 传 'bookmarks' / 'skills' 时只返回该模块的标签；传 null 返回全模块，
	 * 供导出、按 tag id 的存在性校验等「本来就跨模块」的场景使用。
	 * 接口语义变化说明：旧版 /api/tags 返回全量，v0.0.6 起由控制器默认按
	 * module=bookmarks 过滤，旧前端（不带该参数）看到的行为与模块隔离前一致。
	 */
	public function getTags($module = null)
	{
		$tags = [];
		if ($module === null) {
			$stmt = $this->pdo->query('SELECT * FROM tags ORDER BY title ASC');
		} else {
			$stmt = $this->pdo->prepare('SELECT * FROM tags WHERE module = :module ORDER BY title ASC');
			$stmt->execute([':module' => $module]);
		}
		while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
			$tags[(int)$row['id']] = $row;
		}
		return $tags;
	}

	public function getItems()
	{
		$items_tags = $this->getItemsTags();

		$items = [];
		$stmt = $this->pdo->query('SELECT * FROM items ORDER BY id DESC');
		while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
			$item_id = (int)$row['id'];
		$items[$item_id] = array_merge($row, [
			'url' => urldecode($row['url']),
			'tags' => $items_tags[$item_id] ?? []
		]);
		}
		return $items;
	}

	/**
	 * Get items tags relation
	 */
	public function getItemsTags()
	{
		$items_tags = [];
		$stmt = $this->pdo->query('SELECT item_id, tag_id FROM items_tags ORDER BY tag_id ASC');
		while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
			$items_tags[(int)$row['item_id']][] = (int)$row['tag_id'];
		}
		return $items_tags;
	}

	public function getItemsUrls(array $item_ids)
	{
		if (empty($item_ids)) {
			return [];
		}
		$sql_in = implode(',', array_fill(0, count($item_ids), '?'));
		$stmt = $this->pdo->prepare("SELECT id, url FROM items WHERE id IN ($sql_in)");
		$stmt->execute($item_ids);

		$items = [];
		while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
			$items[(int)$row['id']] = urldecode($row['url']);
		}
		return $items;
	}

	public function getSkills()
	{
		$skills_tags = $this->getSkillTags();

		$skills = [];
		$stmt = $this->pdo->query('SELECT * FROM skills ORDER BY id DESC');
		while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
			$skill_id = (int)$row['id'];
			$skills[$skill_id] = array_merge($row, [
				'tags' => $skills_tags[$skill_id] ?? []
			]);
		}
		return $skills;
	}

	public function getSkill(int $skill_id)
	{
		$stmt = $this->pdo->prepare('SELECT * FROM skills WHERE id = :skill_id');
		$stmt->execute([':skill_id' => $skill_id]);
		return $stmt->fetch(PDO::FETCH_ASSOC);
	}

	public function getSkillByName(string $name)
	{
		$stmt = $this->pdo->prepare('SELECT * FROM skills WHERE name = :name');
		$stmt->execute([':name' => $name]);
		return $stmt->fetch(PDO::FETCH_ASSOC);
	}

	/**
	 * Get skills tags relation
	 */
	public function getSkillTags()
	{
		$skills_tags = [];
		$stmt = $this->pdo->query('SELECT skill_id, tag_id FROM skills_tags ORDER BY tag_id ASC');
		while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
			$skills_tags[(int)$row['skill_id']][] = (int)$row['tag_id'];
		}
		return $skills_tags;
	}

	public function createSkill(array $data)
	{
		$stmt = $this->pdo->prepare(
			'INSERT INTO skills (name, description, source_type, source_url, fingerprint, installed_at, updated_at)
			VALUES (:name, :description, :source_type, :source_url, :fingerprint, :installed_at, :updated_at)'
		);
		$date = date('Y-m-d H:i:s');
		$stmt->execute([
			':name' => $data['name'],
			':description' => $data['description'] ?? '',
			':source_type' => $data['source_type'],
			':source_url' => $data['source_url'] ?? '',
			':fingerprint' => $data['fingerprint'] ?? '',
			':installed_at' => $data['installed_at'] ?? $date,
			':updated_at' => $data['updated_at'] ?? $date,
		]);
		return $this->pdo->lastInsertId();
	}

	public function updateSkillMeta(int $id, string $description, string $source_url)
	{
		$stmt = $this->pdo->prepare(
			'UPDATE skills
			SET description = :description, source_url = :source_url, updated_at = :updated_at
			WHERE id = :id'
		);
		return $stmt->execute([
			':description' => $description,
			':source_url' => $source_url,
			':updated_at' => date('Y-m-d H:i:s'),
			':id' => $id,
		]);
	}

	public function updateSkillFingerprint(int $id, string $fingerprint)
	{
		$stmt = $this->pdo->prepare(
			'UPDATE skills
			SET fingerprint = :fingerprint, updated_at = :updated_at
			WHERE id = :id'
		);
		return $stmt->execute([
			':fingerprint' => $fingerprint,
			':updated_at' => date('Y-m-d H:i:s'),
			':id' => $id,
		]);
	}

	public function deleteSkill(int $id)
	{
		// foreign_keys pragma is off, so clean relations manually
		$this->deleteSkillsTags([$id], []);

		$stmt = $this->pdo->prepare('DELETE FROM skills WHERE id = :id');
		return $stmt->execute([':id' => $id]);
	}

	public function setSkillTags(array $tag_ids, int $skill_id): bool
	{
		// 1. delete all tags relations
		$result = $this->deleteSkillsTags([$skill_id], []);
		if (false === $result) {
			return false;
		}

		// 2. insert new tags relations
		return $this->attachSkillTags([$skill_id], $tag_ids);
	}

	public function deleteSkillsTags(array $skill_ids, array $except_tag_ids): bool
	{
		if (empty($skill_ids)) {
			return false;
		}
		$sql_in_skill_ids = implode(',', array_fill(0, count($skill_ids), '?'));
		$sql_data = $skill_ids;

		if (!empty($except_tag_ids)) {
			$sql_not_in_tag_ids = implode(',', array_fill(0, count($except_tag_ids), '?'));
			$sql_not_in_tag_ids = " AND tag_id NOT IN ($sql_not_in_tag_ids)";
			$sql_data = array_merge($sql_data, $except_tag_ids);
		} else {
			$sql_not_in_tag_ids = '';
		}
		$stmt = $this->pdo->prepare("DELETE FROM skills_tags
		WHERE skill_id IN ($sql_in_skill_ids)
		$sql_not_in_tag_ids");
		return $stmt->execute($sql_data);
	}

	public function attachSkillTags(array $skill_ids, array $tag_ids): bool
	{
		if (empty($tag_ids)) {
			return true;
		}

		$sql_data = [];

		foreach ($skill_ids as $skill_id) {
			foreach ($tag_ids as $tag_id) {
				array_push($sql_data, $skill_id, (int)$tag_id);
			}
		}

		$sql = 'INSERT
		INTO skills_tags (skill_id, tag_id)
		VALUES ' . implode(',', array_fill(0, count($sql_data) / 2, '(?, ?)'));
		$stmt = $this->pdo->prepare($sql);
		return $stmt->execute($sql_data);
	}

	public function refreshSkillsUpdatedAt(array $skill_ids)
	{
		if (empty($skill_ids)) {
			return false;
		}
		$sql_in = implode(',', array_fill(0, count($skill_ids), '?'));
		$stmt = $this->pdo->prepare(
			"UPDATE skills
			SET updated_at = ?
			WHERE id IN ($sql_in)"
		);
		return $stmt->execute([
			date('Y-m-d H:i:s'),
			...$skill_ids,
		]);
	}

	public function getUser(int $user_id)
	{
		$stmt = $this->pdo->prepare('SELECT * FROM users WHERE id = :user_id');
		$stmt->execute([':user_id' => $user_id]);
		return $stmt->fetch(PDO::FETCH_ASSOC);
	}

	public function getUserByUsername(string $username)
	{
		$stmt = $this->pdo->prepare('SELECT * FROM users WHERE username = :username');
		$stmt->execute([':username' => $username]);
		return $stmt->fetch(PDO::FETCH_ASSOC);
	}

	public function userTableNotEmpty(): bool
	{
		$stmt = $this->pdo->query('SELECT 1 FROM users');
		return (bool)$stmt->fetchColumn();
	}

	public function createUser(string $username, string $password_hash)
	{
		$stmt = $this->pdo->prepare(
			'INSERT INTO users (username, password_hash, created_at, updated_at) 
			VALUES (:username, :password_hash, :created_at, :updated_at)'
		);
		$date = date('Y-m-d H:i:s');
		$stmt->execute([
			':username' => $username,
			':password_hash' => $password_hash,
			':created_at' => $date,
			':updated_at' => $date,
		]);
		return $this->pdo->lastInsertId();
	}

	public function deleteUser(int $user_id)
	{
		$stmt = $this->pdo->prepare('DELETE FROM users WHERE id = :user_id');
		return $stmt->execute([':user_id' => $user_id]);
	}

	public function updateUsername(int $user_id, string $username)
	{
		$stmt = $this->pdo->prepare(
			'UPDATE users SET username = :username, updated_at = :updated_at WHERE id = :id'
		);
		return $stmt->execute([
			':username' => $username,
			':updated_at' => date('Y-m-d H:i:s'),
			':id' => $user_id,
		]);
	}

	public function updatePasswordHash(int $user_id, string $password_hash)
	{
		$stmt = $this->pdo->prepare(
			'UPDATE users SET password_hash = :password_hash, updated_at = :updated_at WHERE id = :id'
		);
		return $stmt->execute([
			':password_hash' => $password_hash,
			':updated_at' => date('Y-m-d H:i:s'),
			':id' => $user_id,
		]);
	}

	/**
	 * 读取账号库元信息（单行，id 固定为 1）
	 *
	 * 只返回 KDF 参数与密文，不涉及任何账号数据；未初始化时返回 false。
	 */
	public function getVaultMeta()
	{
		$stmt = $this->pdo->query('SELECT * FROM vault_meta WHERE id = 1');
		return $stmt->fetch(PDO::FETCH_ASSOC);
	}

	/**
	 * 写入账号库元信息（仅在初始化时调用一次）
	 *
	 * 密文字段以二进制写入 BLOB：kdf_salt / wrapped_dek / wrap_nonce 都是客户端生成的随机字节，
	 * 用 PARAM_LOB 绑定可以避免二进制中的 NUL 字节被按字符串截断。
	 */
	public function createVaultMeta(array $data): bool
	{
		$stmt = $this->pdo->prepare(
			'INSERT INTO vault_meta
			(id, version, kdf, kdf_salt, kdf_memory, kdf_iterations, kdf_parallelism, wrapped_dek, wrap_nonce, created_at, updated_at)
			VALUES
			(1, :version, :kdf, :kdf_salt, :kdf_memory, :kdf_iterations, :kdf_parallelism, :wrapped_dek, :wrap_nonce, :created_at, :updated_at)'
		);
		$date = date('Y-m-d H:i:s');
		$stmt->bindValue(':version', (int)$data['version'], PDO::PARAM_INT);
		$stmt->bindValue(':kdf', (string)$data['kdf'], PDO::PARAM_STR);
		$stmt->bindValue(':kdf_salt', $data['kdf_salt'], PDO::PARAM_LOB);
		$stmt->bindValue(':kdf_memory', (int)$data['kdf_memory'], PDO::PARAM_INT);
		$stmt->bindValue(':kdf_iterations', (int)$data['kdf_iterations'], PDO::PARAM_INT);
		$stmt->bindValue(':kdf_parallelism', (int)$data['kdf_parallelism'], PDO::PARAM_INT);
		$stmt->bindValue(':wrapped_dek', $data['wrapped_dek'], PDO::PARAM_LOB);
		$stmt->bindValue(':wrap_nonce', $data['wrap_nonce'], PDO::PARAM_LOB);
		$stmt->bindValue(':created_at', $date, PDO::PARAM_STR);
		$stmt->bindValue(':updated_at', $date, PDO::PARAM_STR);
		return $stmt->execute();
	}

	/**
	 * 覆盖账号库元信息（更换主密码时使用，created_at 保留首次初始化时间）
	 */
	public function updateVaultMeta(array $data): bool
	{
		$stmt = $this->pdo->prepare(
			'UPDATE vault_meta
			SET version = :version,
				kdf = :kdf,
				kdf_salt = :kdf_salt,
				kdf_memory = :kdf_memory,
				kdf_iterations = :kdf_iterations,
				kdf_parallelism = :kdf_parallelism,
				wrapped_dek = :wrapped_dek,
				wrap_nonce = :wrap_nonce,
				updated_at = :updated_at
			WHERE id = 1'
		);
		$stmt->bindValue(':version', (int)$data['version'], PDO::PARAM_INT);
		$stmt->bindValue(':kdf', (string)$data['kdf'], PDO::PARAM_STR);
		$stmt->bindValue(':kdf_salt', $data['kdf_salt'], PDO::PARAM_LOB);
		$stmt->bindValue(':kdf_memory', (int)$data['kdf_memory'], PDO::PARAM_INT);
		$stmt->bindValue(':kdf_iterations', (int)$data['kdf_iterations'], PDO::PARAM_INT);
		$stmt->bindValue(':kdf_parallelism', (int)$data['kdf_parallelism'], PDO::PARAM_INT);
		$stmt->bindValue(':wrapped_dek', $data['wrapped_dek'], PDO::PARAM_LOB);
		$stmt->bindValue(':wrap_nonce', $data['wrap_nonce'], PDO::PARAM_LOB);
		$stmt->bindValue(':updated_at', date('Y-m-d H:i:s'), PDO::PARAM_STR);
		return $stmt->execute();
	}

	/**
	 * 删除账号库元信息（重置账号库）
	 *
	 * 幂等：没有记录时执行删除也不报错，由调用方决定如何提示。
	 */
	public function deleteVaultMeta(): bool
	{
		$stmt = $this->pdo->prepare('DELETE FROM vault_meta WHERE id = 1');
		return $stmt->execute();
	}

	/**
	 * 账号分组列表（按 sort 升序，其次 id）
	 *
	 * 分组是账号库内部字典，与书签 / Skill 的 tags 表完全独立（PRD §5.1.1：
	 * 模块数据隔离，账号库不接入现有标签体系）。
	 */
	public function getAccountGroups(): array
	{
		$stmt = $this->pdo->query('SELECT * FROM account_groups ORDER BY sort ASC, id ASC');
		return $stmt->fetchAll(PDO::FETCH_ASSOC);
	}

	public function getAccountGroupById(int $id)
	{
		$stmt = $this->pdo->prepare('SELECT * FROM account_groups WHERE id = :id');
		$stmt->execute([':id' => $id]);
		return $stmt->fetch(PDO::FETCH_ASSOC);
	}

	/**
	 * 账号列表查询（PRD §8.2 / §8.3）
	 *
	 * 返回 ['total' => 过滤后总数, 'accounts' => 行列表]。total 是分页前的数量，
	 * 供前端分页；limit / offset 可选，传了才生效（前端默认自己分页）。
	 *
	 * 只查账号库自身的表：额外引用 account_groups 仅用于「分组名搜索」，
	 * 绝不联查 items / tags（PRD §5.1.1 模块数据隔离）；
	 * 搜索只覆盖明文元数据，密文字段服务端没有密钥，无法也不应做明文搜索。
	 */
	public function getAccounts(array $filters = []): array
	{
		$where = [];
		$bindings = [];

		$search = trim((string)($filters['search'] ?? ''));
		if ($search !== '') {
			// 四个条件共用 :search 参数；SQLite 允许同名命名参数重复出现。
			// 分组名可搜（PRD §9.5）：用户常按「工作 / 客户」这类分组词找账号，
			// 用 IN 子查询而不是 JOIN，避免联表产生重复行、也让 total 与列表口径天然一致。
			$where[] = "(name LIKE :search ESCAPE '\\'
				OR platform LIKE :search ESCAPE '\\'
				OR identifier LIKE :search ESCAPE '\\'
				OR group_id IN (SELECT id FROM account_groups WHERE name LIKE :search ESCAPE '\\'))";
			$bindings[':search'] = '%' . $this->escapeLike($search) . '%';
		}

		$platform = trim((string)($filters['platform'] ?? ''));
		if ($platform !== '') {
			$where[] = 'platform = :platform';
			$bindings[':platform'] = $platform;
		}

		$group_id = (int)($filters['group_id'] ?? 0);
		if ($group_id > 0) {
			$where[] = 'group_id = :group_id';
			$bindings[':group_id'] = $group_id;
		}

		$where_sql = empty($where) ? '' : ' WHERE ' . implode(' AND ', $where);

		// 排序白名单：未知 sort 值（含注入尝试）回落到默认「更新时间倒序」
		$sort = (string)($filters['sort'] ?? '');
		$sort_sql = self::ACCOUNT_SORTS[$sort] ?? self::ACCOUNT_SORTS['updated_at'];
		$order = strtolower((string)($filters['order'] ?? ''));
		$order_sql = $order === 'asc' ? 'ASC' : 'DESC';

		$stmt = $this->pdo->prepare('SELECT COUNT(*) FROM accounts' . $where_sql);
		$this->bindFilterValues($stmt, $bindings);
		$stmt->execute();
		$total = (int)$stmt->fetchColumn();

		// 追加 id 作为次级排序，保证同一时间戳下分页结果稳定、可复现
		$sql = 'SELECT * FROM accounts' . $where_sql
			. ' ORDER BY ' . $sort_sql . ' ' . $order_sql . ', id ' . $order_sql;

		$limit = (int)($filters['limit'] ?? 0);
		$offset = max(0, (int)($filters['offset'] ?? 0));
		if ($limit > 0) {
			$sql .= ' LIMIT :limit OFFSET :offset';
		}

		$stmt = $this->pdo->prepare($sql);
		$this->bindFilterValues($stmt, $bindings);
		if ($limit > 0) {
			$stmt->bindValue(':limit', $limit, PDO::PARAM_INT);
			$stmt->bindValue(':offset', $offset, PDO::PARAM_INT);
		}
		$stmt->execute();

		return [
			'total' => $total,
			'accounts' => $stmt->fetchAll(PDO::FETCH_ASSOC),
		];
	}

	public function getAccountById(int $id)
	{
		$stmt = $this->pdo->prepare('SELECT * FROM accounts WHERE id = :id');
		$stmt->execute([':id' => $id]);
		return $stmt->fetch(PDO::FETCH_ASSOC);
	}

	/**
	 * 新建账号，返回新 id
	 *
	 * 密文列（*_ct / *_iv）以二进制原样落库：不做 base64，因为服务端只负责搬运
	 * 客户端加密后的字节，多做一层编码只会让导出/备份体积变大且增加出错面。
	 * 用 PARAM_LOB 绑定可避免密文中的 NUL 字节被按 C 字符串截断。
	 *
	 * $id 非空时显式写入该 id：仅备份导入的 replace 模式使用（原样恢复文件里的 id，
	 * 授权关系的引用才对得上）；正常新建不传，走自增分配。id 不放进
	 * ACCOUNT_WRITABLE_COLUMNS——那是 PATCH 的列白名单，放进去会允许改 id。
	 */
	public function createAccount(array $data, ?int $id = null)
	{
		$date = date('Y-m-d H:i:s');
		$values = [];

		foreach (self::ACCOUNT_WRITABLE_COLUMNS as $column) {
			$values[$column] = $data[$column] ?? null;
		}

		// 非空列兜底（真正的必填校验在控制器里做，这里只保证 NOT NULL 列不会写入 NULL）
		$values['name'] = (string)($data['name'] ?? '');
		$values['platform'] = (string)($data['platform'] ?? '');
		$values['identifier'] = (string)($data['identifier'] ?? '');
		$values['login_url'] = (string)($data['login_url'] ?? '');
		$values['favorite'] = !empty($data['favorite']) ? 1 : 0;
		$values['created_at'] = $data['created_at'] ?? $date;
		$values['updated_at'] = $data['updated_at'] ?? $date;

		$columns = self::ACCOUNT_WRITABLE_COLUMNS;
		if (null !== $id) {
			$columns = array_merge(['id'], $columns);
			$values['id'] = $id;
		}
		$columns = array_merge($columns, ['created_at', 'updated_at']);
		$placeholders = array_map(fn($column) => ':' . $column, $columns);

		$stmt = $this->pdo->prepare(
			'INSERT INTO accounts (' . implode(', ', $columns) . ')
			VALUES (' . implode(', ', $placeholders) . ')'
		);

		foreach ($columns as $column) {
			$this->bindColumnValue($stmt, ':' . $column, $values[$column], in_array($column, self::ACCOUNT_BLOB_COLUMNS, true));
		}

		$stmt->execute();

		return (int)$this->pdo->lastInsertId();
	}

	/**
	 * 部分更新账号：只更新传入的列，未传列保持原值
	 *
	 * 密码变更时由控制器显式传入 password_updated_at（PRD §10.3），
	 * 服务端不猜测密码是否变化。
	 * 返回 true 仅代表语句执行成功；rowCount 为 0 可能是「不存在」也可能是「值未变化」，
	 * 是否存在请调用方用 getAccountById 判断。
	 */
	public function updateAccount(int $id, array $data): bool
	{
		$sets = [];
		$bindings = [];

		foreach (self::ACCOUNT_WRITABLE_COLUMNS as $column) {
			if (!array_key_exists($column, $data)) {
				continue;
			}
			$sets[] = $column . ' = :' . $column;
			$bindings[$column] = $data[$column];
		}

		$sets[] = 'updated_at = :updated_at';
		$bindings['updated_at'] = $data['updated_at'] ?? date('Y-m-d H:i:s');

		$stmt = $this->pdo->prepare(
			'UPDATE accounts SET ' . implode(', ', $sets) . ' WHERE id = :id'
		);

		foreach ($bindings as $column => $value) {
			$this->bindColumnValue($stmt, ':' . $column, $value, in_array($column, self::ACCOUNT_BLOB_COLUMNS, true));
		}
		$this->bindColumnValue($stmt, ':id', $id);

		return $stmt->execute();
	}

	/**
	 * 批量删除账号（事务），返回实际删除的账号行数
	 *
	 * SQLite 的外键级联依赖 PRAGMA foreign_keys=ON，而本项目连接未开启该 pragma
	 * （见 deleteSkill 的同类处理），所以授权关系必须显式删除，否则会留下孤儿行。
	 * 删除逻辑：
	 *   1. 删除这些账号自己的授权记录；
	 *   2. 其他账号授权里的 linked_account_id 指向被删账号时置空（保留授权行本身）；
	 *   3. 其他账号的 login_via_account_id 指向被删账号时置空（避免悬空引用）。
	 * 三步与删除本身放在同一事务里，避免中途失败留下半删除状态。
	 */
	public function deleteAccounts(array $ids): int
	{
		$ids = array_values(array_unique(array_filter(
			array_map('intval', $ids),
			fn($id) => $id > 0
		)));

		if (empty($ids)) {
			return 0;
		}

		$sql_in = implode(',', array_fill(0, count($ids), '?'));
		$date = date('Y-m-d H:i:s');

		$this->pdo->beginTransaction();
		try {
			$stmt = $this->pdo->prepare("DELETE FROM account_authorizations WHERE account_id IN ($sql_in)");
			$stmt->execute($ids);

			$stmt = $this->pdo->prepare(
				"UPDATE account_authorizations SET linked_account_id = NULL, updated_at = ?
				WHERE linked_account_id IN ($sql_in)"
			);
			$stmt->execute([$date, ...$ids]);

			$stmt = $this->pdo->prepare(
				"UPDATE accounts SET login_via_account_id = NULL, updated_at = ?
				WHERE login_via_account_id IN ($sql_in)"
			);
			$stmt->execute([$date, ...$ids]);

			$stmt = $this->pdo->prepare("DELETE FROM accounts WHERE id IN ($sql_in)");
			$stmt->execute($ids);
			$deleted = $stmt->rowCount();

			$this->pdo->commit();

			return $deleted;
		} catch (Exception $e) {
			if ($this->pdo->inTransaction()) {
				$this->pdo->rollBack();
			}
			throw $e;
		}
	}

	/**
	 * 某账号的授权关系列表（按 id 升序）
	 */
	public function getAuthorizationsByAccountId(int $account_id): array
	{
		$stmt = $this->pdo->prepare(
			'SELECT * FROM account_authorizations WHERE account_id = :account_id ORDER BY id ASC'
		);
		$stmt->execute([':account_id' => $account_id]);
		return $stmt->fetchAll(PDO::FETCH_ASSOC);
	}

	/**
	 * 全部授权关系（按 id 升序）
	 *
	 * 目前只有加密备份导出使用：导出结构是「一条账号带其授权」，一次查全量再在内存
	 * 按 account_id 分组，比逐账号调 getAuthorizationsByAccountId 少 N-1 次查询。
	 */
	public function getAllAuthorizations(): array
	{
		$stmt = $this->pdo->query('SELECT * FROM account_authorizations ORDER BY id ASC');
		return $stmt->fetchAll(PDO::FETCH_ASSOC);
	}

	public function getAuthorizationById(int $id)
	{
		$stmt = $this->pdo->prepare('SELECT * FROM account_authorizations WHERE id = :id');
		$stmt->execute([':id' => $id]);
		return $stmt->fetch(PDO::FETCH_ASSOC);
	}

	/**
	 * 新建授权关系，返回自增 id
	 *
	 * $id 非空时显式写入该 id：仅备份导入的 replace 模式使用（与 createAccount 的 $id 同理）。
	 * created_at / updated_at 可由调用方传入（导入时保留备份里的时间），缺省取当前时间。
	 */
	public function createAuthorization(array $data, ?int $id = null)
	{
		$date = date('Y-m-d H:i:s');
		$values = [];

		foreach (self::AUTHORIZATION_WRITABLE_COLUMNS as $column) {
			$values[$column] = $data[$column] ?? null;
		}

		// service 非空、status 只能取白名单值（与建表 CHECK 约束一致，避免写入非法状态）
		$values['account_id'] = (int)($data['account_id'] ?? 0);
		$values['service'] = (string)($data['service'] ?? '');
		$values['identifier'] = (string)($data['identifier'] ?? '');
		$values['note'] = (string)($data['note'] ?? '');
		$values['status'] = $this->normalizeAuthorizationStatus($data['status'] ?? null);
		$values['created_at'] = $data['created_at'] ?? $date;
		$values['updated_at'] = $data['updated_at'] ?? $date;

		$columns = self::AUTHORIZATION_WRITABLE_COLUMNS;
		if (null !== $id) {
			$columns = array_merge(['id'], $columns);
			$values['id'] = $id;
		}
		$columns = array_merge($columns, ['created_at', 'updated_at']);
		$placeholders = array_map(fn($column) => ':' . $column, $columns);

		$stmt = $this->pdo->prepare(
			'INSERT INTO account_authorizations (' . implode(', ', $columns) . ')
			VALUES (' . implode(', ', $placeholders) . ')'
		);

		foreach ($columns as $column) {
			$this->bindColumnValue($stmt, ':' . $column, $values[$column]);
		}

		$stmt->execute();

		return (int)$this->pdo->lastInsertId();
	}

	/**
	 * 部分更新授权关系：只更新传入的列
	 */
	public function updateAuthorization(int $id, array $data): bool
	{
		$sets = [];
		$bindings = [];

		foreach (self::AUTHORIZATION_WRITABLE_COLUMNS as $column) {
			if (!array_key_exists($column, $data)) {
				continue;
			}
			$value = $data[$column];
			if ($column === 'status') {
				$value = $this->normalizeAuthorizationStatus($value);
			}
			$sets[] = $column . ' = :' . $column;
			$bindings[$column] = $value;
		}

		$sets[] = 'updated_at = :updated_at';
		$bindings['updated_at'] = date('Y-m-d H:i:s');

		$stmt = $this->pdo->prepare(
			'UPDATE account_authorizations SET ' . implode(', ', $sets) . ' WHERE id = :id'
		);

		foreach ($bindings as $column => $value) {
			$this->bindColumnValue($stmt, ':' . $column, $value);
		}
		$this->bindColumnValue($stmt, ':id', $id);

		return $stmt->execute();
	}

	public function deleteAuthorization(int $id): bool
	{
		$stmt = $this->pdo->prepare('DELETE FROM account_authorizations WHERE id = :id');
		return $stmt->execute([':id' => $id]);
	}

	/**
	 * 重置账号库：删除全部账号、授权关系与 vault_meta（PRD §7.7 / §8.1）。
	 *
	 * 一个事务内完成：只删 meta 会留下「界面显示已重置、库里还有密文」的状态，
	 * 用户重新设置主密码后，旧账号（明文元数据 + 解不开的密文）会重新出现在列表里。
	 * 失败整体回滚，避免删到一半。
	 */
	public function resetVaultData(): void
	{
		$this->pdo->beginTransaction();
		try {
			$this->pdo->exec('DELETE FROM account_authorizations');
			$this->pdo->exec('DELETE FROM accounts');
			$this->deleteVaultMeta();
			$this->pdo->commit();
		} catch (Exception $e) {
			if ($this->pdo->inTransaction()) {
				$this->pdo->rollBack();
			}
			throw $e;
		}
	}

	/**
	 * 导入加密备份（PRD §8.1），返回 ['accounts' => 新导入账号数, 'skipped_accounts' => 跳过数,
	 * 'authorizations' => 导入授权数]。
	 *
	 * $backup 为 Utils\VaultBackupPayload::parse() 的返回值（meta + accounts，密文已是二进制）。
	 *
	 * 为什么整体一个事务：replace 要先清空再逐条写入，merge 也要同时写账号、授权，
	 * 并可能写 vault_meta；任何一步失败都会留下「清空了一半」或「账号进来了授权没进来」
	 * 的中间态，而密文数据写坏没有任何修复手段，所以整体成功、失败整体回滚。
	 *
	 * id 重映射（本任务最易错点）：merge 模式下文件里的账号按**新的自增 id** 插入
	 * （本地 id 空间不被备份文件占用，本地已存在的同 id 账号跳过），因此文件里所有
	 * 「按 id 互相引用」的字段都必须经过 旧 id -> 新 id 映射重写：
	 *   - accounts.login_via_account_id（可能指向文件里更靠后的账号，必须分两遍处理）；
	 *   - account_authorizations.account_id / linked_account_id。
	 * 漏掉任何一处，授权就会挂到错误的账号上，且界面看不出异常（元数据都是明文）。
	 * replace 模式原样写回文件 id，映射退化为恒等，同一套代码同时覆盖两种模式。
	 */
	public function importVaultBackup(array $backup, string $mode): array
	{
		$this->pdo->beginTransaction();
		try {
			if ('replace' === $mode) {
				// 覆盖导入：先清空旧数据。不用 resetVaultData()——那个方法自己开事务，
				// PDO 嵌套 beginTransaction 会直接抛异常；meta 在下面统一刷新。
				$this->pdo->exec('DELETE FROM account_authorizations');
				$this->pdo->exec('DELETE FROM accounts');
			}

			// merge 模式：本地已占用的 id 集合，用于「按 id 冲突跳过」
			$existing_ids = [];
			$existing_authorization_ids = [];
			if ('merge' === $mode) {
				$stmt = $this->pdo->query('SELECT id FROM accounts');
				$existing_ids = array_map('intval', $stmt->fetchAll(PDO::FETCH_COLUMN));
				// 授权同样按 id 冲突跳过：合并的典型场景是「同库部分丢失后重导备份」，
				// 本地账号还在时它的授权也还在，不跳过就会每条授权重复一份
				$stmt = $this->pdo->query('SELECT id FROM account_authorizations');
				$existing_authorization_ids = array_map('intval', $stmt->fetchAll(PDO::FETCH_COLUMN));
			}

			// 分组名 -> 本地分组 id：文件里只保证名称跨设备稳定，id 可能因设备而异
			$group_ids_by_name = [];
			foreach ($this->getAccountGroups() as $group) {
				$group_ids_by_name[(string)$group['name']] = (int)$group['id'];
			}

			// 第一遍：插入账号，建立「文件旧 id -> 本地 id」映射
			$id_map = [];
			/** @var array<int, int> 待重写 login_via 的 [新账号 id => 文件里的旧关联 id] */
			$login_via_updates = [];
			$imported = 0;
			$skipped = 0;

			foreach ($backup['accounts'] as $account) {
				$old_id = (int)$account['id'];

				if ('merge' === $mode && in_array($old_id, $existing_ids, true)) {
					// 本地已存在同 id 账号：跳过并保留本地版本（不覆盖——本地数据可能是更新的）。
					// 映射到同 id：别的账号 / 授权引用它时保持原值即可，本地该 id 账号仍在，引用有效。
					$id_map[$old_id] = $old_id;
					$skipped++;
					continue;
				}

				// 分组按名称解析；文件里的分组名本地不存在时置空（本项目没有自建分组接口，
				// 分组只有种子数据，静默建组会绕过接口约定，置空只是失去分组信息）
				$account['group_id'] = null === $account['group']
					? null
					: ($group_ids_by_name[$account['group']] ?? null);
				unset($account['group']);

				$new_id = $this->createAccount($account, 'replace' === $mode ? $old_id : null);
				$id_map[$old_id] = $new_id;
				$imported++;

				if (null !== $account['login_via_account_id']) {
					// login_via 可能指向文件里更靠后的账号，此刻 id_map 还不完整，
					// 先记账，等所有账号插完再统一重写
					$login_via_updates[$new_id] = (int)$account['login_via_account_id'];
				}
			}

			// 第二遍：重写 login_via_account_id（此时所有账号都已插入，id_map 完整）
			$login_via_stmt = $this->pdo->prepare(
				'UPDATE accounts SET login_via_account_id = :linked, updated_at = :updated_at WHERE id = :id'
			);
			foreach ($login_via_updates as $new_id => $old_linked) {
				$mapped = $id_map[$old_linked] ?? null;
				// 指向不存在（文件损坏）或指向自己（自环无意义）时置空
				if (null !== $mapped && $mapped === $new_id) {
					$mapped = null;
				}
				$login_via_stmt->execute([
					':linked' => $mapped,
					':updated_at' => date('Y-m-d H:i:s'),
					':id' => $new_id,
				]);
			}

			// 第三遍：授权关系，account_id / linked_account_id 经 id_map 重映射
			$authorization_count = 0;
			$skipped_authorizations = 0;
			foreach ($backup['accounts'] as $account) {
				foreach ($account['authorizations'] as $authorization) {
					if (
						'merge' === $mode
						&& null !== $authorization['id']
						&& in_array((int)$authorization['id'], $existing_authorization_ids, true)
					) {
						$skipped_authorizations++;
						continue;
					}

					$account_id = $id_map[(int)$authorization['account_id']] ?? null;
					if (null === $account_id) {
						// 来源账号不在文件里（畸形但结构合法的备份）：授权无处可挂，丢弃
						continue;
					}

					$linked_account_id = null;
					if (null !== $authorization['linked_account_id']) {
						$mapped_linked = $id_map[(int)$authorization['linked_account_id']] ?? null;
						// 关联账号不能是授权所属账号自身（与接口层同一规则）
						$linked_account_id = ($mapped_linked === $account_id) ? null : $mapped_linked;
					}

					$authorization['account_id'] = $account_id;
					$authorization['linked_account_id'] = $linked_account_id;
					$this->createAuthorization($authorization, 'replace' === $mode ? $authorization['id'] : null);
					$authorization_count++;
				}
			}

			// vault_meta 刷新（PRD §8.1：文件带 KDF 元信息时以文件为准，便于跨设备恢复）：
			// - replace：本地数据已清空，密文全部来自文件，必须换成文件的 KDF 参数与
			//   wrapped_dek，否则导入的账号永远解不开；
			// - merge + 本地未初始化（新设备恢复）：写入文件 meta，否则账号接口一律 409；
			// - merge + 本地已初始化：保持本地 meta 不变——本地密文用的是本地 DEK，
			//   覆盖 wrapped_dek 会让本地已有账号全部解不开（控制器已校验两边
			//   wrapped_dek 一致才放行 merge，一致时写不写都一样，索性不写）。
			$meta_row = $this->getVaultMeta();
			if ('replace' === $mode || !$meta_row) {
				if ($meta_row) {
					$this->updateVaultMeta($backup['meta']);
				} else {
					$this->createVaultMeta($backup['meta']);
				}
			}

			$this->pdo->commit();

			return [
				'accounts' => $imported,
				'skipped_accounts' => $skipped,
				'authorizations' => $authorization_count,
				'skipped_authorizations' => $skipped_authorizations,
			];
		} catch (Exception $e) {
			if ($this->pdo->inTransaction()) {
				$this->pdo->rollBack();
			}
			throw $e;
		}
	}

	/**
	 * 账号库统计（锁定页展示，PRD §10.1）
	 *
	 * totpEnabled 只判断 totp_ct 是否为空，不需要解密，服务端也能算。
	 */
	public function getAccountStats(): array
	{
		$total = (int)$this->pdo->query('SELECT COUNT(*) FROM accounts')->fetchColumn();
		$totp_enabled = (int)$this->pdo->query('SELECT COUNT(*) FROM accounts WHERE totp_ct IS NOT NULL')->fetchColumn();
		$platform_count = (int)$this->pdo->query('SELECT COUNT(DISTINCT platform) FROM accounts')->fetchColumn();

		return [
			'total' => $total,
			'totpEnabled' => $totp_enabled,
			'platformCount' => $platform_count,
		];
	}

	/**
	 * 服务器列表（PRD §5.5：个人级数量小，返回全量过滤结果，前端自行分页）
	 *
	 * 与 getAccounts 同套路：搜索 / 分组过滤 + 排序白名单，limit / offset 可选。
	 * 只返回 SERVER_PUBLIC_COLUMNS：token_hash / token_salt 是服务端凭据材料，
	 * 用户态接口不接触（PRD D6 选项 b）。最新指标摘要由调用方按 server_id
	 * 批量查明细表后组装，这里不做联表——明细表行量大（30 天 × 288 点/天），
	 * 联表会拖垮列表查询。
	 */
	public function getServers(array $filters = []): array
	{
		$where = [];
		$bindings = [];

		$search = trim((string)($filters['search'] ?? ''));
		if ($search !== '') {
			// 搜索名称 / 备注 / IP（PRD §5.5）；IP 是 servers 的冗余列，无需联表明细表
			$where[] = "(name LIKE :search ESCAPE '\\'
				OR note LIKE :search ESCAPE '\\'
				OR ip_address LIKE :search ESCAPE '\\')";
			$bindings[':search'] = '%' . $this->escapeLike($search) . '%';
		}

		$group_name = trim((string)($filters['group_name'] ?? ''));
		if ($group_name !== '') {
			$where[] = 'group_name = :group_name';
			$bindings[':group_name'] = $group_name;
		}

		$where_sql = empty($where) ? '' : ' WHERE ' . implode(' AND ', $where);

		// 排序白名单：未知 sort 值（含注入尝试）回落到 id 倒序，新加入的服务器在前
		$sort = (string)($filters['sort'] ?? '');
		$sort_sql = self::SERVER_SORTS[$sort] ?? self::SERVER_SORTS['id'];
		$order = strtolower((string)($filters['order'] ?? ''));
		$order_sql = $order === 'asc' ? 'ASC' : 'DESC';

		// 追加 id 作为次级排序，保证同一时间戳下结果稳定、可复现
		$sql = 'SELECT ' . implode(', ', self::SERVER_PUBLIC_COLUMNS) . ' FROM servers' . $where_sql
			. ' ORDER BY ' . $sort_sql . ' ' . $order_sql . ', id ' . $order_sql;

		$limit = (int)($filters['limit'] ?? 0);
		$offset = max(0, (int)($filters['offset'] ?? 0));
		if ($limit > 0) {
			$sql .= ' LIMIT :limit OFFSET :offset';
		}

		$stmt = $this->pdo->prepare($sql);
		$this->bindFilterValues($stmt, $bindings);
		if ($limit > 0) {
			$stmt->bindValue(':limit', $limit, PDO::PARAM_INT);
			$stmt->bindValue(':offset', $offset, PDO::PARAM_INT);
		}
		$stmt->execute();

		return $stmt->fetchAll(PDO::FETCH_ASSOC);
	}

	/**
	 * 查询单台服务器（含 token_hash / token_salt 的完整行）
	 *
	 * 面向服务端内部使用：agent Token 校验、Token 重置都要读哈希与盐。
	 * 用户态接口拿到返回值后必须自行剔除这两列再响应——本方法不替调用方
	 * 裁剪，是因为内部调用方（如 report 回传）需要完整行，统一裁剪会逼出
	 * 第二个「带凭据」的查询方法，反而更容易用错。
	 */
	public function getServerById(int $id)
	{
		$stmt = $this->pdo->prepare('SELECT * FROM servers WHERE id = :id');
		$stmt->execute([':id' => $id]);
		return $stmt->fetch(PDO::FETCH_ASSOC);
	}

	/**
	 * 枚举全部服务器的 agent 认证材料（connect / report 的 Token 校验用）
	 *
	 * 盐每服务器随机（Utils\ServerToken），Token 校验无法按哈希直接检索，
	 * 只能取回材料后逐条 verify；个人级 < 20 台（PRD §5.5）全表枚举成本
	 * 可忽略。除哈希与盐外只取后续流程必需的列：paused 决定 403，
	 * last_report_at 决定采集指令下发节奏（见 AgentConnectController）。
	 *
	 * 表不存在时返回空数组而不抛异常：agent 端点跳过 migrate（task5），
	 * 数据库尚未初始化（一台服务器都没有）时等价于「查无此服务器」，
	 * 由调用方走统一的 401 分支，而不是把异常抛给被监控机。
	 */
	public function getServerTokenMaterials(): array
	{
		try {
			$stmt = $this->pdo->query(
				'SELECT id, token_hash, token_salt, paused, last_report_at FROM servers'
			);
			return $stmt->fetchAll(PDO::FETCH_ASSOC);
		} catch (Exception $e) {
			return [];
		}
	}

	/**
	 * 新增服务器，返回新 id
	 *
	 * token_hash / token_salt 由调用方（控制器 + Utils\ServerToken）生成后传入：
	 * Token 明文只在添加 / 重置响应里完整展示一次，任何路径都不落库、不写日志
	 * （PRD D6 选项 b / §5.6）。系统信息列此时还是默认空值，等 agent 首次
	 * 回传由 updateServerSystemInfo() 补齐。
	 */
	public function createServer(array $data): int
	{
		$date = date('Y-m-d H:i:s');
		$stmt = $this->pdo->prepare(
			'INSERT INTO servers (name, note, group_name, token_hash, token_salt, paused, created_at, updated_at)
			VALUES (:name, :note, :group_name, :token_hash, :token_salt, :paused, :created_at, :updated_at)'
		);
		$stmt->execute([
			':name' => (string)($data['name'] ?? ''),
			':note' => (string)($data['note'] ?? ''),
			// 分组取值（家庭 / 公网 / 公司 / 归档，PRD D10）由控制器校验，
			// 这里只做字符串兜底，真正的必填校验在控制器
			':group_name' => (string)($data['group_name'] ?? '家庭'),
			':token_hash' => (string)($data['token_hash'] ?? ''),
			':token_salt' => (string)($data['token_salt'] ?? ''),
			':paused' => !empty($data['paused']) ? 1 : 0,
			':created_at' => $date,
			':updated_at' => $date,
		]);
		return (int)$this->pdo->lastInsertId();
	}

	/**
	 * 部分更新服务器：名称 / 备注 / 分组 / 暂停恢复（PATCH 语义）
	 *
	 * 只更新显式传入的列，未传列保持原值；paused 归一为 0 / 1。
	 * token_hash / token_salt 不在这里更新（Token 轮换是独立流程）。
	 * 返回 true 仅代表语句执行成功；服务器是否存在由调用方先用
	 * getServerById() 判断（rowCount 为 0 也可能是值未变化）。
	 */
	public function updateServer(int $id, array $data): bool
	{
		$sets = [];
		$bindings = [];

		foreach (self::SERVER_WRITABLE_COLUMNS as $column) {
			if (!array_key_exists($column, $data)) {
				continue;
			}
			if ('paused' === $column) {
				$sets[] = 'paused = :paused';
				$bindings[':paused'] = !empty($data['paused']) ? 1 : 0;
				continue;
			}
			$sets[] = $column . ' = :' . $column;
			$bindings[':' . $column] = (string)$data[$column];
		}

		$sets[] = 'updated_at = :updated_at';
		$bindings[':updated_at'] = date('Y-m-d H:i:s');
		$bindings[':id'] = $id;

		$stmt = $this->pdo->prepare(
			'UPDATE servers SET ' . implode(', ', $sets) . ' WHERE id = :id'
		);
		return $stmt->execute($bindings);
	}

	/**
	 * 更新系统信息冗余列（PRD §6 / §5.3，agent 回传时调用）
	 *
	 * 只更新显式传入的列；cpu_cores 按整数、其余按字符串落库。
	 * 不刷新 updated_at：系统信息随回传变化，刷新会让 updated_at 失去
	 * 「用户编辑时间」的语义；最后回传时间看 last_report_at。
	 */
	public function updateServerSystemInfo(int $id, array $data): bool
	{
		$sets = [];
		$bindings = [];

		foreach (self::SERVER_SYSTEM_INFO_COLUMNS as $column) {
			if (!array_key_exists($column, $data)) {
				continue;
			}
			$sets[] = $column . ' = :' . $column;
			$bindings[':' . $column] = 'cpu_cores' === $column
				? (int)$data[$column]
				: (string)$data[$column];
		}

		if (empty($sets)) {
			return true;
		}

		$bindings[':id'] = $id;
		$stmt = $this->pdo->prepare(
			'UPDATE servers SET ' . implode(', ', $sets) . ' WHERE id = :id'
		);
		return $stmt->execute($bindings);
	}

	/**
	 * 刷新最后回传时间（agent report 成功落库后调用）
	 *
	 * 时间取服务端当前时间：数据时间戳一律以 Hub 接收时间为准，不信任
	 * 客户端时钟（PRD §5.2）。last_report_at 是列表 / 详情页「最后回传」
	 * 与离线判定的数据基础。
	 */
	public function updateServerLastReportAt(int $id): bool
	{
		$stmt = $this->pdo->prepare(
			'UPDATE servers SET last_report_at = :last_report_at WHERE id = :id'
		);
		return $stmt->execute([
			':last_report_at' => date('Y-m-d H:i:s'),
			':id' => $id,
		]);
	}

	/**
	 * 重置 Agent Token：覆盖 token_hash / token_salt（PRD §5.1 / §5.6 / D6）
	 *
	 * 旧哈希被覆盖的瞬间旧 Token 即失效——ServerToken::verify() 是重算哈希
	 * 后 hash_equals 比对，不存在宽限期，也不需要保留旧哈希。新盐同步轮换，
	 * 避免「新 Token 配旧盐」这种半更新状态。updated_at 一并刷新：Token
	 * 轮换是用户对服务器的主动操作，与 PATCH 改名 / 备注同属「编辑时间」语义。
	 * 明文 Token 不经过本方法（由调用方持有，仅通过重置响应返回一次）。
	 */
	public function updateServerToken(int $id, string $token_hash, string $token_salt): bool
	{
		$stmt = $this->pdo->prepare(
			'UPDATE servers
			SET token_hash = :token_hash, token_salt = :token_salt, updated_at = :updated_at
			WHERE id = :id'
		);
		return $stmt->execute([
			':token_hash' => $token_hash,
			':token_salt' => $token_salt,
			':updated_at' => date('Y-m-d H:i:s'),
			':id' => $id,
		]);
	}

	/**
	 * 删除服务器及其全部历史数据（PRD §5.1：删除连同历史数据，二次确认在控制器）
	 *
	 * SQLite 外键级联依赖 PRAGMA foreign_keys=ON，而本项目连接未开启该 pragma
	 * （见 deleteSkill / deleteAccounts 的同类处理），所以三张明细表与连接
	 * 注册表必须显式删除，否则会留下孤儿行。四步与删除本身放在同一事务里，
	 * 避免中途失败留下半删除状态。删除目标不存在时同样返回 true（幂等）。
	 */
	public function deleteServer(int $id): bool
	{
		$this->pdo->beginTransaction();
		try {
			// 表名来自硬编码清单而非用户输入；server_id 走参数绑定
			foreach (['server_connections', 'server_metrics', 'server_disks', 'server_docker'] as $table) {
				$stmt = $this->pdo->prepare("DELETE FROM {$table} WHERE server_id = :server_id");
				$stmt->execute([':server_id' => $id]);
			}

			$stmt = $this->pdo->prepare('DELETE FROM servers WHERE id = :id');
			$stmt->execute([':id' => $id]);

			$this->pdo->commit();
			return true;
		} catch (Exception $e) {
			if ($this->pdo->inTransaction()) {
				$this->pdo->rollBack();
			}
			return false;
		}
	}

	/**
	 * 写入一条指标明细（agent 回传全量快照时调用，PRD §5.3）
	 *
	 * received_at 一律取服务端接收时间：客户端即使带了时间戳也忽略，
	 * 防止脏数据打乱 30 天清理边界与图表排序（PRD §5.2）。快照事务写入
	 * （insertServerSnapshot）会传入统一的服务端接收时间，保证同一快照的
	 * 各表时间戳一致；单独调用时缺省取当前时间。
	 * 数值范围校验（CPU 0–100、内存不大于总量等，PRD §5.6）由调用方完成，
	 * 本方法只负责落库。
	 */
	public function insertServerMetrics(int $server_id, array $metrics, ?string $received_at = null): bool
	{
		$stmt = $this->pdo->prepare(
			'INSERT INTO server_metrics
			(server_id, received_at, cpu, mem_used, mem_total, mem_cached, swap_used, swap_total, load1, load5, load15, net_rx, net_tx, uptime)
			VALUES
			(:server_id, :received_at, :cpu, :mem_used, :mem_total, :mem_cached, :swap_used, :swap_total, :load1, :load5, :load15, :net_rx, :net_tx, :uptime)'
		);
		return $stmt->execute([
			':server_id' => $server_id,
			':received_at' => $received_at ?? date('Y-m-d H:i:s'),
			':cpu' => (float)($metrics['cpu'] ?? 0),
			':mem_used' => (int)($metrics['mem_used'] ?? 0),
			':mem_total' => (int)($metrics['mem_total'] ?? 0),
			':mem_cached' => (int)($metrics['mem_cached'] ?? 0),
			':swap_used' => (int)($metrics['swap_used'] ?? 0),
			':swap_total' => (int)($metrics['swap_total'] ?? 0),
			':load1' => (float)($metrics['load1'] ?? 0),
			':load5' => (float)($metrics['load5'] ?? 0),
			':load15' => (float)($metrics['load15'] ?? 0),
			':net_rx' => (int)($metrics['net_rx'] ?? 0),
			':net_tx' => (int)($metrics['net_tx'] ?? 0),
			':uptime' => (int)($metrics['uptime'] ?? 0),
		]);
	}

	/**
	 * 按服务器 + 时间范围查指标明细（PRD §6：range=1h|6h|24h|30d）
	 *
	 * $filters 支持：
	 *   range       —— 时间范围字面量（见 SERVER_METRIC_RANGES），换算成 since；
	 *   since/until —— 显式的 received_at 起止（含边界），优先于 range，供聚合
	 *                 查询跨边界取数；
	 *   limit       —— 最多返回行数（0 或不传表示不限制）。
	 * 结果按 received_at 升序：图表与聚合都按时间正序消费。
	 * 本方法只做明细查询；按小时聚合由上层接口完成（决策 D4：不建聚合表）。
	 */
	public function getServerMetrics(int $server_id, array $filters = []): array
	{
		$sql = 'SELECT * FROM server_metrics WHERE server_id = :server_id';
		$bindings = [':server_id' => $server_id];

		$since = trim((string)($filters['since'] ?? ''));
		$range = (string)($filters['range'] ?? '');
		if ($since === '' && isset(self::SERVER_METRIC_RANGES[$range])) {
			$since = date('Y-m-d H:i:s', strtotime(self::SERVER_METRIC_RANGES[$range]));
		}
		if ($since !== '') {
			$sql .= ' AND received_at >= :since';
			$bindings[':since'] = $since;
		}

		$until = trim((string)($filters['until'] ?? ''));
		if ($until !== '') {
			$sql .= ' AND received_at <= :until';
			$bindings[':until'] = $until;
		}

		$sql .= ' ORDER BY received_at ASC';

		$limit = (int)($filters['limit'] ?? 0);
		if ($limit > 0) {
			$sql .= ' LIMIT :limit';
		}

		$stmt = $this->pdo->prepare($sql);
		$this->bindFilterValues($stmt, $bindings);
		if ($limit > 0) {
			$stmt->bindValue(':limit', $limit, PDO::PARAM_INT);
		}
		$stmt->execute();

		return $stmt->fetchAll(PDO::FETCH_ASSOC);
	}

	/**
	 * 查最新一条指标明细（列表卡片 / 详情页当前值用）
	 *
	 * 没有数据时返回 false：「等待连接」的服务器就是这一状态（PRD §5.1）。
	 */
	public function getLatestServerMetrics(int $server_id)
	{
		$stmt = $this->pdo->prepare(
			'SELECT * FROM server_metrics WHERE server_id = :server_id ORDER BY received_at DESC, id DESC LIMIT 1'
		);
		$stmt->execute([':server_id' => $server_id]);
		return $stmt->fetch(PDO::FETCH_ASSOC);
	}

	/**
	 * 按小时聚合指标明细（PRD §6：range=30d 档在 SQL 层聚合后返回）
	 *
	 * 决策 D4：不建聚合表、不保留聚合数据，30 天档图表由本查询现算。
	 * strftime 把 received_at（'Y-m-d H:i:s' 定长文本，字典序即时间序）
	 * 截到小时桶，标签形如 '2026-11-16 14:00:00'，与 received_at 同格式，
	 * 前端可直接当时间戳用，图表代码无需区分明细与聚合两种数据来源。
	 *
	 * 聚合口径（30 天档看趋势，与 beszel 长档位的平均口径一致）：
	 * - 速率与用量类（cpu / load1-15 / net_rx / net_tx / mem_used /
	 *   mem_cached / swap_used）取 AVG：滤掉单点尖峰，曲线更稳；
	 * - 容量与累计类（mem_total / swap_total / uptime）取 MAX：总量在时段内
	 *   恒定或缓变，取 MAX 代表该小时的容量基线；uptime 取 MAX 也可避免
	 *   机器中途重启把均值拉出一个难解释的凹陷。
	 *
	 * $range 只接受 30d（控制器白名单已校验）：这里再用 SERVER_METRIC_RANGES
	 * 收束一次，未知值回落 30d——聚合查询与明细保留期共用同一时间原点。
	 * 空结果（新添加 / 该时段无数据）返回空数组，由调用方决定点数 0 的表现。
	 */
	public function getServerMetricsHourly(int $server_id, string $range = '30d'): array
	{
		$since = date('Y-m-d H:i:s', strtotime(self::SERVER_METRIC_RANGES[$range] ?? self::SERVER_METRIC_RANGES['30d']));

		// strftime 的格式串含单引号，SQL 用双引号包裹避免转义；小时桶表达式在
		// SELECT 与 GROUP BY 中各写一份（SQLite 不允许 GROUP BY 引用 SELECT 别名
		// 的跨方言保证，显式重复最稳），ORDER BY 引用输出别名 received_at
		$stmt = $this->pdo->prepare(
			"SELECT
				strftime('%Y-%m-%d %H:00:00', received_at) AS received_at,
				AVG(cpu) AS cpu,
				AVG(mem_used) AS mem_used,
				MAX(mem_total) AS mem_total,
				AVG(mem_cached) AS mem_cached,
				AVG(swap_used) AS swap_used,
				MAX(swap_total) AS swap_total,
				AVG(load1) AS load1,
				AVG(load5) AS load5,
				AVG(load15) AS load15,
				AVG(net_rx) AS net_rx,
				AVG(net_tx) AS net_tx,
				MAX(uptime) AS uptime
			FROM server_metrics
			WHERE server_id = :server_id AND received_at >= :since
			GROUP BY strftime('%Y-%m-%d %H:00:00', received_at)
			ORDER BY received_at ASC"
		);
		$stmt->execute([':server_id' => $server_id, ':since' => $since]);

		return $stmt->fetchAll(PDO::FETCH_ASSOC);
	}

	/**
	 * 批量写入磁盘明细（一次快照的每个挂载点一行，PRD §5.3）
	 *
	 * received_at 整批取同一个服务端时间：同一快照的各行时间必须一致，
	 * 「查最新一批」才能按 received_at 完整取回。$received_at 由
	 * insertServerSnapshot 传入统一的服务端接收时间；单独调用时缺省取当前
	 * 时间。空数组直接返回 true（无磁盘数据 / 采集失败的场景，不影响其余
	 * 指标回传）。
	 */
	public function insertServerDisks(int $server_id, array $disks, ?string $received_at = null): bool
	{
		if (empty($disks)) {
			return true;
		}

		$received_at = $received_at ?? date('Y-m-d H:i:s');
		$placeholders = [];
		$params = [];
		foreach ($disks as $disk) {
			$placeholders[] = '(?, ?, ?, ?, ?)';
			array_push(
				$params,
				$server_id,
				$received_at,
				(string)($disk['mount'] ?? ''),
				(int)($disk['used'] ?? 0),
				(int)($disk['total'] ?? 0)
			);
		}

		$stmt = $this->pdo->prepare(
			'INSERT INTO server_disks (server_id, received_at, mount, used, total) VALUES '
			. implode(', ', $placeholders)
		);
		return $stmt->execute($params);
	}

	/**
	 * 查最新一批磁盘明细（详情页磁盘区用）
	 *
	 * 「一批」= 该服务器 received_at 最大的所有行：一次快照写入多个挂载点，
	 * 只有按批次取回，才不会混进上一批已卸载的挂载点。子查询复用
	 * :server_id 命名参数（PDO 命名参数可重复出现）。
	 */
	public function getLatestServerDisks(int $server_id): array
	{
		$stmt = $this->pdo->prepare(
			'SELECT * FROM server_disks
			WHERE server_id = :server_id AND received_at = (
				SELECT MAX(received_at) FROM server_disks WHERE server_id = :server_id
			)
			ORDER BY mount ASC'
		);
		$stmt->execute([':server_id' => $server_id]);
		return $stmt->fetchAll(PDO::FETCH_ASSOC);
	}

	/**
	 * 批量写入 Docker 容器明细（一次快照的每个容器一行，PRD §5.3）
	 *
	 * 口径：CPU 为百分比（不乘核数）、内存为 usage − inactive_file、网络为
	 * agent 侧算好的速率 bytes/s。Docker 不可用时传空数组即可，不影响其余
	 * 指标回传（PRD §5.3）。received_at 整批一致，语义同磁盘；
	 * $received_at 由 insertServerSnapshot 传入统一的服务端接收时间。
	 */
	public function insertServerDocker(int $server_id, array $containers, ?string $received_at = null): bool
	{
		if (empty($containers)) {
			return true;
		}

		$received_at = $received_at ?? date('Y-m-d H:i:s');
		$placeholders = [];
		$params = [];
		foreach ($containers as $container) {
			$placeholders[] = '(?, ?, ?, ?, ?, ?, ?, ?, ?)';
			array_push(
				$params,
				$server_id,
				$received_at,
				(string)($container['container'] ?? ''),
				(float)($container['cpu'] ?? 0),
				(int)($container['mem_used'] ?? 0),
				(int)($container['mem_limit'] ?? 0),
				(int)($container['net_rx'] ?? 0),
				(int)($container['net_tx'] ?? 0),
				(string)($container['state'] ?? '')
			);
		}

		$stmt = $this->pdo->prepare(
			'INSERT INTO server_docker
			(server_id, received_at, container, cpu, mem_used, mem_limit, net_rx, net_tx, state)
			VALUES ' . implode(', ', $placeholders)
		);
		return $stmt->execute($params);
	}

	/**
	 * 一次回传快照的完整落库（agent report 调用，PRD §5.3 / §5.2）
	 *
	 * 指标 1 行 + 磁盘 N 行 + Docker N 行 + servers.last_report_at 与系统信息
	 * 冗余列，全部在同一事务内。received_at 由本方法统一取一次服务端时间传给
	 * 三个 insert：同一快照的各表各行必须带同一时间戳，「查最新一批」才能按
	 * received_at 完整取回；last_report_at 与 received_at 同源——数据时间戳
	 * 一律以 Hub 接收时间为准，不信任客户端时钟（PRD §5.2）。
	 *
	 * 任一写失败整体回滚：半份快照（有指标无磁盘）会让详情页把上一批磁盘与
	 * 新指标混在一起展示，比丢一整包更糟；回滚后库内停留在上一份完整快照，
	 * agent 下一采集周期自然重传。PDO 为 ERRMODE_EXCEPTION（见 init.php），
	 * 写失败抛异常即进 catch 回滚，无需逐个检查返回值。
	 *
	 * $metrics / $disks / $containers 的结构与字段校验（白名单、范围、结构
	 * 越界，PRD §5.6）由调用方（Controllers\AgentReportController）完成，
	 * 本方法只负责落库；$system_info 为空数组时只刷新 last_report_at
	 * （updateServerSystemInfo 对空数据是 no-op）。
	 */
	public function insertServerSnapshot(int $server_id, array $metrics, array $disks, array $containers, array $system_info): bool
	{
		$this->pdo->beginTransaction();
		try {
			$received_at = date('Y-m-d H:i:s');

			$this->insertServerMetrics($server_id, $metrics, $received_at);
			$this->insertServerDisks($server_id, $disks, $received_at);
			$this->insertServerDocker($server_id, $containers, $received_at);
			$this->updateServerLastReportAt($server_id);
			$this->updateServerSystemInfo($server_id, $system_info);

			$this->pdo->commit();
			return true;
		} catch (Exception $e) {
			if ($this->pdo->inTransaction()) {
				$this->pdo->rollBack();
			}
			return false;
		}
	}

	/**
	 * 查最新一批 Docker 容器明细（详情页 Docker 区用，批次语义同磁盘）
	 */
	public function getLatestServerDocker(int $server_id): array
	{
		$stmt = $this->pdo->prepare(
			'SELECT * FROM server_docker
			WHERE server_id = :server_id AND received_at = (
				SELECT MAX(received_at) FROM server_docker WHERE server_id = :server_id
			)
			ORDER BY container ASC'
		);
		$stmt->execute([':server_id' => $server_id]);
		return $stmt->fetchAll(PDO::FETCH_ASSOC);
	}

	/**
	 * 注册一条活跃连接（长轮询接入时调用，PRD §5.2 / D11）
	 *
	 * 每 Token（server_id）同时只允许一条活跃连接：先删该服务器的旧行再插
	 * 新行，旧连接自检 isServerConnectionActive() 发现自己的 connection_id
	 * 已被顶替，即退出等待、由 agent 侧重连。唯一索引
	 * idx_server_connections_server_id 在并发双写下兜底。
	 *
	 * $connection_id 是 Hub 生成的随机连接标识（不存 Agent Token 明文——
	 * Token 是高价值凭据，任何表都不落明文）；$ttl 为过期秒数，应略大于
	 * 长轮询持有上限（开发规范：持有 50s，默认 60s），过期行由
	 * cleanupServerConnections() 清理，作为「断开即离线」的兜底。
	 */
	public function registerServerConnection(int $server_id, string $connection_id, int $ttl = 60): bool
	{
		$this->pdo->beginTransaction();
		try {
			$stmt = $this->pdo->prepare('DELETE FROM server_connections WHERE server_id = :server_id');
			$stmt->execute([':server_id' => $server_id]);

			$stmt = $this->pdo->prepare(
				'INSERT INTO server_connections (server_id, connection_id, registered_at, expires_at)
				VALUES (:server_id, :connection_id, :registered_at, :expires_at)'
			);
			$stmt->execute([
				':server_id' => $server_id,
				':connection_id' => $connection_id,
				':registered_at' => date('Y-m-d H:i:s'),
				':expires_at' => date('Y-m-d H:i:s', time() + $ttl),
			]);

			$this->pdo->commit();
			return true;
		} catch (Exception $e) {
			if ($this->pdo->inTransaction()) {
				$this->pdo->rollBack();
			}
			return false;
		}
	}

	/**
	 * 校验连接是否仍然活跃（长轮询循环内每秒自检，PRD §5.2）
	 *
	 * 两个失效原因同一出口：被新连接顶替（connection_id 不匹配）或已过期
	 * （expires_at 早于当前时间）都返回 false，调用方无需区分。
	 * expires_at 是定长 'Y-m-d H:i:s' 文本，字典序即时间序，可直接比较。
	 */
	public function isServerConnectionActive(int $server_id, string $connection_id): bool
	{
		$stmt = $this->pdo->prepare(
			'SELECT 1 FROM server_connections
			WHERE server_id = :server_id
			AND connection_id = :connection_id
			AND expires_at > :now'
		);
		$stmt->execute([
			':server_id' => $server_id,
			':connection_id' => $connection_id,
			':now' => date('Y-m-d H:i:s'),
		]);
		return (bool)$stmt->fetchColumn();
	}

	/**
	 * 查该服务器当前活跃（未过期）的连接 id，没有则返回 null
	 *
	 * 面向列表 / 详情等「只需要知道连没连上」的调用方：isServerConnectionActive()
	 * 要调用方自己持有 connection_id（长轮询循环内自检用），而用户态接口只知道
	 * server_id，没有连接 id 可传。server_connections 的 server_id 有唯一索引，
	 * 每台服务器最多一行，命中即代表在线（PRD §5.1 / §5.2）。
	 */
	public function getActiveServerConnectionId(int $server_id): ?string
	{
		$stmt = $this->pdo->prepare(
			'SELECT connection_id FROM server_connections
			WHERE server_id = :server_id AND expires_at > :now'
		);
		$stmt->execute([
			':server_id' => $server_id,
			':now' => date('Y-m-d H:i:s'),
		]);
		$connection_id = $stmt->fetchColumn();

		return false === $connection_id ? null : (string)$connection_id;
	}

	/**
	 * 清理过期的连接行，返回删除行数
	 *
	 * 表只有「每服务器一行」的量级，全表删除的成本可忽略；失败时返回 0
	 * 不抛异常——清理是尽力而为的后台行为，不该打断调用方主流程。
	 */
	public function cleanupServerConnections(): int
	{
		try {
			$stmt = $this->pdo->prepare('DELETE FROM server_connections WHERE expires_at <= :now');
			$stmt->execute([':now' => date('Y-m-d H:i:s')]);
			return $stmt->rowCount();
		} catch (Exception $e) {
			return 0;
		}
	}

	/**
	 * 删除一条连接注册行（长轮询退出时清理自己，PRD §5.2 / 决策 D11）
	 *
	 * 按 (server_id, connection_id) 精确删除：被新连接挤占时自己的行早已
	 * 被 registerServerConnection() 顶掉，这条 DELETE 是空操作，不会误删
	 * 挤占者的新行。退出时必须清理——否则注册行要等 expires_at（默认
	 * 60s）才过期，重连空档里服务器仍显示在线，「断开即离线（秒级）」
	 * （PRD §5.2）兑现不了。清理失败不抛异常：过期行有 TTL 兜底，
	 * 退出路径不该被一次清理失败打断。
	 */
	public function deleteServerConnection(int $server_id, string $connection_id): bool
	{
		try {
			$stmt = $this->pdo->prepare(
				'DELETE FROM server_connections WHERE server_id = :server_id AND connection_id = :connection_id'
			);
			return $stmt->execute([
				':server_id' => $server_id,
				':connection_id' => $connection_id,
			]);
		} catch (Exception $e) {
			return false;
		}
	}

	/**
	 * 30 天明细清理（PRD §5.4 / 决策 D4：到期直接删除，不建聚合表）
	 *
	 * 挂在 migrate() 末尾顺带执行，因此必须轻量且幂等：三条 DELETE 各自只做
	 * 一次 received_at 比较，无命中时成本接近空扫描；任何一张表失败都不
	 * 影响其它表与迁移主流程（个人数据量下每请求执行的代价可忽略）。
	 * 表名来自硬编码清单而非用户输入，接收时间走参数绑定。
	 */
	public function cleanupServerRetention(int $days = 30): int
	{
		$deleted = 0;
		$cutoff = date('Y-m-d H:i:s', strtotime('-' . max(1, $days) . ' days'));

		foreach (['server_metrics', 'server_disks', 'server_docker'] as $table) {
			try {
				$stmt = $this->pdo->prepare("DELETE FROM {$table} WHERE received_at < :cutoff");
				$stmt->execute([':cutoff' => $cutoff]);
				$deleted += $stmt->rowCount();
			} catch (Exception $e) {
				// 表不存在等异常不应阻断迁移：跳过，下个请求再试
			}
		}

		return $deleted;
	}

	/**
	 * 状态归一：非法或缺失一律回落到 active，与建表 CHECK 约束保持一致
	 */
	private function normalizeAuthorizationStatus($status): string
	{
		$status = (string)$status;
		return in_array($status, self::AUTHORIZATION_STATUSES, true) ? $status : 'active';
	}

	/**
	 * 绑定过滤参数（搜索平台分组等纯文本/整数条件，不含密文）
	 */
	private function bindFilterValues(PDOStatement $stmt, array $bindings): void
	{
		foreach ($bindings as $placeholder => $value) {
			if (is_int($value)) {
				$stmt->bindValue($placeholder, $value, PDO::PARAM_INT);
			} else {
				$stmt->bindValue($placeholder, (string)$value, PDO::PARAM_STR);
			}
		}
	}

	/**
	 * 按值类型绑定列值：NULL → PARAM_NULL，密文 → PARAM_LOB，整数 → PARAM_INT，其余 → 字符串
	 */
	private function bindColumnValue(PDOStatement $stmt, string $placeholder, $value, bool $is_blob = false): void
	{
		if ($value === null) {
			$stmt->bindValue($placeholder, null, PDO::PARAM_NULL);
			return;
		}

		if ($is_blob) {
			$stmt->bindValue($placeholder, $value, PDO::PARAM_LOB);
			return;
		}

		if (is_bool($value)) {
			$stmt->bindValue($placeholder, (int)$value, PDO::PARAM_INT);
			return;
		}

		if (is_int($value)) {
			$stmt->bindValue($placeholder, $value, PDO::PARAM_INT);
			return;
		}

		$stmt->bindValue($placeholder, (string)$value, PDO::PARAM_STR);
	}

	/**
	 * 转义 LIKE 通配符
	 *
	 * 用户搜索词里的 % / _ / \ 若不当普通字符处理，会被当成通配符导致结果异常；
	 * 反斜杠必须先转义，否则会把自己转义后的内容再次转义。
	 */
	private function escapeLike(string $value): string
	{
		return str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $value);
	}

	public function setItemTags(array $tag_ids, int $item_id): bool
	{
		// 1. delete all tags relations
		$result = $this->deleteItemsTags([$item_id], []);
		if (false === $result) {
			return false;
		}

		// 2. insert new tags relations
		return $this->attachItemsTags([$item_id], $tag_ids);
	}

	public function deleteItemsTags(array $item_ids, array $except_tag_ids): bool
	{
		if (empty($item_ids)) {
			return false;
		}
		$sql_in_item_ids = implode(',', array_fill(0, count($item_ids), '?'));
		$sql_data = $item_ids;

		if (!empty($except_tag_ids)) {
			$sql_not_in_tag_ids = implode(',', array_fill(0, count($except_tag_ids), '?'));
			$sql_not_in_tag_ids = " AND tag_id NOT IN ($sql_not_in_tag_ids)";
			$sql_data = array_merge($sql_data, $except_tag_ids);
		} else {
			$sql_not_in_tag_ids = '';
		}
		$stmt = $this->pdo->prepare("DELETE FROM items_tags 
		WHERE item_id IN ($sql_in_item_ids)
		$sql_not_in_tag_ids");
		return $stmt->execute($sql_data);
	}

	public function attachItemsTags(array $item_ids, array $tag_ids): bool
	{
		if (empty($tag_ids)) {
			return true;
		}

		$sql_data = [];

		foreach ($item_ids as $item_id) {
			foreach ($tag_ids as $tag_id) {
				array_push($sql_data, $item_id, (int)$tag_id);
			}
		}

		$sql = 'INSERT  
		INTO items_tags (item_id, tag_id) 
		VALUES ' . implode(',', array_fill(0, count($sql_data) / 2, '(?, ?)'));
		$stmt = $this->pdo->prepare($sql);
		return $stmt->execute($sql_data);
	}

	public function refreshItemsUpdatedAt($item_ids)
	{
		if (empty($item_ids)) {
			return false;
		}
		$sql_in = implode(',', array_fill(0, count($item_ids), '?'));
		$stmt = $this->pdo->prepare(
			"UPDATE items 
			SET updated_at = ?
    		WHERE id IN ($sql_in)"
		);
		return $stmt->execute([
			date('Y-m-d H:i:s'),
			...$item_ids,
		]);
	}

	public function updateItem($title, $description, $url, $comments, $item_id): bool
	{
		$stmt = $this->pdo->prepare(
			'UPDATE items
			SET title = :title, description = :description, url = :url, comments = :comments, updated_at = :updated_at
    		WHERE id = :id'
		);
		$result = $stmt->execute([
			':title' => $title,
			':description' => $description,
			':url' => $url,
			':comments' => $comments,
			':updated_at' => date('Y-m-d H:i:s'),
			':id' => $item_id,
		]);
		return $result && !!$stmt->rowCount();
	}

	public function updateItemsMetadata($title, $description, $item_ids)
	{
		if (empty($item_ids)) {
			return false;
		}
		$sql_in = implode(',', array_fill(0, count($item_ids), '?'));
		$stmt = $this->pdo->prepare(
			"UPDATE items
			SET title = ?,
				description = ?,
				updated_at = ?
    		WHERE id IN ($sql_in)"
		);
		return $stmt->execute([
			$title,
			$description,
			date('Y-m-d H:i:s'),
			...$item_ids,
		]);
	}


	public function updateTag($tag_id, string $title, string $description, int $parent_id)
	{
		$stmt = $this->pdo->prepare(
			'UPDATE tags 
			SET title = :title, 
			description = :description, 
			parent = :parent, 
			updated_at = :updated_at
			WHERE id = :id'
		);

		return $stmt->execute([
			':title' => $title,
			':description' => $description,
			':parent' => $parent_id,
			':updated_at' => date('Y-m-d H:i:s'),
			':id' => $tag_id
		]);
	}

	public function updateTagColor($tag_id, $color)
	{
		$stmt = $this->pdo->prepare(
			'UPDATE tags 
			SET color = :color,
			updated_at = :updated_at
			WHERE id = :id'
		);

		return $stmt->execute([
			':color' => $color,
			':updated_at' => date('Y-m-d H:i:s'),
			':id' => $tag_id
		]);
	}

	public function updateTagPinned($tag_id, bool $pinned)
	{
		$stmt = $this->pdo->prepare(
			'UPDATE tags 
			SET pinned = :pinned,
			updated_at = :updated_at
			WHERE id = :id'
		);

		return $stmt->execute([
			':pinned' => (int)$pinned,
			':updated_at' => date('Y-m-d H:i:s'),
			':id' => $tag_id
		]);
	}

	public function deleteTagsItemAttachment(array $tag_ids)
	{
		if (empty($tag_ids)) {
			return false;
		}

		$sql_in = implode(',', array_fill(0, count($tag_ids), '?'));
		$stmt = $this->pdo->prepare("DELETE FROM items_tags
		WHERE tag_id IN ($sql_in)");

		return $stmt->execute($tag_ids);

	}

	/**
	 * 删除 skills_tags 中引用这些标签的关联（PRD O-9）
	 *
	 * SQLite 连接未开 PRAGMA foreign_keys，skills_tags 的 ON DELETE CASCADE
	 * 不会生效；删除 skills 模块标签时必须手动清理，否则残留悬空关联，
	 * 后续按模块校验标签存在性会直接报错。
	 */
	public function deleteSkillsTagsAttachment(array $tag_ids)
	{
		if (empty($tag_ids)) {
			return false;
		}

		$sql_in = implode(',', array_fill(0, count($tag_ids), '?'));
		$stmt = $this->pdo->prepare("DELETE FROM skills_tags
		WHERE tag_id IN ($sql_in)");

		return $stmt->execute($tag_ids);

	}

	public function deleteTags(array $tag_ids)
	{
		if (empty($tag_ids)) {
			return false;
		}
		$sql_in = implode(',', array_fill(0, count($tag_ids), '?'));

		$stmt = $this->pdo->prepare("DELETE FROM tags 
		WHERE id IN ($sql_in)");

		return $stmt->execute($tag_ids);

	}


	public function deleteItems(array $item_ids): bool
	{
		if (empty($item_ids)) {
			return false;
		}
		$sql_in = implode(',', array_fill(0, count($item_ids), '?'));
		$stmt = $this->pdo->prepare("DELETE FROM items WHERE id IN ($sql_in)");

		return $stmt->execute($item_ids);

	}

	/**
	 * Check if database tables exist
	 *
	 * @return bool
	 */
	public function checkDatabaseExists()
	{
		try {
			$stmt = $this->pdo->query("SELECT name FROM sqlite_master WHERE type='table' AND name='items'");
			return $stmt->fetch() !== false;
		} catch (Exception $e) {
			return false;
		}
	}

	/**
	 * Set up database tables
	 *
	 * @return bool
	 */
	public function setupDatabase()
	{
		try {
			// Create items table
			$this->pdo->exec('CREATE TABLE IF NOT EXISTS items (
				id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
				title TEXT NOT NULL,
				description TEXT NOT NULL,
				url TEXT NOT NULL,
				comments TEXT NOT NULL,
				created_at TEXT DEFAULT(NULL),
				updated_at TEXT DEFAULT(NULL)
			)');

			// Create tags table
			// module 列实现标签按模块隔离（PRD O-9）：bookmarks / skills 各自独立，
			// 账号库不接入本表；唯一索引随之改为 (module, title, parent)
			$this->pdo->exec('CREATE TABLE IF NOT EXISTS tags (
				id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
			   title TEXT NOT NULL,
			   description TEXT NOT NULL,
			   color TEXT NOT NULL,
			   parent INTEGER NOT NULL DEFAULT(0),
			   pinned INTEGER NOT NULL DEFAULT(0),
			   module TEXT NOT NULL DEFAULT(\'bookmarks\'),
			   created_at TEXT DEFAULT(NULL),
			   updated_at TEXT DEFAULT(NULL)
			)');

			// 标签模块隔离唯一索引（PRD O-9）：与 migrate() 共用同一建索引方法，新旧库一致
			if (!$this->createTagModuleIndex()) {
				return false;
			}

			// Create items_tags relationship table
			$this->pdo->exec('CREATE TABLE IF NOT EXISTS items_tags (
				item_id INTEGER NOT NULL,
				tag_id INTEGER NOT NULL,
				PRIMARY KEY(item_id, tag_id) 
				FOREIGN KEY(item_id) REFERENCES items(id) 
				ON DELETE CASCADE 
				FOREIGN KEY(tag_id) REFERENCES tags(id) 
				ON DELETE CASCADE
			)');

			// 账号库元信息表（PRD §6.1）：新库在这里建，老库由 migrate() 的增量逻辑补齐
			if (!$this->setupVaultMetaTable()) {
				return false;
			}

			// 账号库三表（PRD §6.2 / §6.3 / §6.4）：注意创建顺序，accounts 依赖 account_groups，
			// account_authorizations 依赖 accounts
			if (!$this->setupAccountGroupsTable()) {
				return false;
			}

			if (!$this->setupAccountsTable()) {
				return false;
			}

			if (!$this->setupAccountAuthorizationsTable()) {
				return false;
			}

			if (!$this->createAccountIndexes()) {
				return false;
			}

			// 服务器监控五表（PRD §6）：servers → server_metrics / server_disks /
			// server_docker → server_connections；与 migrate() 共用同一批幂等
			// setup 方法，保证新库与老库升级后的结构一致
			if (!$this->setupServersTable()) {
				return false;
			}

			if (!$this->setupServerMetricsTable()) {
				return false;
			}

			if (!$this->setupServerDisksTable()) {
				return false;
			}

			if (!$this->setupServerDockerTable()) {
				return false;
			}

			if (!$this->setupServerConnectionsTable()) {
				return false;
			}

			if (!$this->createServerIndexes()) {
				return false;
			}

			// 设置表（PRD O-5）：与 migrate() 共用同一建表方法，新旧库一致
			if (!$this->setupAppSettingsTable()) {
				return false;
			}

			return true;
		} catch (Exception $e) {
			return false;
		}
	}

	public function migrate()
	{
		if (!$this->checkUsersTableExists() && !$this->setupUsersTable()) {
			throw new Exception('Failed to set up users table');
		}

		if (!$this->checkSkillsTableExists() && !$this->setupSkillsTable()) {
			throw new Exception('Failed to set up skills table');
		}

		if (!$this->checkSkillsTagsTableExists() && !$this->setupSkillsTagsTable()) {
			throw new Exception('Failed to set up skills_tags table');
		}

		// 设置表（PRD O-5）：老库在这里补齐，与 setupDatabase() 保持幂等一致
		if (!$this->checkAppSettingsTableExists() && !$this->setupAppSettingsTable()) {
			throw new Exception('Failed to set up app_settings table');
		}

		if (!$this->checkVaultMetaTableExists() && !$this->setupVaultMetaTable()) {
			throw new Exception('Failed to set up vault_meta table');
		}

		// 账号库三表：老库在这里补齐（顺序同 setupDatabase：分组 → 账号 → 授权）
		if (!$this->checkAccountGroupsTableExists() && !$this->setupAccountGroupsTable()) {
			throw new Exception('Failed to set up account_groups table');
		}

		if (!$this->checkAccountsTableExists() && !$this->setupAccountsTable()) {
			throw new Exception('Failed to set up accounts table');
		}

		if (!$this->checkAccountAuthorizationsTableExists() && !$this->setupAccountAuthorizationsTable()) {
			throw new Exception('Failed to set up account_authorizations table');
		}

		// 索引与种子数据每次都做幂等补齐：索引清单可能新增，分组也可能因历史原因缺失
		if (!$this->createAccountIndexes()) {
			throw new Exception('Failed to create indexes for account vault tables');
		}

		if (!$this->seedAccountGroups()) {
			throw new Exception('Failed to seed account groups');
		}

		// 服务器监控五表（PRD §6）：老库在这里补齐。setup 方法内部全是
		// CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS，可重复执行；
		// 索引每次请求都走 createServerIndexes() 幂等补齐，与账号库同一模式
		if (!$this->checkServersTableExists() && !$this->setupServersTable()) {
			throw new Exception('Failed to set up servers table');
		}

		if (!$this->checkServerMetricsTableExists() && !$this->setupServerMetricsTable()) {
			throw new Exception('Failed to set up server_metrics table');
		}

		if (!$this->checkServerDisksTableExists() && !$this->setupServerDisksTable()) {
			throw new Exception('Failed to set up server_disks table');
		}

		if (!$this->checkServerDockerTableExists() && !$this->setupServerDockerTable()) {
			throw new Exception('Failed to set up server_docker table');
		}

		if (!$this->checkServerConnectionsTableExists() && !$this->setupServerConnectionsTable()) {
			throw new Exception('Failed to set up server_connections table');
		}

		if (!$this->createServerIndexes()) {
			throw new Exception('Failed to create indexes for server tables');
		}

		// 标签模块隔离（PRD O-9）：补 module 列、迁移历史数据、更换唯一索引，每一步都幂等
		if (!$this->migrateTagsModule()) {
			throw new Exception('Failed to migrate tags module');
		}

		// Drop the legacy image column if it still exists (image feature removed)
		if ($this->checkItemsImageColumnExists()) {
			$this->dropItemsImageColumn();
		}

		// 30 天明细清理（PRD §5.4 / 决策 D4）：migrate 每请求都会执行到这里，
		// 顺带删除 server_metrics / server_disks / server_docker 中过期的行。
		// 清理方法内部自行兜底异常，失败不影响迁移主流程
		$this->cleanupServerRetention();
	}

	/**
	 * Check if the legacy image column still exists on the items table
	 */
	public function checkItemsImageColumnExists(): bool
	{
		try {
			$stmt = $this->pdo->query('SELECT image FROM items LIMIT 1');
			return true;
		} catch (Exception $e) {
			return false;
		}
	}

	public function dropItemsImageColumn(): bool
	{
		try {
			$this->pdo->exec('ALTER TABLE items DROP COLUMN image');
			return true;
		} catch (Exception $e) {
			return false;
		}
	}

	/**
	 * Check if users table exists
	 *
	 * @return bool
	 */
	public function checkUsersTableExists()
	{
		try {
			$stmt = $this->pdo->query("SELECT name FROM sqlite_master WHERE type='table' AND name='users'");
			return $stmt->fetch() !== false;
		} catch (Exception $e) {
			return false;
		}
	}

	public function setupUsersTable()
	{
		try {
			// Create users table
			$this->pdo->exec('CREATE TABLE IF NOT EXISTS users (
				id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
				username TEXT NOT NULL UNIQUE,
				password_hash TEXT NOT NULL,
				created_at TEXT DEFAULT(NULL),
				updated_at TEXT DEFAULT(NULL)
			)');
			return true;
		} catch (Exception $e) {
			return false;
		}
	}

	/**
	 * Check if skills table exists
	 *
	 * @return bool
	 */
	public function checkSkillsTableExists()
	{
		try {
			$stmt = $this->pdo->query("SELECT name FROM sqlite_master WHERE type='table' AND name='skills'");
			return $stmt->fetch() !== false;
		} catch (Exception $e) {
			return false;
		}
	}

	public function setupSkillsTable()
	{
		try {
			// Create skills table
			$this->pdo->exec('CREATE TABLE IF NOT EXISTS skills (
				id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
				name TEXT NOT NULL UNIQUE,
				description TEXT NOT NULL DEFAULT \'\',
				source_type TEXT NOT NULL,
				source_url TEXT NOT NULL DEFAULT \'\',
				fingerprint TEXT NOT NULL DEFAULT \'\',
				installed_at TEXT DEFAULT(NULL),
				updated_at TEXT DEFAULT(NULL)
			)');
			return true;
		} catch (Exception $e) {
			return false;
		}
	}

	/**
	 * Check if skills_tags table exists
	 *
	 * @return bool
	 */
	public function checkSkillsTagsTableExists()
	{
		try {
			$stmt = $this->pdo->query("SELECT name FROM sqlite_master WHERE type='table' AND name='skills_tags'");
			return $stmt->fetch() !== false;
		} catch (Exception $e) {
			return false;
		}
	}

	public function setupSkillsTagsTable()
	{
		try {
			// Create skills_tags relationship table
			$this->pdo->exec('CREATE TABLE IF NOT EXISTS skills_tags (
				skill_id INTEGER NOT NULL,
				tag_id INTEGER NOT NULL,
				PRIMARY KEY(skill_id, tag_id),
				FOREIGN KEY(skill_id) REFERENCES skills(id)
				ON DELETE CASCADE,
				FOREIGN KEY(tag_id) REFERENCES tags(id)
				ON DELETE CASCADE
			)');
			return true;
		} catch (Exception $e) {
			return false;
		}
	}

	/**
	 * Check if app_settings table exists
	 *
	 * @return bool
	 */
	public function checkAppSettingsTableExists()
	{
		try {
			$stmt = $this->pdo->query("SELECT name FROM sqlite_master WHERE type='table' AND name='app_settings'");
			return $stmt->fetch() !== false;
		} catch (Exception $e) {
			return false;
		}
	}

	/**
	 * 创建 app_settings 表（PRD O-5）
	 *
	 * key/value 结构，存放「设置 → 网络」的 GitHub 访问配置；
	 * 环境变量只作为初始默认值，UI 保存后以本表为准。
	 * CREATE TABLE IF NOT EXISTS 让 migrate() 可以重复执行而不报错。
	 */
	public function setupAppSettingsTable()
	{
		try {
			$this->pdo->exec('CREATE TABLE IF NOT EXISTS app_settings (
				key TEXT NOT NULL PRIMARY KEY,
				value TEXT NOT NULL,
				updated_at TEXT DEFAULT(NULL)
			)');
			return true;
		} catch (Exception $e) {
			return false;
		}
	}

	/**
	 * 读取全部设置为 key => value
	 *
	 * 表不存在（未迁移的老库）时抛 PDOException，由调用方决定回落策略；
	 * Config 读取端会捕获并回落到环境变量默认值。
	 */
	public function getAppSettings(): array
	{
		$stmt = $this->pdo->query('SELECT key, value FROM app_settings');

		$settings = [];
		foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) ?: [] as $row) {
			$settings[(string)$row['key']] = (string)$row['value'];
		}

		return $settings;
	}

	public function getAppSetting(string $key): ?string
	{
		$stmt = $this->pdo->prepare('SELECT value FROM app_settings WHERE key = :key');
		$stmt->execute([':key' => $key]);
		$value = $stmt->fetchColumn();

		return $value === false ? null : (string)$value;
	}

	/**
	 * 写入单条设置（upsert）
	 *
	 * app_settings 没有被其他表引用，INSERT OR REPLACE 的删除重建语义在这里是安全的。
	 */
	public function setAppSetting(string $key, string $value): bool
	{
		$stmt = $this->pdo->prepare('INSERT OR REPLACE INTO app_settings (key, value, updated_at)
			VALUES (:key, :value, :updated_at)');

		return $stmt->execute([
			':key' => $key,
			':value' => $value,
			':updated_at' => date('Y-m-d H:i:s'),
		]);
	}

	/**
	 * 检查 vault_meta 表是否存在（老库升级用）
	 */
	public function checkVaultMetaTableExists()
	{
		try {
			$stmt = $this->pdo->query("SELECT name FROM sqlite_master WHERE type='table' AND name='vault_meta'");
			return $stmt->fetch() !== false;
		} catch (Exception $e) {
			return false;
		}
	}

	/**
	 * 创建 vault_meta 表（PRD §6.1）
	 *
	 * 单行表：id 固定为 1，用 CHECK 在库层面兜住，避免出现多行元信息导致解锁时读错记录。
	 * 密文字段用 BLOB 存原始二进制；服务端只负责搬运，不做任何加解密。
	 * CREATE TABLE IF NOT EXISTS 让 migrate() 可以重复执行而不报错。
	 */
	public function setupVaultMetaTable()
	{
		try {
			$this->pdo->exec('CREATE TABLE IF NOT EXISTS vault_meta (
				id INTEGER NOT NULL PRIMARY KEY CHECK (id = 1),
				version INTEGER NOT NULL DEFAULT(1),
				kdf TEXT NOT NULL,
				kdf_salt BLOB NOT NULL,
				kdf_memory INTEGER NOT NULL DEFAULT(0),
				kdf_iterations INTEGER NOT NULL DEFAULT(0),
				kdf_parallelism INTEGER NOT NULL DEFAULT(0),
				wrapped_dek BLOB NOT NULL,
				wrap_nonce BLOB NOT NULL,
				created_at TEXT DEFAULT(NULL),
				updated_at TEXT DEFAULT(NULL)
			)');
			return true;
		} catch (Exception $e) {
			return false;
		}
	}

	/**
	 * tags.module 列是否存在（老库判断用）
	 *
	 * 与 checkItemsImageColumnExists() 同一套路：直接查列，查不出来即视为无此列。
	 */
	public function checkTagsModuleColumnExists(): bool
	{
		try {
			$stmt = $this->pdo->query('SELECT module FROM tags LIMIT 1');
			return true;
		} catch (Exception $e) {
			return false;
		}
	}

	/**
	 * 补 tags.module 列（PRD O-9 方案 A）
	 *
	 * SQLite 的 ALTER TABLE ADD COLUMN 允许 NOT NULL，但必须给非空默认值，
	 * 已有历史行会全部落到 'bookmarks'——这正是迁移要求：书签侧标签保持原样，
	 * 只有被 Skill 引用的标签才另复制 skills 副本（见 migrateSkillsTagsOwnership）。
	 */
	public function addTagsModuleColumn(): bool
	{
		try {
			$this->pdo->exec("ALTER TABLE tags ADD COLUMN module TEXT NOT NULL DEFAULT('bookmarks')");
			return true;
		} catch (Exception $e) {
			return false;
		}
	}

	/**
	 * 删除旧唯一索引 idx_tags_title_parent（O-9 迁移）
	 *
	 * 必须在数据迁移之前删：skills 副本与原书签标签同名同父，旧索引
	 * (title, parent) 不区分模块，会直接拦截副本的 INSERT。
	 */
	public function dropLegacyTagIndex(): bool
	{
		try {
			$this->pdo->exec('DROP INDEX IF EXISTS "idx_tags_title_parent"');
			return true;
		} catch (Exception $e) {
			return false;
		}
	}

	/**
	 * 标签模块隔离迁移总编排（PRD O-9 方案 A，每一步幂等、可重复执行）：
	 *   1. 补 module 列，历史标签默认 bookmarks；
	 *   2. 删旧唯一索引 (title, parent)——先于数据迁移，否则副本插入会被拦截；
	 *   3. 数据迁移：被 Skill 引用的标签复制为 skills 副本，skills_tags 改指副本；
	 *   4. 建新唯一索引 (module, title, parent)。
	 */
	public function migrateTagsModule(): bool
	{
		try {
			if (!$this->checkTagsModuleColumnExists() && !$this->addTagsModuleColumn()) {
				return false;
			}

			if (!$this->dropLegacyTagIndex()) {
				return false;
			}

			if (!$this->migrateSkillsTagsOwnership()) {
				return false;
			}

			return $this->createTagModuleIndex();
		} catch (Exception $e) {
			return false;
		}
	}

	/**
	 * 数据迁移：被 Skill 引用的标签复制为 skills 模块副本，skills_tags 改指副本（PRD O-9）
	 *
	 * 为什么复制而不是把原行 module 改成 skills：原标签同时被书签物品引用
	 * （items_tags），改原行等于把书签侧标签一起搬走，书签侧栏直接丢标签。
	 * 复制后书签侧原样不动，Skill 侧拿到结构等价的副本，两边行为都不变。
	 *
	 * parent 是树结构（指向另一个标签 id，0 为根）：只复制被引用的行时，副本的
	 * parent 仍指向 bookmarks 模块的原标签，Skill 侧栏的父子层级会断，将来书签侧
	 * 删除 / 改名该父标签还会形成悬空引用。所以父级链一起复制，副本的 parent
	 * 重指向父级副本，整棵子树在 skills 模块内自洽。
	 *
	 * 幂等：按 (module='skills', title, 重指向后的 parent) 查找复用，重复执行时
	 * skills_tags 已指向副本、查找命中副本自身，不会重复复制；整体包在事务里，
	 * 中途失败整体回滚，不会留下「一半关联已改写」的中间态。
	 */
	public function migrateSkillsTagsOwnership(): bool
	{
		$this->pdo->beginTransaction();
		try {
			$stmt = $this->pdo->query('SELECT DISTINCT tag_id FROM skills_tags');
			$referenced_tag_ids = array_map('intval', $stmt->fetchAll(PDO::FETCH_COLUMN));

			if (!empty($referenced_tag_ids)) {
				/** @var array<int, int> 原标签 id → skills 侧 id */
				$id_map = [];
				$resolving = [];
				foreach ($referenced_tag_ids as $tag_id) {
					$this->resolveSkillsTagId($tag_id, $id_map, $resolving);
				}

				$update = $this->pdo->prepare('UPDATE skills_tags SET tag_id = :new_tag_id WHERE tag_id = :old_tag_id');
				foreach ($id_map as $old_id => $new_id) {
					// 恒等映射（重复执行迁移时的常态）：无需改写
					if ($old_id === $new_id) {
						continue;
					}
					$update->execute([':new_tag_id' => $new_id, ':old_tag_id' => $old_id]);
				}
			}

			$this->pdo->commit();
			return true;
		} catch (Exception $e) {
			if ($this->pdo->inTransaction()) {
				$this->pdo->rollBack();
			}
			return false;
		}
	}

	/**
	 * 确保某个标签在 skills 模块有对应行，返回 skills 侧标签 id（O-9 迁移）
	 *
	 * $id_map 记录「原标签 id → skills 侧 id」，父级链递归与多个 Skill 共用，
	 * 保证同一原标签只复制一份；$resolving 记录递归路径上的节点，用于打断
	 * parent 环（历史脏数据），环上节点按根级处理，避免无限递归。
	 */
	private function resolveSkillsTagId(int $tag_id, array &$id_map, array &$resolving): int
	{
		if (isset($id_map[$tag_id])) {
			return $id_map[$tag_id];
		}

		$stmt = $this->pdo->prepare('SELECT title, description, color, parent, pinned, created_at, updated_at FROM tags WHERE id = :id');
		$stmt->execute([':id' => $tag_id]);
		$tag = $stmt->fetch(PDO::FETCH_ASSOC);

		if (!$tag) {
			// skills_tags 引用了不存在的标签（历史脏数据）：无行可复制，保持原引用
			return $tag_id;
		}

		if (isset($resolving[$tag_id])) {
			// parent 成环：按根级处理，打断递归
			$id_map[$tag_id] = 0;
			return 0;
		}
		$resolving[$tag_id] = true;

		$parent_id = (int)$tag['parent'];
		$skills_parent = 0;
		if ($parent_id > 0) {
			// 父级链一起复制，副本的 parent 重指向父级副本，保住 Skill 侧栏的树形层级
			$skills_parent = $this->resolveSkillsTagId($parent_id, $id_map, $resolving);
		}

		// 查找语义与唯一索引 (module, title, parent) 严格一致：title 大小写不敏感，
		// 命中则复用（幂等的关键），未命中才复制
		$stmt = $this->pdo->prepare(
			"SELECT id FROM tags
			WHERE module = 'skills' AND title = :title COLLATE NOCASE AND parent = :parent"
		);
		$stmt->execute([':title' => $tag['title'], ':parent' => $skills_parent]);
		$existing_id = $stmt->fetchColumn();

		if (false !== $existing_id) {
			$id_map[$tag_id] = (int)$existing_id;
			unset($resolving[$tag_id]);
			return (int)$existing_id;
		}

		// 复制：模块属性与展示属性原样搬运，时间戳保留历史值（迁移不伪造数据），
		// parent 指向父级副本；新 id 由自增分配，不会与任何原标签 id 冲突
		$insert = $this->pdo->prepare(
			"INSERT INTO tags (title, description, color, parent, pinned, module, created_at, updated_at)
			VALUES (:title, :description, :color, :parent, :pinned, 'skills', :created_at, :updated_at)"
		);
		$insert->execute([
			':title' => $tag['title'],
			':description' => $tag['description'],
			':color' => $tag['color'],
			':parent' => $skills_parent,
			':pinned' => (int)$tag['pinned'],
			':created_at' => $tag['created_at'],
			':updated_at' => $tag['updated_at'],
		]);
		$new_id = (int)$this->pdo->lastInsertId();
		$id_map[$tag_id] = $new_id;
		unset($resolving[$tag_id]);

		return $new_id;
	}

	/**
	 * 检查 account_groups 表是否存在（老库升级用）
	 */
	public function checkAccountGroupsTableExists()
	{
		try {
			$stmt = $this->pdo->query("SELECT name FROM sqlite_master WHERE type='table' AND name='account_groups'");
			return $stmt->fetch() !== false;
		} catch (Exception $e) {
			return false;
		}
	}

	/**
	 * 创建 account_groups 表并写入默认分组（PRD §6.3）
	 *
	 * name 加 UNIQUE：既是业务约束（分组名不重复），也是种子数据幂等的前提
	 * ——INSERT OR IGNORE 依赖唯一冲突来跳过已存在的分组。
	 */
	public function setupAccountGroupsTable()
	{
		try {
			$this->pdo->exec('CREATE TABLE IF NOT EXISTS account_groups (
				id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
				name TEXT NOT NULL UNIQUE,
				sort INTEGER NOT NULL DEFAULT(0)
			)');
			return $this->seedAccountGroups();
		} catch (Exception $e) {
			return false;
		}
	}

	/**
	 * 写入默认分组：个人 / 工作 / 客户 / 归档
	 *
	 * 幂等：name 有 UNIQUE 约束，配合 INSERT OR IGNORE，无论 setupDatabase() 与
	 * migrate() 重复执行多少次都不会产生重复行，也不会覆盖已存在分组的 sort
	 * （用户后续调整过排序时不会被重置）。
	 */
	public function seedAccountGroups(): bool
	{
		try {
			$stmt = $this->pdo->prepare('INSERT OR IGNORE INTO account_groups (name, sort) VALUES (:name, :sort)');
			$defaults = ['个人' => 1, '工作' => 2, '客户' => 3, '归档' => 4];
			foreach ($defaults as $name => $sort) {
				$stmt->execute([':name' => $name, ':sort' => $sort]);
			}
			return true;
		} catch (Exception $e) {
			return false;
		}
	}

	/**
	 * 检查 accounts 表是否存在（老库升级用）
	 */
	public function checkAccountsTableExists()
	{
		try {
			$stmt = $this->pdo->query("SELECT name FROM sqlite_master WHERE type='table' AND name='accounts'");
			return $stmt->fetch() !== false;
		} catch (Exception $e) {
			return false;
		}
	}

	/**
	 * 创建 accounts 表（PRD §6.2）
	 *
	 * 密文字段全部可空：密码允许为空（第三方登录场景，PRD §10.2），
	 * 2FA / 备注同理，用 NULL 表示「没有该字段」，与「空字符串密文」区分开。
	 * 密文只存客户端生成的二进制，服务端不持有密钥。
	 */
	public function setupAccountsTable()
	{
		try {
			$this->pdo->exec('CREATE TABLE IF NOT EXISTS accounts (
				id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
				name TEXT NOT NULL,
				platform TEXT NOT NULL,
				identifier TEXT NOT NULL,
				group_id INTEGER DEFAULT(NULL),
				login_url TEXT NOT NULL DEFAULT \'\',
				login_via_account_id INTEGER DEFAULT(NULL),
				favorite INTEGER NOT NULL DEFAULT(0) CHECK (favorite IN (0, 1)),
				password_ct BLOB DEFAULT(NULL),
				password_iv BLOB DEFAULT(NULL),
				totp_ct BLOB DEFAULT(NULL),
				totp_iv BLOB DEFAULT(NULL),
				notes_ct BLOB DEFAULT(NULL),
				notes_iv BLOB DEFAULT(NULL),
				password_updated_at TEXT DEFAULT(NULL),
				last_used_at TEXT DEFAULT(NULL),
				created_at TEXT DEFAULT(NULL),
				updated_at TEXT DEFAULT(NULL),
				FOREIGN KEY(group_id) REFERENCES account_groups(id) ON DELETE SET NULL,
				FOREIGN KEY(login_via_account_id) REFERENCES accounts(id) ON DELETE SET NULL
			)');
			return true;
		} catch (Exception $e) {
			return false;
		}
	}

	/**
	 * 检查 account_authorizations 表是否存在（老库升级用）
	 */
	public function checkAccountAuthorizationsTableExists()
	{
		try {
			$stmt = $this->pdo->query("SELECT name FROM sqlite_master WHERE type='table' AND name='account_authorizations'");
			return $stmt->fetch() !== false;
		} catch (Exception $e) {
			return false;
		}
	}

	/**
	 * 创建 account_authorizations 表（PRD §6.4）
	 *
	 * status 用 CHECK 兜住取值，避免脏数据导致前端状态渲染异常；
	 * account_id / linked_account_id 都只能指向账号库内部账号（PRD §5.1.1），
	 * 不引用 items / tags。删除账号时的级联由 deleteAccounts() 在应用层显式完成
	 * （本项目连接未开启 PRAGMA foreign_keys，声明级联只作为语义说明与将来开启时的保障）。
	 */
	public function setupAccountAuthorizationsTable()
	{
		try {
			$this->pdo->exec('CREATE TABLE IF NOT EXISTS account_authorizations (
				id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
				account_id INTEGER NOT NULL,
				service TEXT NOT NULL,
				identifier TEXT NOT NULL DEFAULT \'\',
				note TEXT NOT NULL DEFAULT \'\',
				linked_account_id INTEGER DEFAULT(NULL),
				status TEXT NOT NULL DEFAULT \'active\' CHECK (status IN (\'active\', \'revoked\')),
				granted_at TEXT DEFAULT(NULL),
				created_at TEXT DEFAULT(NULL),
				updated_at TEXT DEFAULT(NULL),
				FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE,
				FOREIGN KEY(linked_account_id) REFERENCES accounts(id) ON DELETE SET NULL
			)');
			return true;
		} catch (Exception $e) {
			return false;
		}
	}

	/**
	 * 索引是否存在
	 */
	private function indexExists(string $name): bool
	{
		$stmt = $this->pdo->prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = :name");
		$stmt->execute([':name' => $name]);
		return (bool)$stmt->fetchColumn();
	}

	/**
	 * 补齐账号库索引（幂等）
	 *
	 * 逐个检查后再建，避免每次请求都执行 DDL；
	 * 老库升级时同样会走到这里，所以新增索引只需加进 ACCOUNT_INDEXES 常量。
	 */
	public function createAccountIndexes(): bool
	{
		try {
			foreach (self::ACCOUNT_INDEXES as $name => $sql) {
				if (!$this->indexExists($name)) {
					$this->pdo->exec($sql);
				}
			}
			return true;
		} catch (Exception $e) {
			return false;
		}
	}

	/**
	 * 创建标签模块隔离唯一索引 (module, title, parent)（PRD O-9）
	 *
	 * 替代旧索引 idx_tags_title_parent（仅 title, parent）：模块隔离后同一标题
	 * 在 bookmarks 与 skills 各可存在一份，唯一性按模块内生效。
	 * title 沿用历史语义 COLLATE NOCASE（同名标签大小写不敏感），parent 是整数 id
	 * 用 BINARY 精确比较。IF NOT EXISTS 让 setupDatabase() 与 migrate() 都能
	 * 重复执行；老库的旧索引由 dropLegacyTagIndex() 负责删除。
	 */
	public function createTagModuleIndex()
	{
		try {
			$this->pdo->exec('CREATE UNIQUE INDEX IF NOT EXISTS "idx_tags_module_title_parent" ON tags(module COLLATE BINARY ASC, title COLLATE NOCASE ASC, parent COLLATE BINARY ASC);');
			return true;
		} catch (Exception $e) {
			return false;
		}
	}

	/**
	 * 检查 servers 表是否存在（老库升级用）
	 */
	public function checkServersTableExists()
	{
		try {
			$stmt = $this->pdo->query("SELECT name FROM sqlite_master WHERE type='table' AND name='servers'");
			return $stmt->fetch() !== false;
		} catch (Exception $e) {
			return false;
		}
	}

	/**
	 * 创建 servers 表（PRD §6）
	 *
	 * group_name 存分组名文本（家庭 / 公网 / 公司 / 归档，PRD D10）：分组是固定
	 * 四项的字典，与账号库的 account_groups（个人 / 工作 / 客户 / 归档）是两套
	 * 不同取值，不共用表；列名叫 group_name 而非 group，避开 SQL 关键字在部分
	 * 语句里的歧义。token_hash / token_salt 存 SHA-256(token + salt)，Token
	 * 明文绝不入库、不写日志（PRD §5.6 / D6 选项 b）。
	 * 系统信息冗余列（PRD §6 允许）：agent 首次回传或变化时由
	 * updateServerSystemInfo() 更新，默认空值 / 0 表示「还没上报过」。
	 */
	public function setupServersTable()
	{
		try {
			$this->pdo->exec('CREATE TABLE IF NOT EXISTS servers (
				id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
				name TEXT NOT NULL,
				note TEXT NOT NULL DEFAULT \'\',
				group_name TEXT NOT NULL DEFAULT \'家庭\',
				token_hash TEXT NOT NULL,
				token_salt TEXT NOT NULL,
				paused INTEGER NOT NULL DEFAULT(0) CHECK (paused IN (0, 1)),
				os_name TEXT NOT NULL DEFAULT \'\',
				kernel TEXT NOT NULL DEFAULT \'\',
				cpu_cores INTEGER NOT NULL DEFAULT(0),
				ip_address TEXT NOT NULL DEFAULT \'\',
				agent_version TEXT NOT NULL DEFAULT \'\',
				last_report_at TEXT DEFAULT(NULL),
				created_at TEXT DEFAULT(NULL),
				updated_at TEXT DEFAULT(NULL)
			)');
			return true;
		} catch (Exception $e) {
			return false;
		}
	}

	/**
	 * 检查 server_metrics 表是否存在（老库升级用）
	 */
	public function checkServerMetricsTableExists()
	{
		try {
			$stmt = $this->pdo->query("SELECT name FROM sqlite_master WHERE type='table' AND name='server_metrics'");
			return $stmt->fetch() !== false;
		} catch (Exception $e) {
			return false;
		}
	}

	/**
	 * 创建 server_metrics 表（PRD §6：CPU / 内存 / Swap / 负载 / 网络 / 开机时长）
	 *
	 * 网络列存 agent 侧算好的速率 bytes/s（PRD §5.3），Hub 不做换算；
	 * cpu / load 用 REAL（百分比与负载带小数），字节数与秒数用 INTEGER。
	 * 明细保留 30 天，由 cleanupServerRetention() 清理（决策 D4）。
	 * 声明外键级联仅作语义说明：本项目连接未开启 PRAGMA foreign_keys，
	 * 实际删除由 deleteServer() 在应用层显式完成。
	 */
	public function setupServerMetricsTable()
	{
		try {
			$this->pdo->exec('CREATE TABLE IF NOT EXISTS server_metrics (
				id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
				server_id INTEGER NOT NULL,
				received_at TEXT NOT NULL,
				cpu REAL NOT NULL DEFAULT(0),
				mem_used INTEGER NOT NULL DEFAULT(0),
				mem_total INTEGER NOT NULL DEFAULT(0),
				mem_cached INTEGER NOT NULL DEFAULT(0),
				swap_used INTEGER NOT NULL DEFAULT(0),
				swap_total INTEGER NOT NULL DEFAULT(0),
				load1 REAL NOT NULL DEFAULT(0),
				load5 REAL NOT NULL DEFAULT(0),
				load15 REAL NOT NULL DEFAULT(0),
				net_rx INTEGER NOT NULL DEFAULT(0),
				net_tx INTEGER NOT NULL DEFAULT(0),
				uptime INTEGER NOT NULL DEFAULT(0),
				FOREIGN KEY(server_id) REFERENCES servers(id) ON DELETE CASCADE
			)');
			return true;
		} catch (Exception $e) {
			return false;
		}
	}

	/**
	 * 检查 server_disks 表是否存在（老库升级用）
	 */
	public function checkServerDisksTableExists()
	{
		try {
			$stmt = $this->pdo->query("SELECT name FROM sqlite_master WHERE type='table' AND name='server_disks'");
			return $stmt->fetch() !== false;
		} catch (Exception $e) {
			return false;
		}
	}

	/**
	 * 创建 server_disks 表（PRD §6：每个挂载点一行，used / total 为字节数）
	 *
	 * 一次快照写入多行（每挂载点一行），整批共用同一个 received_at，
	 * 「查最新一批」才能完整还原当次快照。明细保留 30 天，清理口径同
	 * server_metrics（决策 D4）。
	 */
	public function setupServerDisksTable()
	{
		try {
			$this->pdo->exec('CREATE TABLE IF NOT EXISTS server_disks (
				id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
				server_id INTEGER NOT NULL,
				received_at TEXT NOT NULL,
				mount TEXT NOT NULL,
				used INTEGER NOT NULL DEFAULT(0),
				total INTEGER NOT NULL DEFAULT(0),
				FOREIGN KEY(server_id) REFERENCES servers(id) ON DELETE CASCADE
			)');
			return true;
		} catch (Exception $e) {
			return false;
		}
	}

	/**
	 * 检查 server_docker 表是否存在（老库升级用）
	 */
	public function checkServerDockerTableExists()
	{
		try {
			$stmt = $this->pdo->query("SELECT name FROM sqlite_master WHERE type='table' AND name='server_docker'");
			return $stmt->fetch() !== false;
		} catch (Exception $e) {
			return false;
		}
	}

	/**
	 * 创建 server_docker 表（PRD §6：每个容器一行）
	 *
	 * CPU 为百分比（不乘核数）、内存为 usage − inactive_file 口径、网络为
	 * agent 侧算好的速率 bytes/s（口径见 PRD §5.3）。行数 = 天数 × 288 ×
	 * 容器数，是五张表里涨得最快的，30 天清理必须覆盖本表（PRD §5.4）。
	 */
	public function setupServerDockerTable()
	{
		try {
			$this->pdo->exec('CREATE TABLE IF NOT EXISTS server_docker (
				id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
				server_id INTEGER NOT NULL,
				received_at TEXT NOT NULL,
				container TEXT NOT NULL,
				cpu REAL NOT NULL DEFAULT(0),
				mem_used INTEGER NOT NULL DEFAULT(0),
				mem_limit INTEGER NOT NULL DEFAULT(0),
				net_rx INTEGER NOT NULL DEFAULT(0),
				net_tx INTEGER NOT NULL DEFAULT(0),
				state TEXT NOT NULL DEFAULT \'\',
				FOREIGN KEY(server_id) REFERENCES servers(id) ON DELETE CASCADE
			)');
			return true;
		} catch (Exception $e) {
			return false;
		}
	}

	/**
	 * 检查 server_connections 表是否存在（老库升级用）
	 */
	public function checkServerConnectionsTableExists()
	{
		try {
			$stmt = $this->pdo->query("SELECT name FROM sqlite_master WHERE type='table' AND name='server_connections'");
			return $stmt->fetch() !== false;
		} catch (Exception $e) {
			return false;
		}
	}

	/**
	 * 创建 server_connections 表（长连接注册表，PRD §5.2 / D11）
	 *
	 * 每 Token 单活跃连接的 SQLite 过期行方案：新连接注册时挤占同 server_id
	 * 的旧行，旧连接自检发现被顶替即退出。connection_id 是 Hub 生成的随机
	 * 连接标识，不存 Agent Token 明文（Token 是高价值凭据，任何表都不落明文）；
	 * expires_at 为定长 'Y-m-d H:i:s' 文本，字典序即时间序，可直接比较，
	 * 过期行由 cleanupServerConnections() 清理。
	 */
	public function setupServerConnectionsTable()
	{
		try {
			$this->pdo->exec('CREATE TABLE IF NOT EXISTS server_connections (
				id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
				server_id INTEGER NOT NULL,
				connection_id TEXT NOT NULL,
				registered_at TEXT DEFAULT(NULL),
				expires_at TEXT DEFAULT(NULL),
				FOREIGN KEY(server_id) REFERENCES servers(id) ON DELETE CASCADE
			)');
			return true;
		} catch (Exception $e) {
			return false;
		}
	}

	/**
	 * 补齐服务器监控索引（幂等）
	 *
	 * 逐个检查后再建，避免每次请求都执行 DDL；模式同 createAccountIndexes()，
	 * 老库升级时间样会走到这里。明细表统一建 (server_id, received_at) 复合索引：
	 * 所有查询都带 server_id 等值条件，received_at 同时服务范围过滤与
	 * MAX(received_at) 批次取回。server_connections 的 server_id 是 UNIQUE
	 * 索引：从存储层保证每 Token 单活跃连接，与方法层先删旧行形成双保险。
	 */
	public function createServerIndexes(): bool
	{
		try {
			foreach (self::SERVER_INDEXES as $name => $sql) {
				if (!$this->indexExists($name)) {
					$this->pdo->exec($sql);
				}
			}
			return true;
		} catch (Exception $e) {
			return false;
		}
	}
}
