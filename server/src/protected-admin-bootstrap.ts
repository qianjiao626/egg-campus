export interface ProtectedAdminPasswordInput {
  first: string;
  firstConfirmation: string;
  second: string;
  secondConfirmation: string;
}

export function validateProtectedAdminPasswords(input: ProtectedAdminPasswordInput) {
  if (input.first !== input.firstConfirmation || input.second !== input.secondConfirmation) {
    throw new Error('PASSWORD_CONFIRMATION_MISMATCH');
  }
  if (input.first.length < 8 || input.second.length < 8) throw new Error('PASSWORD_TOO_SHORT');
  if (input.first === input.second) throw new Error('PASSWORDS_MUST_DIFFER');
}
