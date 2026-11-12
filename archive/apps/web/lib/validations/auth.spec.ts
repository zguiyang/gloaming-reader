import { describe, expect, it } from 'vitest';

import { forgotPasswordSchema, resetPasswordSchema, signInSchema, signUpSchema, userSchema } from './auth';

describe('userSchema', () => {
  it('parses User with string id and name', () => {
    const user = {
      id: 'user_1',
      email: 'a@b.com',
      username: 'a',
      name: 'Ada',
      role: 'user',
      image: null,
      emailVerified: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    expect(userSchema.parse(user)).toEqual(user);
  });
});

describe('signInSchema', () => {
  it('accepts email or username as login', () => {
    expect(
      signInSchema.parse({
        login: 'reader@example.com',
        password: 'password1',
      }),
    ).toEqual({
      login: 'reader@example.com',
      password: 'password1',
    });

    expect(
      signInSchema.parse({
        login: 'ada.reader',
        password: 'password1',
      }),
    ).toEqual({
      login: 'ada.reader',
      password: 'password1',
    });
  });

  it('rejects an empty login', () => {
    const result = signInSchema.safeParse({
      login: '',
      password: 'password1',
    });

    expect(result.success).toBe(false);
  });

  it('rejects a password shorter than 8 characters', () => {
    const result = signInSchema.safeParse({
      login: 'reader@example.com',
      password: 'short',
    });

    expect(result.success).toBe(false);
  });

  it('rejects a password longer than 128 characters', () => {
    const result = signInSchema.safeParse({
      login: 'reader@example.com',
      password: 'p'.repeat(129),
    });

    expect(result.success).toBe(false);
  });
});

describe('signUpSchema', () => {
  const valid = {
    name: 'Ada Reader',
    username: 'ada.reader',
    email: 'ada@example.com',
    password: 'password1',
  };

  it('accepts a valid sign-up payload', () => {
    expect(signUpSchema.parse(valid)).toEqual(valid);
  });

  it('rejects an empty name', () => {
    const result = signUpSchema.safeParse({ ...valid, name: '' });
    expect(result.success).toBe(false);
  });

  it('rejects a username shorter than 3 characters', () => {
    const result = signUpSchema.safeParse({ ...valid, username: 'ab' });
    expect(result.success).toBe(false);
  });

  it('rejects a username with invalid characters', () => {
    const result = signUpSchema.safeParse({ ...valid, username: 'ada reader!' });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid email', () => {
    const result = signUpSchema.safeParse({ ...valid, email: 'ada@' });
    expect(result.success).toBe(false);
  });

  it('rejects a password shorter than 8 characters', () => {
    const result = signUpSchema.safeParse({ ...valid, password: '1234567' });
    expect(result.success).toBe(false);
  });

  it('rejects a password longer than 128 characters', () => {
    const result = signUpSchema.safeParse({ ...valid, password: 'p'.repeat(129) });
    expect(result.success).toBe(false);
  });
});

describe('forgotPasswordSchema', () => {
  it('accepts a valid email', () => {
    expect(forgotPasswordSchema.parse({ email: 'reader@example.com' })).toEqual({
      email: 'reader@example.com',
    });
  });

  it('rejects an invalid email', () => {
    expect(forgotPasswordSchema.safeParse({ email: 'nope' }).success).toBe(false);
  });
});

describe('resetPasswordSchema', () => {
  it('accepts matching passwords', () => {
    expect(
      resetPasswordSchema.parse({
        password: 'password1',
        passwordConfirm: 'password1',
      }),
    ).toEqual({
      password: 'password1',
      passwordConfirm: 'password1',
    });
  });

  it('rejects mismatched passwords', () => {
    expect(
      resetPasswordSchema.safeParse({
        password: 'password1',
        passwordConfirm: 'password2',
      }).success,
    ).toBe(false);
  });
});
