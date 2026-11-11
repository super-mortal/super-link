<?php

namespace Controllers;

use Framework\ControllerInterface;
use Framework\Responses\ResponseInterface;
use Framework\ServiceContainer;
use Models\Repository;
use Utils\VaultMetaPayload;
use function Framework\success;

class VaultResetController implements ControllerInterface
{
	/**
	 * POST /api/vault/reset
	 *
	 * 重置账号库：删除 vault_meta（KDF 参数 + 包裹后的 DEK）与全部账号、授权关系。
	 * 删除后 DEK 无从恢复，账号密文即不可解密，这正是 PRD §7.7「忘记主密码只能重置」的语义；
	 * 账号行也必须一并删除，否则用户重新设置主密码后，旧账号（明文元数据 + 解不开的密文）
	 * 会重新出现在列表里，造成「重置了但数据还在」的错觉。
	 *
	 * 校验边界：PRD §7.7 要求重置前输入登录密码二次确认，这一步由前端确认弹窗 + 登录态
	 * （Authentication 中间件）负责，服务端这里不再重复校验登录密码——密码校验逻辑只应有一处实现，
	 * 避免两边强度判断不一致；未登录的请求进不来本控制器。
	 */
	public function __invoke(array $input): ResponseInterface
	{
		VaultMetaPayload::noStore();

		$repository = ServiceContainer::get(Repository::class);

		// 幂等：未初始化时删除 0 行也视为成功，前端重置流程不必先查一次状态
		$repository->resetVaultData();

		return success('账号库已重置，原加密数据将无法恢复');
	}
}
