<?php

namespace Controllers;

use Framework\ControllerInterface;
use Framework\Exceptions\DataWriteException;
use Framework\Exceptions\NotFoundException;
use Framework\Responses\ResponseInterface;
use Framework\ServiceContainer;
use Models\Repository;
use Utils\ServerPayload;
use function Framework\success;

class ServersDeleteController implements ControllerInterface
{
	/**
	 * POST /api/servers/delete
	 *
	 * 删除服务器及其全部历史数据（PRD §5.1 / §6：删除连同历史数据）。二次确认
	 * 由前端弹窗完成，后端不再纠缠。接口用 POST 而非 DELETE，与
	 * /api/items/delete、/api/accounts/delete 一致（DELETE 带请求体在部分代理上会被丢）。
	 *
	 * 级联范围（server_connections / server_metrics / server_disks /
	 * server_docker + servers 行本身）由 Repository::deleteServer() 在同一事务里
	 * 显式删除：本项目 SQLite 连接未开启 PRAGMA foreign_keys，不能依赖外键级联。
	 *
	 * server-id 走查询串或请求体均可（框架把 $_GET 合并进 $input），三种键名都认，
	 * 与 PATCH /api/servers 的传参方式一致。
	 */
	public function __invoke(array $input): ResponseInterface
	{
		$repository = ServiceContainer::get(Repository::class);

		$id = ServerPayload::parseId($input['server-id'] ?? $input['server_id'] ?? $input['id'] ?? null);

		// 先查存在性：deleteServer() 对不存在的 id 同样返回 true（幂等），不先查的话
		// 重复删除会静默成功，前端无法发现自己的列表已经过期（与 AccountsDeleteController 同一处理）
		if (!$repository->getServerById($id)) {
			throw new NotFoundException('服务器不存在');
		}

		if (!$repository->deleteServer($id)) {
			throw new DataWriteException('服务器删除失败，请稍后重试');
		}

		return success('服务器删除成功', [
			'deleted' => 1,
			'id' => $id,
		]);
	}
}
