<?php
declare(strict_types=1);

namespace App\Core;

final class Validator
{
    private array $errors = [];

    public function __construct(private readonly array $data)
    {
    }

    public function string(string $field, int $min = 1, int $max = 255, bool $required = true, bool $trim = true): ?string
    {
        $value = $this->data[$field] ?? null;
        if ($value === null || $value === '') {
            if ($required) {
                $this->errors[$field] = 'This field is required.';
            }
            return null;
        }
        if (!is_string($value)) {
            $this->errors[$field] = 'Must be text.';
            return null;
        }
        if ($trim) {
            $value = trim($value);
        }
        $len = mb_strlen($value);
        if ($len < $min || $len > $max) {
            $this->errors[$field] = "Must be between {$min} and {$max} characters.";
            return null;
        }
        return $value;
    }

    public function email(string $field): ?string
    {
        $value = $this->string($field, 3, 190);
        if ($value !== null && filter_var($value, FILTER_VALIDATE_EMAIL) === false) {
            $this->errors[$field] = 'Must be a valid email address.';
            return null;
        }
        return $value !== null ? strtolower($value) : null;
    }

    public function password(string $field): ?string
    {
        $value = $this->string($field, 8, 128, trim: false);
        if ($value !== null && (!preg_match('/[A-Za-z]/', $value) || !preg_match('/\d/', $value))) {
            $this->errors[$field] = 'Must contain at least one letter and one number.';
            return null;
        }
        return $value;
    }

    public function int(string $field, int $min = PHP_INT_MIN, int $max = PHP_INT_MAX, bool $required = true): ?int
    {
        $value = $this->data[$field] ?? null;
        if ($value === null) {
            if ($required) {
                $this->errors[$field] = 'This field is required.';
            }
            return null;
        }
        if (!is_int($value)) {
            $this->errors[$field] = 'Must be a whole number.';
            return null;
        }
        if ($value < $min || $value > $max) {
            $this->errors[$field] = "Must be between {$min} and {$max}.";
            return null;
        }
        return $value;
    }

    public function money(string $field, bool $required = true): ?float
    {
        $value = $this->data[$field] ?? null;
        if ($value === null) {
            if ($required) {
                $this->errors[$field] = 'This field is required.';
            }
            return null;
        }
        if (!is_int($value) && !is_float($value)) {
            $this->errors[$field] = 'Must be a number.';
            return null;
        }
        if ($value < 0 || $value > 99999999) {
            $this->errors[$field] = 'Must be a positive amount.';
            return null;
        }
        return round((float) $value, 2);
    }

    public function in(string $field, array $allowed): ?string
    {
        $value = $this->data[$field] ?? null;
        if (!is_string($value) || !in_array($value, $allowed, true)) {
            $this->errors[$field] = 'Must be one of: ' . implode(', ', $allowed) . '.';
            return null;
        }
        return $value;
    }

    public function has(string $field): bool
    {
        return array_key_exists($field, $this->data);
    }

    public function validate(): void
    {
        if ($this->errors !== []) {
            throw new HttpException(422, 'Validation failed.', $this->errors);
        }
    }
}
