import { expect, test } from 'bun:test';
import { loginSchema, registerSchema } from './auth';

test('login requires credentials and keeps passwords unchanged', () => {
  expect(loginSchema.safeParse({ username: '', password: '' }).success).toBe(false);
  expect(loginSchema.parse({ username: 'user', password: '  password  ' }).password).toBe('  password  ');
});

test('registration validates fields before a request is sent', () => {
  const valid = { username: 'tester', password: 'password123', email: 'test@example.com', first_name: 'Test', last_name: 'User' };
  expect(registerSchema.safeParse(valid).success).toBe(true);
  for (const patch of [{ password: 'short' }, { email: 'invalid' }, { username: 'ab' }, { first_name: '' }, { department_id: 1.5 }]) {
    expect(registerSchema.safeParse({ ...valid, ...patch }).success).toBe(false);
  }
  expect(registerSchema.parse({ ...valid, roles: ['admin'] })).not.toHaveProperty('roles');
});
