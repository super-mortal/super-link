<?php

namespace Utils;

use Exception;
use Framework\Exceptions\ValidationException;
use Framework\ServiceContainer;
use GuzzleHttp\Client;
use GuzzleHttp\Pool;
use GuzzleHttp\Psr7\Response;
use Models\Item;
use Models\ItemCreator;
use Models\Repository;
use Models\TagCreator;
use Psr\Http\Client\ClientExceptionInterface;

function groupTagsByParent($tags)
{
	$tags_by_parent = [];
	foreach ($tags as $tag_id => $tag) {
		$tags_by_parent[$tag['parent']][] = $tag_id;
	}
	return $tags_by_parent;
}


function getTagColors()
{
	return [
		'gray',
		'green',
		'red',
		'yellow',
		'aqua',
		'white ',
		'black',
	];
}

function extractTagSegments(string $title): array
{
	// Explode by forward slash, preserving escaped slashes
	$title = str_replace('\/', '__SLASH__', $title);
	$segments = explode('/', $title);
	$segments = array_map(fn($segment) => str_replace('__SLASH__', '/', $segment), $segments);
	// Remove empty segments
	$segments = array_map('trim', $segments);
	$segments = array_filter($segments, fn($segment) => '' !== $segment);
	return $segments;
}

function createTagsFromSegments(array $tag_segments, $tag_description = ''): int
{
	$repository = ServiceContainer::get(Repository::class);
	$tags = $repository->getTags();
	$tag_creator = ServiceContainer::get(TagCreator::class);

	$parent_tag_id = 0;
	$check_existing_parent = true;
	foreach ($tag_segments as $tag_title) {
		$existing_parent = array_find($tags, function ($tag) use ($tag_title, $parent_tag_id) {
			return strtolower($tag['title']) === strtolower($tag_title) && $tag['parent'] === $parent_tag_id;
		});

		if ($check_existing_parent && $existing_parent) {
			$parent_tag_id = $existing_parent['id'];
			continue;
		}

		$parent_tag_id = $tag_creator->createTag($tag_title, $tag_description, $parent_tag_id);
		$check_existing_parent = false;
	}

	return (int)$parent_tag_id;
}

function processInputTags($input_tags): array
{
	$repository = ServiceContainer::get(Repository::class);// Handle tags

	$new_tag_paths = array_filter($input_tags, fn($tag) => is_string($tag) && str_starts_with($tag, 'create:'));
	$input_existing_tag_ids = array_map('intval', array_diff($input_tags, $new_tag_paths));

	$tags = $repository->getTags();
	$exising_tag_ids = array_keys($tags);
	if (array_diff($input_existing_tag_ids, $exising_tag_ids)) {
		throw new ValidationException('Non-existing tags provided');
	}

	$input_created_tag_ids = array_map(function ($tag) {
		$tag_path = substr($tag, strlen('create:'));
		$tag_segments = extractTagSegments($tag_path);
		$tag_id = createTagsFromSegments($tag_segments);
		return $tag_id;
	}, $new_tag_paths);
	return [
		...$input_existing_tag_ids,
		...$input_created_tag_ids,
	];
}

/*
 * Resolve relative URL to absolute URL
 */
function resolveUrl(string $relative_url, string $base_url): string
{
	// If it's already an absolute URL, return as is
	if (filter_var($relative_url, FILTER_VALIDATE_URL)) {
		return $relative_url;
	}

	// Parse base URL
	$baseParts = parse_url($base_url);
	$scheme = $baseParts['scheme'] ?? 'https';
	$host = $baseParts['host'] ?? '';

	// Handle protocol-relative URLs
	if (str_starts_with($relative_url, '//')) {
		return $scheme . ':' . $relative_url;
	}

	// Handle absolute paths
	if (str_starts_with($relative_url, '/')) {
		return $scheme . '://' . $host . $relative_url;
	}

	// Handle relative paths
	$path = $baseParts['path'] ?? '/';
	$path = rtrim(dirname($path), '/');

	return $scheme . '://' . $host . $path . '/' . $relative_url;
}

function fetchPageHTML(string $url): string
{
	// Initialize cURL
	$ch = curl_init();
	curl_setopt($ch, CURLOPT_URL, $url);
	curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
	curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
	curl_setopt($ch, CURLOPT_MAXREDIRS, 5);
	curl_setopt($ch, CURLOPT_TIMEOUT, 30);
	curl_setopt($ch, CURLOPT_USERAGENT, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
	curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);

	$html = curl_exec($ch);

	if (curl_errno($ch)) {
		$error = curl_error($ch);
		curl_close($ch);
		throw new Exception("Failed to fetch URL: " . $error, 400);
	}

	$http_code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
	curl_close($ch);

	if ($http_code < 200 || $http_code >= 300) {
		throw new Exception("Page returned HTTP error: {$http_code}", 400);
	}

	if ($html === false) {
		throw new Exception("Failed to retrieve page content", 400);
	}

	return $html;
}


