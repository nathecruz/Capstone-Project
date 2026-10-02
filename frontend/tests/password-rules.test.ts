import { validatePasswordStrength } from '@/authentication/password';

const context = { fullName: 'Ana Reyes', email: 'ana.reyes@school.edu', serviceWords: ['habitai', 'habit'] };
const accepts = (password: string) => validatePasswordStrength(password, context).ok;

describe('validatePasswordStrength', () => {
  it('accepts ordinary strong passwords, including symbols in the middle', () => {
    expect(accepts('Qx7!abcDEF#9z')).toBe(true);
    expect(accepts('Tiger!Blue8x')).toBe(true);
    expect(accepts('Apple!Tiger8')).toBe(true);
    expect(accepts('Tiger!1122x')).toBe(true);
  });

  it('rejects what the server rejects', () => {
    expect(accepts('Short1!')).toBe(false);
    expect(accepts('tiger!blue8x')).toBe(false);
    expect(accepts('Tiger!2004x')).toBe(false);
    expect(accepts('AnaReyes!77x')).toBe(false);
    expect(accepts('Habitai!Blue8')).toBe(false);
    expect(accepts('Tiger!aaa8Bx')).toBe(false);
    expect(accepts('Tiger!123Bx')).toBe(false);
  });

  it('still refuses common passwords', () => {
    expect(accepts('Password!8x')).toBe(false);
    expect(accepts('Sunshine!8x')).toBe(false);
  });
});
