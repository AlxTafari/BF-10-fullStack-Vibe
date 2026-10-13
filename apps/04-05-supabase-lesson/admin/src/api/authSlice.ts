import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

export interface AuthState {
  // loading — пока supabase-js не сообщил, есть ли сохранённая сессия.
  status: "loading" | "signedIn" | "signedOut";
  email: string | null;
}

const initialState: AuthState = { status: "loading", email: null };

export const authSlice = createSlice({
  name: "auth",
  initialState,
  reducers: {
    signedIn(state, action: PayloadAction<{ email: string | null }>) {
      state.status = "signedIn";
      state.email = action.payload.email;
    },
    signedOut(state) {
      state.status = "signedOut";
      state.email = null;
    },
  },
});

export const { signedIn, signedOut } = authSlice.actions;
