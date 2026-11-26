<?php

namespace Utils;

use Framework\Exceptions\ValidationException;

/**
 * 待办接口的入参校验与出参格式化（PRD docs/prd/todo.md §5.2 / §5.5 / §6.2）
 *
 * 为什么集中在一个类：新增 / 切换完成 / 删除三个写端点都要校验 id 与文本，
 * 出参还要统一成前端契约（id 为 int、done 为 bool、done_at 可为 null）。
 * 分散写在各控制器里很快会出现「新增校验了长度、更新忘了校验」这类不一致，
 * 与 ServerPayload / AccountPayload 同一模式。
 *
 * 错误口径：本模块属于普通用户态接口，统一抛 ValidationException(..., 400)
 * + 普通中文 message，不使用 Skill 体系才有的 [SL-XXX-NNNN] 错误码。
 */
class TodoPayload
{
	/** 待办文字长度上限（PRD §5.2：前端 maxlength 与服务端校验同值） */
	private const MAX_TEXT_LENGTH = 200;

	/**
	 * 解析待办文字：trim 后非空，且按字符数（不是字节数）不超过 200
	 *
	 * 用 mb_strlen 而非 strlen：中文三个字节，按字节算会把 67 个汉字判成超长，
	 * 与前端 maxlength 的字符口径不一致。
	 */
	public static function parseText($raw): string
	{
		if (null === $raw) {
			throw new ValidationException('待办内容不能为空', 400);
		}

		if (!is_string($raw)) {
			throw new ValidationException('待办内容格式不正确，必须为字符串', 400);
		}

		$text = trim($raw);

		if ('' === $text) {
			throw new ValidationException('待办内容不能为空', 400);
		}

		if (mb_strlen($text, 'UTF-8') > self::MAX_TEXT_LENGTH) {
			throw new ValidationException('待办内容不能超过 ' . self::MAX_TEXT_LENGTH . ' 个字符', 400);
		}

		return $text;
	}

	/**
	 * 解析待办 id（切换完成 / 删除共用）
	 *
	 * Router 无路径参数，id 一律走请求体或查询串。格式非法与不存在按同一口径
	 * 返回 400「待办不存在」（PRD §6.2），不额外暴露枚举 id 的信号。
	 */
	public static function parseId($raw): int
	{
		if (!is_int($raw) && !is_string($raw)) {
			throw new ValidationException('待办不存在', 400);
		}

		$raw = trim((string)$raw);

		if ('' === $raw || !ctype_digit($raw) || (int)$raw <= 0) {
			throw new ValidationException('待办不存在', 400);
		}

		return (int)$raw;
	}

	/**
	 * 解析完成状态：归一为 bool（Repository 内部再落 0 / 1）
	 *
	 * 同时接纳 JSON 布尔与 0 / 1（含查询串字符串形式）：PATCH 允许字段走
	 * body 或 query，框架合并 $_GET 后类型不固定，两种来源都要认。
	 * 缺失或非法值一律 400——完成状态是二值动作，不能靠隐含缺省值猜测。
	 */
	public static function parseDone($raw): bool
	{
		if (is_bool($raw)) {
			return $raw;
		}

		if (is_int($raw) && (0 === $raw || 1 === $raw)) {
			return 1 === $raw;
		}

		if (is_string($raw)) {
			$normalized = strtolower(trim($raw));
			if (in_array($normalized, ['1', 'true'], true)) {
				return true;
			}
			if (in_array($normalized, ['0', 'false'], true)) {
				return false;
			}
		}

		throw new ValidationException('done 参数格式不正确，应为布尔值或 0 / 1', 400);
	}

	/**
	 * 待办行 → API 输出结构
	 *
	 * 白名单输出，与前端类型契约（PRD §6.2）一一对应：id 转 int、done 转 bool，
	 * 三个时间列原样透传服务端字符串；done_at 未完成时为 null，必须保持 null
	 * （转空串会让前端按字符串比较时判断出错）。
	 */
	public static function formatTodo(array $row): array
	{
		return [
			'id' => (int)($row['id'] ?? 0),
			'text' => (string)($row['text'] ?? ''),
			'done' => (bool)($row['done'] ?? false),
			'created_at' => $row['created_at'] ?? null,
			'done_at' => $row['done_at'] ?? null,
			'updated_at' => $row['updated_at'] ?? null,
		];
	}
}
