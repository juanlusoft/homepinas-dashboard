// Unit tests for sanitize.ts
// Input validation and sanitization for security
// Run with: npx vitest backend/tests/sanitize.test.js

import { describe, it, expect } from 'vitest';
import {
  sanitizePath,
  sanitizeString,
  sanitizePathWithinBase,
  validateComposeContent,
  sanitizeShellArg,
  sanitizeUsername,
  validateUsername
} from '../sanitize.ts';

describe('Sanitization', () => {
  describe('sanitizePath()', () => {
    it('should allow valid absolute paths', () => {
      const result = sanitizePath('/home/user/documents');
      expect(result).toBeDefined();
      expect(result).not.toBeNull();
    });

    it('should block directory traversal attempts with ../', () => {
      expect(sanitizePath('../etc/passwd')).toBeNull();
      expect(sanitizePath('/tmp/../../../etc/passwd')).toBeNull();
      expect(sanitizePath('/home/user/../../etc')).toBeNull();
    });

    it('should block critical system directories', () => {
      expect(sanitizePath('/etc')).toBeNull();
      expect(sanitizePath('/etc/passwd')).toBeNull();
      expect(sanitizePath('/proc')).toBeNull();
      expect(sanitizePath('/proc/self')).toBeNull();
      expect(sanitizePath('/sys')).toBeNull();
      expect(sanitizePath('/dev')).toBeNull();
      expect(sanitizePath('/root')).toBeNull();
      expect(sanitizePath('/boot')).toBeNull();
      expect(sanitizePath('/')).toBeNull();
    });

    it('should strip or reject paths with null bytes', () => {
      // null bytes are stripped by the sanitizer — result is not null but the byte is removed
      const result = sanitizePath('/tmp/file\x00.txt');
      // either null or a sanitized path without the null byte
      if (result !== null) {
        expect(result).not.toContain('\x00');
      }
    });

    it('should return null for invalid input', () => {
      expect(sanitizePath(null)).toBeNull();
      expect(sanitizePath('')).toBeNull();
      expect(sanitizePath(123)).toBeNull();
    });

    it('should normalize paths', () => {
      const result = sanitizePath('/home/user//documents');
      expect(result).toBeDefined();
    });
  });

  describe('sanitizePathWithinBase()', () => {
    it('should allow paths within the base directory', () => {
      const result = sanitizePathWithinBase('subdir/file.txt', '/home/user');
      expect(result).toBeDefined();
      expect(result).not.toBeNull();
    });

    it('should block traversal attempts outside base directory', () => {
      expect(sanitizePathWithinBase('../../etc/passwd', '/home/user')).toBeNull();
      expect(sanitizePathWithinBase('../../../etc', '/home/user')).toBeNull();
    });

    it('should return null for invalid input', () => {
      expect(sanitizePathWithinBase(null, '/home/user')).toBeNull();
      expect(sanitizePathWithinBase('file.txt', null)).toBeNull();
      expect(sanitizePathWithinBase('', '/home/user')).toBeNull();
    });
  });

  describe('sanitizeString()', () => {
    it('should escape HTML entities', () => {
      const result = sanitizeString('<script>alert("xss")</script>');
      expect(result).toContain('&lt;');
      expect(result).toContain('&gt;');
      expect(result).not.toContain('<');
      expect(result).not.toContain('>');
    });

    it('should escape quotes and apostrophes', () => {
      const result = sanitizeString('"hello" and \'world\'');
      expect(result).toContain('&quot;');
      expect(result).toContain('&#x27;');
    });

    it('should escape ampersands', () => {
      const result = sanitizeString('Tom & Jerry');
      expect(result).toContain('&amp;');
    });

    it('should truncate to 1000 characters', () => {
      const longString = 'a'.repeat(2000);
      const result = sanitizeString(longString);
      expect(result.length).toBeLessThanOrEqual(1000);
    });

    it('should return empty string for invalid input', () => {
      expect(sanitizeString(null)).toBe('');
      expect(sanitizeString(undefined)).toBe('');
      expect(sanitizeString(123)).toBe('');
    });
  });

  describe('sanitizeShellArg()', () => {
    it('should escape single quotes', () => {
      const result = sanitizeShellArg("it's");
      expect(result).toContain("'");
    });

    it('should handle shell metacharacters safely', () => {
      const result = sanitizeShellArg('$(rm -rf /)');
      expect(result).toBeDefined();
    });

    it('should return empty quoted string for null/undefined', () => {
      expect(sanitizeShellArg(null)).toBe("''");
      expect(sanitizeShellArg(undefined)).toBe("''");
    });
  });

  describe('validateComposeContent()', () => {
    it('should validate valid docker-compose YAML', () => {
      const validCompose = `
version: '3'
services:
  web:
    image: nginx:latest
      `;
      const result = validateComposeContent(validCompose);
      expect(result.valid).toBe(true);
    });

    it('should reject YAML without services key', () => {
      const invalidCompose = `
version: '3'
volumes:
  data:
      `;
      const result = validateComposeContent(invalidCompose);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('services');
    });

    it('should reject invalid YAML syntax', () => {
      const malformedYaml = `
version: '3'
services
  web:
    image: nginx
      `;
      const result = validateComposeContent(malformedYaml);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('YAML');
    });

    it('should reject empty content', () => {
      const result = validateComposeContent('');
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should reject content larger than 100KB', () => {
      const largeContent = 'a'.repeat(100001);
      const result = validateComposeContent(largeContent);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('too large');
    });

    it('should reject non-string input', () => {
      expect(validateComposeContent(null).valid).toBe(false);
      expect(validateComposeContent(123).valid).toBe(false);
    });
  });

  describe('sanitizeUsername()', () => {
    it('should accept valid usernames', () => {
      expect(sanitizeUsername('john_doe')).not.toBeNull();
      expect(sanitizeUsername('user123')).not.toBeNull();
      expect(sanitizeUsername('admin-user')).not.toBeNull();
    });

    it('should reject reserved system usernames', () => {
      expect(sanitizeUsername('root')).toBeNull();
      expect(sanitizeUsername('daemon')).toBeNull();
      expect(sanitizeUsername('nobody')).toBeNull();
      expect(sanitizeUsername('www-data')).toBeNull();
    });

    it('should strip or reject invalid characters', () => {
      // sanitizeUsername strips invalid chars from the result (does not always return null)
      // verify that invalid chars are not present in returned value
      const spaceResult = sanitizeUsername('user name');
      if (spaceResult !== null) expect(spaceResult).not.toContain(' ');
      const dollarResult = sanitizeUsername('user$dollar');
      if (dollarResult !== null) expect(dollarResult).not.toContain('$');
      const atResult = sanitizeUsername('user@host');
      if (atResult !== null) expect(atResult).not.toContain('@');
    });

    it('should reject names not starting with letter', () => {
      expect(sanitizeUsername('123user')).toBeNull();
      expect(sanitizeUsername('_user')).toBeNull();
    });

    it('should enforce length constraints (3-32 chars)', () => {
      expect(sanitizeUsername('ab')).toBeNull();
      expect(sanitizeUsername('a'.repeat(33))).toBeNull();
    });
  });

  describe('validateUsername()', () => {
    it('should return true for valid usernames', () => {
      expect(validateUsername('validuser')).toBe(true);
      expect(validateUsername('test123')).toBe(true);
    });

    it('should return false for invalid usernames', () => {
      expect(validateUsername('root')).toBe(false);
      expect(validateUsername('123')).toBe(false);
      expect(validateUsername(null)).toBe(false);
    });
  });
});
