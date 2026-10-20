<?php

namespace Framework\Exceptions;

use RuntimeException;

class DatabaseNotFound extends RuntimeException
{
	protected $message = 'Database not found. Please set up the database first.';
	protected $code = 424;
}
