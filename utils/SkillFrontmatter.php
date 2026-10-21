<?php

namespace Utils;

class SkillFrontmatter
{
	const MAX_FIELD_LENGTH = 200;
	const PARSED_FIELDS = ['name', 'description'];

	/**
	 * Parse the YAML frontmatter of a SKILL.md document.
	 *
	 * Only "name" and "description" are needed for the skill list, so a minimal
	 * hand written parser is used instead of pulling a YAML dependency.
	 *
	 * @return array{name?: string, description?: string} Empty array when the
	 *         frontmatter is missing or malformed (non blocking, SL-SKL-0004).
	 */
	public static function parse(string $content): array
	{
		$lines = explode("\n", self::normalize($content));

		if (trim($lines[0] ?? '') !== '---') {
			error_log('[SL-SKL-0004] SKILL.md frontmatter 缺失或未以 --- 开头');
			return [];
		}

		$frontmatter_lines = [];
		$closed = false;

		for ($index = 1, $count = count($lines); $index < $count; $index++) {
			$line = trim($lines[$index]);
			if ($line === '---' || $line === '...') {
				$closed = true;
				break;
			}
			$frontmatter_lines[] = $lines[$index];
		}

		if (!$closed) {
			error_log('[SL-SKL-0004] SKILL.md frontmatter 未闭合');
			return [];
		}

		return self::parseFields($frontmatter_lines);
	}

	private static function normalize(string $content): string
	{
		// Strip the UTF-8 BOM so the opening --- is recognised.
		if (str_starts_with($content, "\xEF\xBB\xBF")) {
			$content = substr($content, 3);
		}

		return str_replace(["\r\n", "\r"], "\n", $content);
	}

	private static function parseFields(array $lines): array
	{
		$fields = [];
		$count = count($lines);

		for ($index = 0; $index < $count; $index++) {
			$line = $lines[$index];

			if (trim($line) === '' || str_starts_with(ltrim($line), '#')) {
				continue;
			}

			if (preg_match('/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/', $line, $matches) !== 1) {
				continue;
			}

			$key = strtolower($matches[1]);
			if (!in_array($key, self::PARSED_FIELDS, true)) {
				continue;
			}

			$raw_value = trim($matches[2]);

			if (preg_match('/^[|>][+-]?$/', $raw_value) === 1) {
				// Block scalar (| or >): fold the indented lines into one line.
				$block_lines = [];
				while ($index + 1 < $count && self::isIndented($lines[$index + 1])) {
					$index++;
					$line_value = trim($lines[$index]);
					if ($line_value !== '') {
						$block_lines[] = $line_value;
					}
				}
				$raw_value = implode(' ', $block_lines);
			}

			$value = self::cleanValue($raw_value);
			if ($value === '') {
				continue;
			}

			$fields[$key] = $value;
		}

		return $fields;
	}

	private static function isIndented(string $line): bool
	{
		return trim($line) === '' || str_starts_with($line, ' ') || str_starts_with($line, "\t");
	}

	private static function cleanValue(string $value): string
	{
		$quote = $value[0] ?? '';

		if ($quote === '"' || $quote === "'") {
			$closing = strrpos($value, $quote);
			$value = $closing > 0 ? substr($value, 1, $closing - 1) : substr($value, 1);
			// Double quoted YAML scalars share the C escape syntax.
			$value = $quote === '"' ? stripcslashes($value) : str_replace("''", "'", $value);
		} else {
			// A trailing comment is only valid when preceded by whitespace.
			$value = preg_replace('/\s+#.*$/', '', $value) ?? $value;
		}

		$value = trim(preg_replace('/\s+/u', ' ', $value) ?? $value);

		return mb_substr($value, 0, self::MAX_FIELD_LENGTH);
	}
}
