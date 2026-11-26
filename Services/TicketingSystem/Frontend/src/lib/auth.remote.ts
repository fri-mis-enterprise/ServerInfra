import { command, query } from '$app/server';
import { loginSchema, registerSchema, profileSchema } from './validation/auth';
import {
  currentSession,
  loginUser,
  logoutUser,
  registerUser,
  updateProfile,
} from './server/auth';

export const getSession = query(currentSession);
export const login = command(loginSchema, loginUser);
export const register = command(registerSchema, registerUser);
export const logout = command(logoutUser);
export const saveProfile = command(profileSchema, updateProfile);
