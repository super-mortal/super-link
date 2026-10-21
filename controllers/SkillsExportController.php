<?php

namespace Controllers;

use Framework\ControllerInterface;
use Framework\Exceptions\NotFoundException;
use Framework\Exceptions\ValidationException;
use Framework\Responses\FileResponse;
use Framework\Responses\ResponseInterface;
use Framework\ServiceContainer;
use Models\Repository;
use Utils\SkillExporter;

class SkillsExportController implements ControllerInterface
{
	public function __invoke(array $input): ResponseInterface
	{
		$id = $this->parseId($input['id'] ?? null);

		$repository = ServiceContainer::get(Repository::class);
		$row = $repository->getSkill($id);

		if (!$row) {
			throw new NotFoundException('[SL-SKL-0002] Skill 不存在');
		}

		// 打包与失败的错误码都由 SkillExporter 负责，控制器只做入参校验与响应组装。
		$exporter = new SkillExporter($repository);
		$zip_path = $exporter->export($id);

		return new FileResponse($zip_path, (string)$row['name'] . '.zip');
	}

	private function parseId(mixed $raw): int
	{
		if ((!is_string($raw) && !is_int($raw)) || !ctype_digit((string)$raw) || (int)$raw <= 0) {
			throw new ValidationException('[SL-SKL-0007] 缺少或非法的 Skill id 参数');
		}

		return (int)$raw;
	}
}