function createWelcomeContent()
{
	$tag_creator = ServiceContainer::get(TagCreator::class);
	$super_link_tag_id = $tag_creator->createTag('Super-Link', 'Super-Link 官方链接。', 0, 'gray', true);
	$welcome_tag_id = $tag_creator->createTag('欢迎', "欢迎使用 Super-Link！\n\nℹ️ 这是一个嵌套标签（位于 Super-Link 之下）。嵌套标签适合给项目分组，例如工作、学习、个人。\n\n💡 创建嵌套标签时，用斜杠分隔即可，例如：工作/项目A。", $super_link_tag_id, 'green', false);

	$item_creator = ServiceContainer::get(ItemCreator::class);
	$item_creator->createItems([
		new Item(
			'https://github.com/super-mortal/super-link',
			'GitHub 仓库',
			'Super-Link 的源码、Issues 与版本发布都在这里。',
			'官方仓库',
			[$super_link_tag_id],
		),
		new Item(
			'https://github.com/super-mortal/super-link#readme',
			'使用文档',
			'README 包含完整的部署、使用与配置说明。',
			'',
			[$super_link_tag_id]
		),
		new Item(
			'https://github.com/super-mortal/super-link/releases',
			'更新日志',
			'查看每个版本的新功能与修复。',
			'',
			[$super_link_tag_id]
		)
	]);
}

function buildPublicUserObject(array $user): array
{
	return [
		...array_intersect_key(
			$user,
			array_flip(['id', 'username', 'created_at', 'updated_at'])
		),
	];
}

function getInstalledAppInfo(): ?array
{
	$info_file_path = ROOT_DIR . '/app-info.json';
	$data = file_exists($info_file_path) ? file_get_contents($info_file_path) : '';
	$data = json_decode($data, true);
	return $data;
}

function getAppUpdateInfo(): ?array
{
	try {
		// Check cache first
		$cache_file_path = sys_get_temp_dir() . '/app-update-info-cache.json';
		$cache_period = 60 * 60 * 12; // 12 hours
		$data = file_exists($cache_file_path) ? file_get_contents($cache_file_path) : '';
		$data = json_decode($data, true);
		$is_cache_expired = ($data['cache_timestamp'] ?? 0) + $cache_period < time();
		if (!$is_cache_expired) {
			return $data;
		}

		// Fetch new data
		$data = fetchAppUpdateInfo();
		if (!$data) {
			return null;
		}

		// Store in cache
		$data['cache_timestamp'] = time();
		file_put_contents($cache_file_path, json_encode($data), LOCK_EX);

		return $data;
	} catch (Exception $e) {
		return null;
	}
}

function fetchAppUpdateInfo(): ?array
{
	try {
		$client = new Client();
		$url = 'https://api.github.com/repos/super-mortal/super-link/releases/latest';

		$app_info = getInstalledAppInfo();
		$installed_version = $app_info['version'] ?? 'unknown';

		$response = $client->get($url, [
			'headers' => [
				'Accept' => 'application/vnd.github+json',
				'User-Agent' => "super-link/{$installed_version} (VersionCheck)",
			],
			'timeout' => 15,
		]);

		if ($response->getStatusCode() !== 200) {
			return null;
		}

		$release = json_decode($response->getBody(), true);
		if (empty($release['tag_name'])) {
			return null;
		}

		return [
			'latest_version' => ltrim($release['tag_name'], 'vV'),
			'release_url' => $release['html_url'] ?? null,
		];
	} catch (Exception $e) {
		return null;
	}
}

function fetchMultiplePageHTML(array $urls): array
{
	$unique_urls = array_values(array_unique($urls));

	$client = new Client([
		'timeout' => 10,
		'connect_timeout' => 5,
	]);

	// Create requests generator
	$requests = function () use ($unique_urls, $client) {
		foreach ($unique_urls as $url) {
			yield function () use ($client, $url) {
				return $client->getAsync($url);
			};
		}
	};

	$pages = [];
	$failed_reasons = [];

	// Execute parallel requests
	$pool = new Pool($client, $requests(), [
		'concurrency' => 10,
		'fulfilled' => function (Response $response, $index) use (&$pages, &$failed_reasons, $unique_urls) {
			$url = $unique_urls[$index];

			$http_code = $response->getStatusCode();
			if ($http_code < 200 || $http_code >= 300) {
				$failed_reasons[$url] = "HTTP error code: $http_code";
				return;
			}

			$body = (string)$response->getBody();
			if ($body === '') {
				$failed_reasons[$url] = 'Page content is empty';
				return;
			}

			$pages[$url] = $body;
		},
		'rejected' => function (ClientExceptionInterface $reason, $index) use (&$failed_reasons, $unique_urls) {
			$url = $unique_urls[$index];
			$failed_reasons[$url] = $reason->getMessage();
		},
	]);

	// Wait for all requests to complete
	$promise = $pool->promise();
	$promise->wait();

	return [$pages, $failed_reasons];
}

