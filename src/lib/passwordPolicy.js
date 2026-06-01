/** Client-side password rules for reset / set-password flows. */
export const PASSWORD_POLICY_MESSAGE =
  'Password must be at least 8 characters and include an uppercase letter, a lowercase letter, a number, and a special character.';

const MIN_LENGTH = 8;
const HAS_UPPER = /[A-Z]/;
const HAS_LOWER = /[a-z]/;
const HAS_NUMBER = /[0-9]/;
const HAS_SPECIAL = /[^A-Za-z0-9]/;

export function validatePassword(password) {
  if (!password || password.length < MIN_LENGTH) {
    return { valid: false, message: PASSWORD_POLICY_MESSAGE };
  }
  if (!HAS_UPPER.test(password)) {
    return { valid: false, message: PASSWORD_POLICY_MESSAGE };
  }
  if (!HAS_LOWER.test(password)) {
    return { valid: false, message: PASSWORD_POLICY_MESSAGE };
  }
  if (!HAS_NUMBER.test(password)) {
    return { valid: false, message: PASSWORD_POLICY_MESSAGE };
  }
  if (!HAS_SPECIAL.test(password)) {
    return { valid: false, message: PASSWORD_POLICY_MESSAGE };
  }
  return { valid: true, message: null };
}

export function passwordsMatch(password, confirmPassword) {
  return password === confirmPassword;
}
