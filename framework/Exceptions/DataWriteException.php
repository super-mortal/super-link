<?php

namespace Framework\Exceptions;

use RuntimeException;

class DataWriteException extends RuntimeException
{
	protected $code = 500;
}
