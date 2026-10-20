<?php

namespace Models;

class Item
{
	public function __construct(
		public string     $url,
		public string     $title,
		public string     $description,
		public string     $notes,
		public array      $tag_ids,
		public ?\DateTime $created_at = null,
		public ?\DateTime $updated_at = null,
		public ?int       $id = null,
	)
	{
	}

	public function setID(int $id)
	{
		$this->id = $id;
	}
}