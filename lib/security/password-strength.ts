// Real server-side password strength enforcement — the frontend only
// checks length >= 6 client-side, which is not a floor to trust (§3.2's
// security notes call this out explicitly). Deliberately NOT requiring a
// specific mix of character classes (a special character, etc.): modern
// guidance (e.g. NIST SP 800-63B) favors length over arbitrary complexity
// rules, which mostly train people toward predictable substitutions
// ("password" -> "P@ssword1") rather than actually stronger secrets. The
// bar here is: reasonably long, and not just a run of the same character
// or a handful of extremely common passwords.

const MIN_LENGTH = 8;

const COMMON_PASSWORDS = new Set([
  "password", "password1", "12345678", "123456789", "qwerty123",
  "letmein123", "welcome123", "admin1234", "iloveyou1", "password123",
]);

export function checkPasswordStrength(password: string): { valid: boolean; error?: string } {
  if (password.length < MIN_LENGTH) {
    return { valid: false, error: `Password must be at least ${MIN_LENGTH} characters` };
  }
  if (/^(.)\1+$/.test(password)) {
    return { valid: false, error: "Password can't be a single repeated character" };
  }
  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    return { valid: false, error: "That password is too common — please choose another" };
  }
  return { valid: true };
}
